const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  spawnDdcutil,
  getRunExclusive,
  logInfo,
  logWarn,
} = require("./utils.cjs");

const execFilePromise = promisify(execFile);

// ddcutils is not thread-safe
const runExclusive = getRunExclusive();
const DISPLAY_TARGET_CACHE_MS = 5000;

let cachedDisplayArgs = [];
let cachedDisplayArgsAt = 0;
let cachedDetectedDisplays = [];
let cachedDetectedDisplaysAt = 0;

async function spawnXrandr(arguments_) {
  const { stdout } = await execFilePromise("xrandr", arguments_);
  return stdout.trim();
}

async function spawnKScreenDoctor(arguments_) {
  const { stdout } = await execFilePromise("kscreen-doctor", arguments_);
  return stdout.trim();
}

function normalizeConnectorName(name) {
  return name?.trim().replace(/^card\d+-/, "") || null;
}

function getConnectorFamily(name) {
  const normalized = normalizeConnectorName(name)?.toUpperCase();
  if (!normalized) return null;
  if (normalized.startsWith("DISPLAYPORT") || normalized.startsWith("DP-")) {
    return "DP";
  }
  if (normalized.startsWith("HDMI")) {
    return "HDMI";
  }
  if (normalized.startsWith("DVI")) {
    return "DVI";
  }
  if (normalized.startsWith("VGA")) {
    return "VGA";
  }
  return normalized.replace(/[-_0-9].*$/, "");
}

function parsePrimaryConnector(xrandrOutput) {
  const lines = xrandrOutput.split("\n");
  const primaryLine =
    lines.find((line) => /\bconnected primary\b/.test(line)) ||
    lines.find((line) => /\bconnected\b/.test(line));

  if (!primaryLine) return null;
  return primaryLine.trim().split(/\s+/)[0] || null;
}

function parseKdePrimaryConnector(kscreenOutput) {
  const lines = kscreenOutput.split("\n");
  const primaryLine =
    lines.find((line) => /\bpriority\s+1\b/.test(line)) ||
    lines.find((line) => /\bprimary\b/.test(line));

  if (!primaryLine) return null;

  const outputMatch = primaryLine.match(/^Output:\s+\d+\s+(\S+)/);
  if (outputMatch) return outputMatch[1];

  return null;
}

function parseDdcutilDisplays(detectOutput) {
  const displays = [];
  let currentDisplay = null;

  for (const line of detectOutput.split("\n")) {
    const displayMatch = line.match(/^Display\s+(\d+)/);
    if (displayMatch) {
      currentDisplay = {
        number: displayMatch[1],
        connector: null,
      };
      displays.push(currentDisplay);
      continue;
    }

    const connectorMatch = line.match(/^\s*DRM connector:\s+(.+)$/);
    if (connectorMatch && currentDisplay) {
      currentDisplay.connector = connectorMatch[1].trim();
    }
  }

  return displays;
}

async function getDetectedDisplays() {
  const now = Date.now();
  if (now - cachedDetectedDisplaysAt < DISPLAY_TARGET_CACHE_MS) {
    return cachedDetectedDisplays;
  }

  const detectOutput = await spawnDdcutil(["detect"], { logErrors: false });
  cachedDetectedDisplays = parseDdcutilDisplays(detectOutput);
  cachedDetectedDisplaysAt = now;
  logInfo("ddcutil detected displays", cachedDetectedDisplays);
  return cachedDetectedDisplays;
}

async function getTargetDisplayArgs() {
  const now = Date.now();
  if (now - cachedDisplayArgsAt < DISPLAY_TARGET_CACHE_MS) {
    return cachedDisplayArgs;
  }

  try {
    let primaryConnector = null;
    try {
      const kscreenOutput = await spawnKScreenDoctor(["-o"]);
      primaryConnector = normalizeConnectorName(
        parseKdePrimaryConnector(kscreenOutput),
      );
      if (primaryConnector) {
        logInfo("ddcutil primary connector resolved via kscreen-doctor", primaryConnector);
      }
    } catch {}

    if (!primaryConnector) {
      const xrandrOutput = await spawnXrandr(["--query"]);
      primaryConnector = normalizeConnectorName(
        parsePrimaryConnector(xrandrOutput),
      );
      if (primaryConnector) {
        logInfo("ddcutil primary connector resolved via xrandr", primaryConnector);
      }
    }

    if (!primaryConnector) {
      logWarn("ddcutil unable to resolve primary connector");
      cachedDisplayArgs = [];
      cachedDisplayArgsAt = now;
      return cachedDisplayArgs;
    }

    const displays = await getDetectedDisplays();
    let matchingDisplay = displays.find(
      (display) =>
        normalizeConnectorName(display.connector) === primaryConnector,
    );

    if (!matchingDisplay) {
      const primaryFamily = getConnectorFamily(primaryConnector);
      const familyMatches = displays.filter(
        (display) => getConnectorFamily(display.connector) === primaryFamily,
      );
      if (familyMatches.length === 1) {
        matchingDisplay = familyMatches[0];
        logInfo(
          "ddcutil mapped primary connector by family",
          primaryConnector,
          matchingDisplay.connector,
        );
      }
    }

    cachedDisplayArgs = matchingDisplay
      ? ["--display", matchingDisplay.number]
      : [];
    if (matchingDisplay) {
      logInfo(
        "ddcutil targeting primary display",
        matchingDisplay.number,
        matchingDisplay.connector,
      );
    } else {
      logWarn(
        "ddcutil could not map primary connector to detected display",
        primaryConnector,
        displays,
      );
    }
    cachedDisplayArgsAt = now;
    return cachedDisplayArgs;
  } catch (error) {
    logWarn("ddcutil target display resolution failed", error?.message || error);
    cachedDisplayArgs = [];
    cachedDisplayArgsAt = now;
    return cachedDisplayArgs;
  }
}

function getAllDisplayArgsList(displays) {
  return displays
    .filter((display) => display?.number)
    .map((display) => ["--display", display.number]);
}

async function setBrightnessForDisplay(displayArgs, newValue) {
  try {
    logInfo("ddcutil set brightness attempt", {
      displayArgs,
      newValue,
      verify: true,
    });
    await spawnDdcutil([...displayArgs, "setvcp", "10", newValue.toString()], {
      logErrors: false,
    });
  } catch (error) {
    const message = error?.stderr || error?.message || "";
    if (!message.includes("Verification failed")) {
      throw error;
    }
    logInfo("ddcutil retrying brightness write without verification", {
      displayArgs,
      newValue,
    });
    await spawnDdcutil([
      ...displayArgs,
      "--noverify",
      "setvcp",
      "10",
      newValue.toString(),
    ]);
  }
}

async function getBrightnessInternal() {
  // format: VCP <code-hex> <type> <current-value> <max-value>
  const displayArgs = await getTargetDisplayArgs();
  logInfo("ddcutil get brightness using display args", displayArgs);
  const result = await spawnDdcutil([...displayArgs, "getvcp", "10", "--brief"]);
  const parts = result.split("\n")[0].split(" ");

  const current = Number.parseInt(parts[3]);
  const max = Number.parseInt(parts[4]);

  return { current, max };
}

async function getBrightness() {
  return runExclusive(async () => {
    const current = await getBrightnessInternal();
    return Math.floor((current.current / current.max) * 100);
  });
}

async function setBrightness(brightness) {
  return runExclusive(async () => {
    const current = await getBrightnessInternal();
    const newValue = Math.floor((brightness / 100) * current.max);
    const displayArgs = await getTargetDisplayArgs();
    if (displayArgs.length) {
      logInfo("ddcutil setting brightness for resolved primary display", {
        displayArgs,
        brightness,
        newValue,
      });
      await setBrightnessForDisplay(displayArgs, newValue);
      return;
    }

    const allDisplays = getAllDisplayArgsList(await getDetectedDisplays());
    if (!allDisplays.length) {
      logWarn("ddcutil found no detected displays, attempting unscoped brightness write");
      await setBrightnessForDisplay([], newValue);
      return;
    }

    logInfo("ddcutil primary display unresolved, setting brightness on all displays", {
      brightness,
      newValue,
      allDisplays,
    });
    for (const args of allDisplays) {
      await setBrightnessForDisplay(args, newValue);
    }
  });
}

async function getNightLight() {
  throw new Error("Night light reading not supported on this environment");
}

async function setNightLight() {
  throw new Error("Night light control not supported on this environment");
}

module.exports = {
  getBrightness,
  setBrightness,
  getNightLight,
  setNightLight,
};
