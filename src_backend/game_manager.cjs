const { spawn } = require("child_process");
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
  showToastOnUi,
  getProcessCommandLine,
  getProcessDescendants,
  getProcessEnvironmentValue,
  getProcessGroupMembers,
  getPidsByCommandLinePatterns,
  getPidsByEnvironmentValue,
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

const runtimeIconCache = new Map();
const knownGameMetaById = new Map();
const FORCE_CLOSE_RETRY_INTERVAL_MS = 220;
const FORCE_CLOSE_MAX_RETRIES = 12;
const FORCE_CLOSE_HARD_TIMEOUT_MS = 2_200;
const PAUSE_STATE_RECHECK_DELAYS_MS = [120, 350];
const LIVENESS_RECHECK_INTERVAL_MS = 300;
const LIVENESS_MONITOR_INTERVAL_MS = 450;
const EXIT_STABILITY_GRACE_MS = 900;
const LUTRIS_GAME_UUID_ENV_KEY = "LUTRIS_GAME_UUID";
const LUTRIS_UUID_SCAN_CACHE_MS = 900;
const GAME_CMDLINE_SCAN_CACHE_MS = 900;

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

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

function getDescendantsForPids(pids) {
  const descendants = [];
  const visited = new Set();

  pids.forEach((pid) => {
    try {
      descendants.push(...getProcessDescendants(pid, visited));
    } catch (e) {
      logWarn("Unable to enumerate descendants for uuid pid", pid, e);
    }
  });

  return descendants;
}

function buildGameCommandPatterns(processRef) {
  const meta = processRef?.gameMeta;
  if (!meta) return [];

  const patterns = new Set();
  const addParts = (value, minLen = 5) => {
    String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((part) => part.length >= minLen)
      .forEach((part) => patterns.add(part));
  };

  if (meta.slug) {
    patterns.add(String(meta.slug).toLowerCase());
    addParts(meta.slug, 4);
  }

  if (meta.title) {
    const title = String(meta.title).toLowerCase().trim();
    if (title.length >= 6) {
      patterns.add(title);
    }
    addParts(title, 5);
  }

  if (meta.serviceId) {
    const serviceId = String(meta.serviceId).trim();
    if (/^\d{4,}$/.test(serviceId)) {
      patterns.add(serviceId);
    }
  }

  return [...patterns];
}

function getTrackedPidsByGameMetadata(processRef, forceScan = false) {
  if (!processRef) return [];
  const allowPassiveScan = !processRef.lutrisGameUuid;
  if (!forceScan && !processRef.closeInProgress && !allowPassiveScan) return [];

  const patterns = buildGameCommandPatterns(processRef);
  if (!patterns.length) return [];

  const now = Date.now();
  const cache = processRef.gameCmdlinePidCache;
  if (cache && now - cache.at < GAME_CMDLINE_SCAN_CACHE_MS) {
    return cache.pids.filter((pid) => isPidAlive(pid));
  }

  const candidates = getPidsByCommandLinePatterns(patterns).filter((pid) =>
    isPidAlive(pid),
  );

  const runnerHints = [
    "lutris",
    "wine",
    "proton",
    "steam",
    "gamescope",
    "flatpak",
  ];

  const filtered = candidates.filter((pid) => {
    const cmdline = getProcessCommandLine(pid).toLowerCase();
    if (!cmdline) return false;

    const hasRunnerHint = runnerHints.some((hint) => cmdline.includes(hint));
    const hasSlug =
      processRef?.gameMeta?.slug &&
      cmdline.includes(String(processRef.gameMeta.slug).toLowerCase());

    return hasRunnerHint || hasSlug;
  });

  processRef.gameCmdlinePidCache = {
    at: now,
    pids: filtered,
  };
  return filtered;
}

function getTrackedPidsByLutrisUuid(processRef) {
  if (!processRef?.lutrisGameUuid) return [];

  const now = Date.now();
  const cache = processRef.uuidPidCache;
  if (
    cache &&
    cache.uuid === processRef.lutrisGameUuid &&
    now - cache.at < LUTRIS_UUID_SCAN_CACHE_MS
  ) {
    return cache.pids.filter((pid) => isPidAlive(pid));
  }

  const uuidRootPids = getPidsByEnvironmentValue(
    LUTRIS_GAME_UUID_ENV_KEY,
    processRef.lutrisGameUuid,
  ).filter((pid) => isPidAlive(pid));
  const allCandidatePids = [
    ...uuidRootPids,
    ...getDescendantsForPids(uuidRootPids),
  ];
  const resolvedPids = [...new Set(allCandidatePids)].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && isPidAlive(pid),
  );

  processRef.uuidPidCache = {
    uuid: processRef.lutrisGameUuid,
    at: now,
    pids: resolvedPids,
  };
  return resolvedPids;
}

function detectTrackedLutrisGameUuid(processRef, candidatePids = []) {
  if (!processRef) return null;
  if (processRef.lutrisGameUuid) return processRef.lutrisGameUuid;

  const seedPids = [
    ...new Set(
      [
        ...(Array.isArray(candidatePids) ? candidatePids : []),
        processRef.pid,
        ...(Array.isArray(processRef.observedPids) ? processRef.observedPids : []),
      ].filter((pid) => Number.isInteger(pid) && pid > 0),
    ),
  ];

  for (const pid of seedPids) {
    const value = getProcessEnvironmentValue(pid, LUTRIS_GAME_UUID_ENV_KEY);
    if (value) {
      processRef.lutrisGameUuid = value;
      processRef.uuidPidCache = null;
      logInfo("Detected tracked LUTRIS_GAME_UUID", value, "from pid", pid);
      return value;
    }
  }

  return null;
}

function rememberObservedPids(processRef, pids) {
  if (!processRef) return;

  const previousObserved = Array.isArray(processRef.observedPids)
    ? processRef.observedPids
    : [];
  const merged = [...new Set([...previousObserved, ...pids])].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && isPidAlive(pid),
  );

  processRef.observedPids = merged;
}

function touchProcessLiveness(processRef, alivePids) {
  if (!processRef || !alivePids.length) return;
  processRef.lastSeenAliveAt = Date.now();
  rememberObservedPids(processRef, alivePids);
}

function getTrackedAlivePids(processRef) {
  if (!processRef) return [];

  let alivePids = [];

  // Process-group expansion is expensive (/proc full scan) and is only needed
  // for aggressive force-close logic, not for passive "is game still running?"
  // checks.
  if (
    processRef.closeInProgress === true &&
    processRef.detachedGroup === true &&
    Number.isInteger(processRef.pgid) &&
    processRef.pgid > 0
  ) {
    const groupMembers = getProcessGroupMembers(processRef.pgid).filter(
      (pid) => Number.isInteger(pid) && pid > 0 && isPidAlive(pid),
    );
    alivePids.push(...groupMembers);
  }

  // Fallback to previously observed roots in case the launcher process exited
  // and the game re-parented/moved process groups.
  if (!alivePids.length && Array.isArray(processRef.observedPids)) {
    const observedTreePids = processRef.observedPids.flatMap((pid) =>
      getAliveProcessTreePids(pid),
    );
    alivePids.push(...observedTreePids);
  }

  if (!alivePids.length) {
    if (!Number.isInteger(processRef.pid) || processRef.pid <= 0) {
      return [];
    }
    alivePids.push(...getAliveProcessTreePids(processRef.pid));
  }

  detectTrackedLutrisGameUuid(processRef, alivePids);
  alivePids.push(...getTrackedPidsByLutrisUuid(processRef));
  if (processRef.closeInProgress || !processRef.lutrisGameUuid) {
    alivePids.push(
      ...getTrackedPidsByGameMetadata(processRef, processRef.closeInProgress),
    );
  }

  const uniqueAlivePids = [...new Set(alivePids)].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && isPidAlive(pid),
  );

  touchProcessLiveness(processRef, uniqueAlivePids);
  return uniqueAlivePids;
}

function getTrackedRuntimeAlivePids(processRef, seedAlivePids = null) {
  if (!processRef) return [];

  const candidateAlivePids = Array.isArray(seedAlivePids)
    ? seedAlivePids
    : getTrackedAlivePids(processRef);
  detectTrackedLutrisGameUuid(processRef, candidateAlivePids);

  const runtimePids = new Set();
  getTrackedPidsByLutrisUuid(processRef).forEach((pid) => runtimePids.add(pid));
  getTrackedPidsByGameMetadata(
    processRef,
    processRef.closeInProgress || !processRef.lutrisGameUuid,
  ).forEach((pid) => runtimePids.add(pid));

  // If we still don't have a game-specific signature, treat tracked descendants
  // except the launcher pid as runtime candidates.
  if (!runtimePids.size && !processRef.lutrisGameUuid) {
    candidateAlivePids
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== processRef.pid)
      .forEach((pid) => runtimePids.add(pid));
  }

  return [...runtimePids].filter((pid) => isPidAlive(pid));
}

function computePausedStateFromPids(allPids) {
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

function computePausedStateForTrackedProcess(processRef) {
  const trackedPids = getTrackedAlivePids(processRef);
  return computePausedStateFromPids(trackedPids);
}

function emitPauseStateForProcess(processRef) {
  if (!processRef) return;

  const paused = computePausedStateForTrackedProcess(processRef);
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
  if (processRef?.livenessMonitorTimer) {
    clearInterval(processRef.livenessMonitorTimer);
    processRef.livenessMonitorTimer = null;
  }
  processRef.closeInProgress = false;
  return true;
}

function sendSignalToTrackedProcess(processRef, signal) {
  if (!processRef) return;

  const targetPids = new Set();

  if (
    processRef.detachedGroup === true &&
    Number.isInteger(processRef.pgid) &&
    processRef.pgid > 0
  ) {
    try {
      logInfo("Sending", signal, "to process group", processRef.pgid);
      process.kill(-processRef.pgid, signal);
    } catch (e) {
      logError(
        "Unable to send signal",
        signal,
        "to process group",
        processRef.pgid,
        e,
      );
    }
  }

  getTrackedAlivePids(processRef).forEach((pid) => targetPids.add(pid));

  if (Array.isArray(processRef.observedPids)) {
    processRef.observedPids
      .filter((pid) => Number.isInteger(pid) && pid > 0 && isPidAlive(pid))
      .forEach((pid) => targetPids.add(pid));
  }

  detectTrackedLutrisGameUuid(processRef, [...targetPids]);
  getTrackedPidsByLutrisUuid(processRef).forEach((pid) => targetPids.add(pid));
  getTrackedPidsByGameMetadata(processRef).forEach((pid) => targetPids.add(pid));

  targetPids.forEach((pid) => {
    logInfo("Sending", signal, "to pid", pid);
    try {
      process.kill(pid, signal);
    } catch (e) {
      logError("Unable to send signal", signal, "to pid", pid, e);
    }
  });
}

function collectAggressiveKillTargets(processRef) {
  const targets = new Set();

  getTrackedAlivePids(processRef).forEach((pid) => targets.add(pid));
  // Only use broad metadata matching while close is actively in progress,
  // so detached follow-up sweeps do not accidentally target a fresh relaunch.
  if (processRef?.closeInProgress) {
    getTrackedPidsByGameMetadata(processRef, true).forEach((pid) =>
      targets.add(pid),
    );
  }
  getTrackedPidsByLutrisUuid(processRef).forEach((pid) => targets.add(pid));

  if (Array.isArray(processRef?.observedPids)) {
    processRef.observedPids
      .filter((pid) => Number.isInteger(pid) && pid > 0 && isPidAlive(pid))
      .forEach((pid) => targets.add(pid));
  }

  return [...targets];
}

function runDetachedCloseSweeps(processRef, attempt = 0) {
  const killTargets = collectAggressiveKillTargets(processRef);

  if (
    processRef.detachedGroup === true &&
    Number.isInteger(processRef.pgid) &&
    processRef.pgid > 0
  ) {
    try {
      process.kill(-processRef.pgid, "SIGKILL");
    } catch (e) {
      // Ignore normal races; group can disappear between checks.
      if (e?.code !== "ESRCH") {
        logWarn("Detached kill sweep failed for process group", processRef.pgid, e);
      }
    }
  }

  killTargets.forEach((pid) => {
    try {
      process.kill(pid, "SIGKILL");
    } catch (e) {
      if (e?.code !== "ESRCH") {
        logWarn("Detached kill sweep failed for pid", pid, e);
      }
    }
  });

  if (!killTargets.length) {
    return;
  }

  if (attempt + 1 >= FORCE_CLOSE_MAX_RETRIES) {
    return;
  }

  setTimeout(
    () => runDetachedCloseSweeps(processRef, attempt + 1),
    FORCE_CLOSE_RETRY_INTERVAL_MS,
  );
}

function scheduleForceCloseEscalation(processRef, reason, attempt = 0) {
  setTimeout(() => {
    const latestProcess = getRunningGameProcess();
    if (!latestProcess || latestProcess.pid !== processRef.pid) return;

    const alivePids = getTrackedAlivePids(latestProcess);
    if (!alivePids.length) {
      finalizeRunningGameProcessIfCurrent(processRef, `${reason} - no alive pids`);
      return;
    }

    sendSignalToTrackedProcess(latestProcess, "SIGKILL");

    if (attempt + 1 >= FORCE_CLOSE_MAX_RETRIES) {
      logError(
        "Unable to force-close tracked process after retries. Alive pids:",
        alivePids,
      );
      showToastOnUi({
        title: "Unable to verify game termination",
        description:
          "Some processes are still alive after multiple kill attempts. Releasing UI lock.",
        type: "error",
      });
      finalizeRunningGameProcessIfCurrent(
        processRef,
        `${reason} - retries exhausted; releasing running lock`,
      );
      return;
    }

    scheduleForceCloseEscalation(processRef, reason, attempt + 1);
  }, FORCE_CLOSE_RETRY_INTERVAL_MS);
}

function scheduleFinalizeWhenTrackedProcessExits(processRef, reasonLabel) {
  const poll = () => {
    const latestProcess = getRunningGameProcess();
    if (!latestProcess || latestProcess.pid !== processRef.pid) {
      return;
    }

    const runtimeAlivePids = getTrackedRuntimeAlivePids(latestProcess);
    if (!runtimeAlivePids.length) {
      const lastSeenRuntimeAt =
        latestProcess.lastSeenRuntimeAt ||
        latestProcess.lastSeenAliveAt ||
        latestProcess.launchTime ||
        Date.now();
      if (Date.now() - lastSeenRuntimeAt >= EXIT_STABILITY_GRACE_MS) {
        finalizeRunningGameProcessIfCurrent(processRef, reasonLabel);
      } else {
        setTimeout(poll, LIVENESS_RECHECK_INTERVAL_MS);
      }
      return;
    }

    latestProcess.hasSeenRuntimePids = true;
    latestProcess.lastSeenRuntimeAt = Date.now();
    setTimeout(poll, LIVENESS_RECHECK_INTERVAL_MS);
  };

  setTimeout(poll, LIVENESS_RECHECK_INTERVAL_MS);
}

function closeRunningGameProcess() {
  const runningGameProcess = getRunningGameProcess();
  if (!runningGameProcess) return;
  if (runningGameProcess.closeInProgress) {
    logInfo("close requested but close is already in progress");
    return;
  }
  runningGameProcess.closeInProgress = true;

  // Make stop action feel immediate: hard-stop tracked processes now,
  // release running lock right away, and keep killing leftovers in background.
  sendSignalToTrackedProcess(runningGameProcess, "SIGKILL");
  runDetachedCloseSweeps(runningGameProcess);

  try {
    runningGameProcess.stdin.end();
  } catch (e) {
    logWarn("Unable to close stdin of running process", e);
  }

  finalizeRunningGameProcessIfCurrent(
    runningGameProcess,
    "close requested (instant release; detached cleanup active)",
  );

  // Safety fallback in case the initial release raced and the process is still tracked.
  setTimeout(() => {
    const latestProcess = getRunningGameProcess();
    if (!latestProcess || latestProcess.pid !== runningGameProcess.pid) return;
    finalizeRunningGameProcessIfCurrent(
      runningGameProcess,
      "close requested fallback release",
    );
  }, FORCE_CLOSE_HARD_TIMEOUT_MS);
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
    knownGameMetaById.set(Number(g.id), {
      id: Number(g.id),
      title: g.name || "",
      slug: g.slug || "",
      runner: g.runner || "",
      serviceId: g.service_id || g.appid || "",
    });
    addKnowGameID(g.id);
  });

  return games;
}

function toggleGamePause(opts) {
  const runningGameProcess = getRunningGameProcess();
  if (!runningGameProcess) return;
  if (runningGameProcess.closeInProgress) return;

  const currentPausedState = computePausedStateForTrackedProcess(
    runningGameProcess,
  );
  if (currentPausedState === null) {
    logWarn(
      "Pause/resume requested but no tracked pids are currently visible; keeping running state",
    );
    showToastOnUi({
      title: "Pause/Resume unavailable",
      description: "Running game process could not be located right now.",
      type: "info",
    });
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

  const allProcesses = getTrackedAlivePids(runningGameProcess);
  if (!allProcesses.length) {
    logWarn("Unable to toggle pause, tracked process set is empty");
    return;
  }

  let signal;

  if (currentPausedState) {
    signal = "SIGCONT";
  } else {
    signal = "SIGSTOP";
  }

  sendSignalToTrackedProcess(runningGameProcess, signal);
  const expectedPausedState = !currentPausedState;

  PAUSE_STATE_RECHECK_DELAYS_MS.forEach((delayMs) => {
    setTimeout(() => {
      const latestProcess = getRunningGameProcess();
      if (!latestProcess || latestProcess.pid !== runningGameProcess.pid) return;
      emitPauseStateForProcess(latestProcess);
    }, delayMs);
  });

  setTimeout(() => {
    const latestProcess = getRunningGameProcess();
    if (!latestProcess || latestProcess.pid !== runningGameProcess.pid) return;
    const confirmedPausedState = computePausedStateForTrackedProcess(latestProcess);
    if (confirmedPausedState === null) return;
    if (confirmedPausedState !== expectedPausedState) {
      showToastOnUi({
        title: expectedPausedState
          ? "Pause may be unsupported"
          : "Resume may need another try",
        description:
          "This game/launcher did not acknowledge the pause state change.",
        type: "info",
      });
    }
  }, 700);
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

  // Always create a dedicated process group for the launched game stack.
  // This keeps pause/close controls reliable for launchers like Steam that
  // can outlive the initial wrapper process.
  const newGameProcess = spawn(
    "bash",
    [getLutrisWrapperPath(), `lutris:rungameid/${gameId}`],
    {
      detached: true,
    },
  );
  newGameProcess.pgid = newGameProcess.pid;
  newGameProcess.detachedGroup = true;
  newGameProcess.launchTime = gameStartTime;
  newGameProcess.lastSeenAliveAt = gameStartTime;
  newGameProcess.lastSeenRuntimeAt = gameStartTime;
  newGameProcess.hasSeenRuntimePids = false;
  newGameProcess.observedPids = [newGameProcess.pid];
  newGameProcess.closeInProgress = false;
  newGameProcess.gameMeta = knownGameMetaById.get(Number(gameId)) || {
    id: Number(gameId),
  };

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

  newGameProcess.livenessMonitorTimer = setInterval(() => {
    const latestProcess = getRunningGameProcess();
    if (!latestProcess || latestProcess.pid !== newGameProcess.pid) return;
    const trackedAlivePids = getTrackedAlivePids(latestProcess);
    const runtimeAlivePids = getTrackedRuntimeAlivePids(
      latestProcess,
      trackedAlivePids,
    );

    if (runtimeAlivePids.length) {
      latestProcess.hasSeenRuntimePids = true;
      latestProcess.lastSeenRuntimeAt = Date.now();
      return;
    }

    if (latestProcess.closeInProgress || !latestProcess.hasSeenRuntimePids) {
      return;
    }

    const lastSeenRuntimeAt =
      latestProcess.lastSeenRuntimeAt ||
      latestProcess.lastSeenAliveAt ||
      latestProcess.launchTime ||
      Date.now();
    if (Date.now() - lastSeenRuntimeAt >= EXIT_STABILITY_GRACE_MS) {
      finalizeRunningGameProcessIfCurrent(
        latestProcess,
        "runtime processes no longer detected",
      );
    }
  }, LIVENESS_MONITOR_INTERVAL_MS);

  let hasClosed = false;
  const onGameClosed = () => {
    if (hasClosed) return;
    hasClosed = true;

    finalizeRunningGameProcessIfCurrent(newGameProcess, "tracked process closed");
  };

  newGameProcess.once("close", () => {
    const latestProcess = getRunningGameProcess();
    if (!latestProcess || latestProcess.pid !== newGameProcess.pid) {
      return;
    }

    const runtimeAlivePids = getTrackedRuntimeAlivePids(latestProcess);
    if (!runtimeAlivePids.length) {
      scheduleFinalizeWhenTrackedProcessExits(
        latestProcess,
        "launcher exited and runtime pids were no longer visible",
      );
      return;
    }

    logWarn(
      "Launcher process exited but runtime processes are still alive; preserving running state",
      runtimeAlivePids,
    );
    emitPauseStateForProcess(latestProcess);
    scheduleFinalizeWhenTrackedProcessExits(
      latestProcess,
      "launcher exited; tracked processes eventually ended",
    );
  });

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
