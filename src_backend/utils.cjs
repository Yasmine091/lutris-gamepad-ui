const { exec } = require("child_process");
const { promisify } = require("util");
const { existsSync, readdirSync } = require("fs");
const path = require("node:path");
const { cwd } = require("node:process");

const {
  info: logInfo,
  warn: logWarn,
  error: logError,
} = require("./logger.cjs");
const { getMainWindow } = require("./state.cjs");
const { readFileSync } = require("node:fs");

const execPromise = promisify(exec);

const isDev = process.env.IS_DEV === "1";
const forceWindowed = process.env.FORCE_WINDOWED === "1";

function localeAppFile(name) {
  const DIRECTORIES = [
    cwd(),
    __dirname,
    path.join(__dirname, ".."),
    process.resourcesPath,
    process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar.unpacked")
      : null,
  ].filter((directory) => typeof directory === "string" && directory.length);

  for (const directory of DIRECTORIES) {
    const absolutePath = path.join(directory, name);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  throw new Error("unable to find: " + name);
}

function getLutrisWrapperPath() {
  return localeAppFile("lutris_wrapper.sh");
}

function getElectronPreloadPath() {
  return localeAppFile("electron_preload.cjs");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryAsync(fn, options = {}) {
  const {
    maxTries = 3,
    initialDelay = 200,
    maxDelay = 2000,
    onRetry,
  } = options;

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxTries) {
        throw error;
      }
      if (onRetry) {
        onRetry(error, attempt);
      }
      const delay = Math.min(initialDelay * 2 ** (attempt - 1), maxDelay);
      await sleep(delay);
    }
  }
}

const debounce = (func, wait) => {
  let timeout;

  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

function isRunningInsideGamescope() {
  return process.env.XDG_CURRENT_DESKTOP === "gamescope";
}

function showToastOnUi(payload) {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send("show-toast", payload);
  }
}

function errorToDescription(error) {
  let description = "An unknown error occurred.";

  if (error instanceof Error) {
    description = error.message;
  } else if (typeof error === "string") {
    description = error;
  } else if (Array.isArray(error)) {
    description = error.map(errorToDescription).join("\n");
  }

  return description;
}

function toastError(title, error) {
  const description = errorToDescription(error);

  showToastOnUi({
    title,
    description,
    type: "error",
  });
}

async function rebootPc() {
  const commands = ["systemctl reboot", "loginctl reboot", "reboot"];
  const errors = [];

  for (const command of commands) {
    try {
      await execPromise(command);
      return;
    } catch (e) {
      logError("unable to reboot pc using", command, e);
      errors.push(e);
    }
  }

  throw errors;
}

async function powerOffPc() {
  const commands = ["systemctl poweroff", "loginctl poweroff", "poweroff"];
  const errors = [];

  for (const command of commands) {
    try {
      await execPromise(command);
      return;
    } catch (e) {
      logError("unable to poweroff pc using", command, e);
      errors.push(e);
    }
  }

  throw errors;
}

function isProcessPaused(pid) {
  const statusFile = readFileSync(`/proc/${pid}/status`, "utf8");

  const processStateLine = statusFile
    .split("\n")
    .map((l) => l.split(":"))
    .find((e) => e[0] === "State");

  if (!processStateLine) {
    throw new Error("Unable to find process state in status file");
  }

  const processStateValue = processStateLine[1].trim();

  logInfo(
    "process",
    pid,
    "stateline",
    processStateLine,
    "statevalue",
    processStateValue,
  );

  return processStateValue.startsWith("T");
}

function getProcessDescendants(pid, visitedPids) {
  if (visitedPids.has(pid)) return [];
  visitedPids.add(pid);

  const childrenPath = `/proc/${pid}/task/${pid}/children`;
  try {
    const childrenContent = readFileSync(childrenPath, "utf8");
    const childPids = childrenContent
      .trim()
      .split(" ")
      .map(Number)
      .filter(Boolean);

    const descendants = childPids.flatMap((childPid) =>
      getProcessDescendants(childPid, visitedPids),
    );

    return childPids.concat(descendants);
  } catch (e) {
    if (e?.code !== "ENOENT" && e?.code !== "ESRCH") {
      logError("Unable to read children of pid", pid, e);
    }
    return [];
  }
}

function getProcessGroupId(pid) {
  try {
    const statFile = readFileSync(`/proc/${pid}/stat`, "utf8").trim();
    const lastParenIndex = statFile.lastIndexOf(")");
    if (lastParenIndex < 0) {
      return null;
    }

    // After "<pid> (<comm>)" fields are: state ppid pgrp ...
    const fieldsAfterComm = statFile.slice(lastParenIndex + 2).trim().split(/\s+/);
    const processGroupId = Number(fieldsAfterComm[2]);
    if (!Number.isInteger(processGroupId) || processGroupId <= 0) {
      return null;
    }
    return processGroupId;
  } catch (e) {
    if (e?.code !== "ENOENT" && e?.code !== "ESRCH" && e?.code !== "EACCES") {
      logWarn("Unable to read process group for pid", pid, e);
    }
    return null;
  }
}

function getProcessGroupMembers(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) {
    return [];
  }

  const members = [];
  let entries = [];

  try {
    entries = readdirSync("/proc");
  } catch (e) {
    logError("Unable to list /proc entries while reading process groups", e);
    return [];
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 0) continue;

    const pidGroupId = getProcessGroupId(pid);
    if (pidGroupId === processGroupId) {
      members.push(pid);
    }
  }

  return members;
}

function getProcessEnvironment(pid) {
  try {
    const environRaw = readFileSync(`/proc/${pid}/environ`, "utf8");
    if (!environRaw || !environRaw.includes("=")) {
      return {};
    }

    const result = {};
    environRaw.split("\x00").forEach((entry) => {
      const eqIndex = entry.indexOf("=");
      if (eqIndex <= 0) return;
      const key = entry.slice(0, eqIndex);
      const value = entry.slice(eqIndex + 1);
      if (key) result[key] = value;
    });
    return result;
  } catch (e) {
    if (e?.code !== "ENOENT" && e?.code !== "ESRCH" && e?.code !== "EACCES") {
      logWarn("Unable to read process environment for pid", pid, e);
    }
    return {};
  }
}

function getProcessEnvironmentValue(pid, key) {
  if (!key) return null;
  const env = getProcessEnvironment(pid);
  if (!Object.hasOwn(env, key)) return null;
  return env[key];
}

function getPidsByEnvironmentValue(key, expectedValue = null) {
  if (!key) return [];

  let entries = [];
  try {
    entries = readdirSync("/proc");
  } catch (e) {
    logError("Unable to list /proc entries while scanning environments", e);
    return [];
  }

  const pids = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 0) continue;

    const actualValue = getProcessEnvironmentValue(pid, key);
    if (actualValue === null) continue;
    if (expectedValue !== null && actualValue !== expectedValue) continue;
    pids.push(pid);
  }

  return pids;
}

function getProcessCommandLine(pid) {
  try {
    const cmdlineRaw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (!cmdlineRaw) return "";
    return cmdlineRaw.replace(/\x00/g, " ").trim();
  } catch (e) {
    if (e?.code !== "ENOENT" && e?.code !== "ESRCH" && e?.code !== "EACCES") {
      logWarn("Unable to read command line for pid", pid, e);
    }
    return "";
  }
}

function getPidsByCommandLinePatterns(patterns = []) {
  const normalizedPatterns = [...new Set(
    (patterns || [])
      .map((pattern) => String(pattern || "").toLowerCase().trim())
      .filter((pattern) => pattern.length >= 4),
  )];
  if (!normalizedPatterns.length) {
    return [];
  }

  let entries = [];
  try {
    entries = readdirSync("/proc");
  } catch (e) {
    logError("Unable to list /proc entries while scanning cmdline", e);
    return [];
  }

  const matched = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 0) continue;

    const cmdline = getProcessCommandLine(pid).toLowerCase();
    if (!cmdline) continue;

    if (normalizedPatterns.some((pattern) => cmdline.includes(pattern))) {
      matched.push(pid);
    }
  }

  return matched;
}

module.exports = {
  isDev,
  forceWindowed,
  execPromise,
  getLutrisWrapperPath,
  getElectronPreloadPath,
  retryAsync,
  logInfo,
  logWarn,
  logError,
  debounce,
  showToastOnUi,
  toastError,
  isRunningInsideGamescope,
  rebootPc,
  powerOffPc,
  getProcessDescendants,
  getProcessGroupMembers,
  getProcessEnvironmentValue,
  getPidsByEnvironmentValue,
  getProcessCommandLine,
  getPidsByCommandLinePatterns,
  isProcessPaused,
};
