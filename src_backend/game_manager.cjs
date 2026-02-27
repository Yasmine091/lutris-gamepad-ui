const { spawn } = require("child_process");
const { readFileSync } = require("fs");
const { readdir } = require("node:fs/promises");
const path = require("node:path");
const { globalShortcut } = require("electron");

const {
  getMainWindow,
  getRunningGameProcess,
  setRunningGameProcess,
  addWhitelistedFile,
  isKnowGameID,
  addKnowGameID,
} = require("./state.cjs");
const {
  getLutrisWrapperPath,
  logError,
  logInfo,
  logWarn,
  toastError,
  getProcessDescendants,
  isProcessPaused,
} = require("./utils.cjs");
const { toggleWindowShow } = require("./window_manager.cjs");
const {
  getCoverartPath,
  getBannerartPath,
  getRuntimeIconPath,
  getAllGamesCategories,
  getLutrisGames,
} = require("./lutris_wrapper.cjs");
const { getAppConfig } = require("./config_manager.cjs");

const runtimeIconCache = new Map();
const FORCE_CLOSE_KILL_FALLBACK_MS = 1500;
const PAUSE_STATE_RECHECK_DELAYS_MS = [120, 350];

function sendMainWindowEvent(channel, ...args) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, ...args);
}

function getAliveProcessTreePids(rootPid) {
  let descendants = [];

  try {
    descendants = getProcessDescendants(rootPid, new Set());
  } catch (e) {
    logError("Unable to enumerate descendants for pid", rootPid, e);
  }

  const uniquePids = [...new Set([rootPid, ...descendants])].filter(
    (pid) => Number.isInteger(pid) && pid > 0,
  );

  return uniquePids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e?.code === "EPERM";
    }
  });
}

function computePausedStateFromProcessTree(rootPid) {
  const allPids = getAliveProcessTreePids(rootPid);
  if (!allPids.length) {
    return null;
  }

  let nonPausedCount = 0;
  let pausedCount = 0;

  for (const pid of allPids) {
    try {
      if (isProcessPaused(pid)) {
        pausedCount += 1;
      } else {
        nonPausedCount += 1;
      }
    } catch (e) {
      logWarn("Unable to determine paused state for pid", pid, e);
      nonPausedCount += 1;
    }
  }

  return pausedCount > 0 && nonPausedCount === 0;
}

function emitPauseStateForProcess(processRef) {
  if (!processRef) return;

  const paused = computePausedStateFromProcessTree(processRef.pid);
  if (paused === null) return;

  sendMainWindowEvent("game-pause-state-changed", paused);
}

function finalizeRunningGameProcessIfCurrent(processRef, reason) {
  if (!processRef) return false;

  const currentRunningProcess = getRunningGameProcess();
  if (!currentRunningProcess || currentRunningProcess.pid !== processRef.pid) {
    return false;
  }

  logWarn("Finalizing tracked running process:", processRef.pid, reason);
  setRunningGameProcess(null);
  sendMainWindowEvent("game-pause-state-changed", false);
  sendMainWindowEvent("game-closed");

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }

  globalShortcut.unregister("CommandOrControl+X");
  return true;
}

function findLutrisWrapperChildren(pid) {
  const allSubprocesses = getProcessDescendants(pid, new Set());
  return allSubprocesses.filter((childPid) => {
    try {
      const cmdline = readFileSync(`/proc/${childPid}/cmdline`, "utf8");
      return cmdline.startsWith("lutris-wrapper");
    } catch (e) {
      logError("Unable to read cmdline of pid", childPid, e);
      return false;
    }
  });
}

function closeRunningGameProcess() {
  const runningGameProcess = getRunningGameProcess();
  if (!runningGameProcess) return;

  const currentPausedState = computePausedStateFromProcessTree(
    runningGameProcess.pid,
  );
  if (currentPausedState === null) {
    finalizeRunningGameProcessIfCurrent(
      runningGameProcess,
      "close requested but process tree is already gone",
    );
    return;
  }
  const isPaused = currentPausedState;

  let pidsToStop;

  const getAllPids = () => {
    return getAliveProcessTreePids(runningGameProcess.pid);
  };

  if (isPaused) {
    pidsToStop = getAllPids();
  } else {
    try {
      const wrapperChildren = findLutrisWrapperChildren(runningGameProcess.pid);
      pidsToStop = [...new Set([runningGameProcess.pid, ...wrapperChildren])];
    } catch (e) {
      logError("Unable to find lutris wrapper child", e);
    }
    if (!pidsToStop?.length) {
      logError("Unable to locate lutris wrapper child");
      pidsToStop = getAllPids();
    }
  }

  let signal;

  if (isPaused) {
    signal = "SIGKILL";
  } else {
    signal = "SIGTERM";
  }

  pidsToStop.forEach((pid) => {
    logInfo("Sending", signal, "to pid", pid);
    try {
      process.kill(pid, signal);
    } catch (e) {
      logError("Unable to kill pid", pid, e);
    }
  });

  if (!isPaused) {
    setTimeout(() => {
      const latestProcess = getRunningGameProcess();
      if (!latestProcess || latestProcess.pid !== runningGameProcess.pid) return;

      const alivePids = getAllPids();
      if (!alivePids.length) {
        finalizeRunningGameProcessIfCurrent(
          runningGameProcess,
          "force-close fallback found no alive pids",
        );
        return;
      }

      alivePids.forEach((pid) => {
        try {
          logWarn("Fallback SIGKILL to pid", pid);
          process.kill(pid, "SIGKILL");
        } catch (e) {
          logError("Unable to send fallback SIGKILL to pid", pid, e);
        }
      });
    }, FORCE_CLOSE_KILL_FALLBACK_MS);
  }

  try {
    runningGameProcess.stdin.end();
  } catch (e) {
    logWarn("Unable to close stdin of running process", e);
  }
}

async function getGames() {
  const [games, gamesCategories] = await Promise.all([
    getLutrisGames(),
    getAllGamesCategories(),
  ]);

  if (!games.length) return games;

  try {
    const {
      categories: allCategories,
      all_games_categories: gameCategoriesMap,
    } = gamesCategories;

    const hiddenGamesCategory = allCategories.find((c) => c.name === ".hidden");

    const categoryIdToNameMap = new Map(
      allCategories
        .filter((c) => c !== hiddenGamesCategory)
        .map((cat) => [cat.id, cat.name]),
    );

    for (const game of games) {
      const categoryIds = gameCategoriesMap[String(game.id)] || [];

      const categories = categoryIds
        .map((id) => categoryIdToNameMap.get(id))
        .filter(Boolean);

      if (hiddenGamesCategory && !game.hidden) {
        game.hidden = categoryIds.includes(hiddenGamesCategory.id);
      }

      game.categories = categories;
    }
  } catch (e) {
    logError("Could not process game categories:", e);
  }

  try {
    const uniqueRunners = [
      ...new Set(games.map((g) => g.runner).filter(Boolean)),
    ];
    const runnersToFetch = uniqueRunners.filter(
      (runner) => !runtimeIconCache.has(runner),
    );

    if (runnersToFetch.length > 0) {
      const iconPromises = runnersToFetch.map(async (runner) => {
        try {
          const path = await getRuntimeIconPath(runner);
          if (path) {
            runtimeIconCache.set(runner, path);
            addWhitelistedFile(path);
          } else {
            runtimeIconCache.set(runner, null);
          }
        } catch (error) {
          logWarn(`Could not get runtime icon for '${runner}':`, error);
          runtimeIconCache.set(runner, null);
        }
      });
      await Promise.all(iconPromises);
    }

    for (const game of games) {
      if (game.runner && runtimeIconCache.has(game.runner)) {
        const runtimeIconPath = runtimeIconCache.get(game.runner);
        if (runtimeIconPath) {
          game.runtimeIconPath = runtimeIconPath;
        }
      }
    }
  } catch (e) {
    logError("Could not process runtime icons:", e);
  }

  try {
    const lutrisCoverDir = await getCoverartPath();
    const lutrisCoverDirFiles = await readdir(lutrisCoverDir);

    for (const game of games) {
      if (game.coverPath) {
        addWhitelistedFile(game.coverPath);
        continue;
      }
      if (game.slug) {
        const coverFilename = lutrisCoverDirFiles.find((f) =>
          f.startsWith(`${game.slug}.`),
        );
        if (coverFilename) {
          const coverPath = path.join(lutrisCoverDir, coverFilename);
          game.coverPath = coverPath;
          addWhitelistedFile(coverPath);
        }
      }
    }
  } catch (e) {
    logError("Could not process game cover art:", e);
  }

  try {
    const lutrisBannerDir = await getBannerartPath();
    if (lutrisBannerDir) {
      const lutrisBannerDirFiles = await readdir(lutrisBannerDir);

      for (const game of games) {
        if (game.bannerPath) {
          addWhitelistedFile(game.bannerPath);
          continue;
        }

        if (game.slug) {
          const bannerFilename = lutrisBannerDirFiles.find((f) =>
            f.startsWith(`${game.slug}.`),
          );
          if (bannerFilename) {
            const bannerPath = path.join(lutrisBannerDir, bannerFilename);
            game.bannerPath = bannerPath;
            addWhitelistedFile(bannerPath);
          }
        }
      }
    }
  } catch (e) {
    logWarn("Could not process game banner art:", e);
  }

  games.forEach((g) => {
    addKnowGameID(g.id);
  });

  return games;
}

function toggleGamePause(opts) {
  const runningGameProcess = getRunningGameProcess();
  if (!runningGameProcess) return;

  const currentPausedState = computePausedStateFromProcessTree(
    runningGameProcess.pid,
  );
  if (currentPausedState === null) {
    finalizeRunningGameProcessIfCurrent(
      runningGameProcess,
      "pause requested but process tree is no longer alive",
    );
    return;
  }

  switch (opts?.forceStatus) {
    case "running": {
      if (!currentPausedState) return;
      break;
    }

    case "paused": {
      if (currentPausedState) return;
      break;
    }
  }

  const allProcesses = getAliveProcessTreePids(runningGameProcess.pid);
  if (!allProcesses.length) {
    logWarn("Unable to toggle pause, process tree is empty");
    return;
  }

  let signal;

  if (currentPausedState) {
    signal = "SIGCONT";
  } else {
    signal = "SIGSTOP";
  }

  allProcesses.forEach((pid) => {
    try {
      logInfo("sending", signal, "to pid", pid);
      process.kill(pid, signal);
    } catch (e) {
      logError("Unable to send signal", signal, "to pid", pid, e);
    }
  });

  sendMainWindowEvent("game-pause-state-changed", !currentPausedState);

  PAUSE_STATE_RECHECK_DELAYS_MS.forEach((delayMs) => {
    setTimeout(() => {
      const latestProcess = getRunningGameProcess();
      if (!latestProcess || latestProcess.pid !== runningGameProcess.pid) return;
      emitPauseStateForProcess(latestProcess);
    }, delayMs);
  });
}

function launchGame(gameId) {
  if (getRunningGameProcess()) {
    throw new Error("A game is already running.");
  }

  if (!isKnowGameID(gameId)) {
    logError("unknown game id", gameId);
    return;
  }

  const gameStartTime = Date.now();

  const newGameProcess = spawn(
    "bash",
    [getLutrisWrapperPath(), `lutris:rungameid/${gameId}`],
    {
      detached: getAppConfig().keepGamesRunningOnQuit,
    },
  );

  const stdoutTextDecoder = new TextDecoder();
  const stderrTextDecoder = new TextDecoder();

  newGameProcess.stdout.on("data", (stdout) => {
    logInfo("rungameid", stdoutTextDecoder.decode(stdout));
  });

  newGameProcess.stderr.on("data", (stderr) => {
    logError("rungameid", stderrTextDecoder.decode(stderr));
  });

  setRunningGameProcess(newGameProcess);

  sendMainWindowEvent("game-started", gameId);
  sendMainWindowEvent("game-pause-state-changed", false);

  globalShortcut.register("CommandOrControl+X", toggleWindowShow);

  let hasClosed = false;
  const onGameClosed = () => {
    if (hasClosed) return;
    hasClosed = true;

    finalizeRunningGameProcessIfCurrent(newGameProcess, "child process closed");
  };

  newGameProcess.once("close", onGameClosed);

  newGameProcess.once("error", (e) => {
    logError("game process error:", e);

    const gameCloseTime = Date.now();
    if (gameCloseTime - gameStartTime < 10_000) {
      toastError("launchGame", e);
    }

    onGameClosed();
  });

  if (newGameProcess.exitCode !== null) {
    onGameClosed();
  }
}

module.exports = {
  getGames,
  launchGame,
  closeRunningGameProcess,
  toggleGamePause,
};
