const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");

const { getSessionBus } = require("./dbus_manager.cjs");
const { execFilePromise, logInfo, logWarn } = require("./utils.cjs");

const BRIGHTNESS_SERVICE = "org.kde.Solid.PowerManagement";
const BRIGHTNESS_PATH =
  "/org/kde/Solid/PowerManagement/Actions/BrightnessControl";
const BRIGHTNESS_INTERFACE =
  "org.kde.Solid.PowerManagement.Actions.BrightnessControl";
const DEFAULT_NIGHT_TEMPERATURE = 4500;
const DEFAULT_EVENING_BEGIN_FIXED = "2000";
const DEFAULT_MORNING_BEGIN_FIXED = "0600";
const NIGHT_COLOR_SETTINGS_COMMANDS = [
  ["/usr/bin/kcmshell5", ["kcm_nightcolor"]],
  ["/usr/bin/systemsettings5", ["kcm_nightcolor"]],
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getInterface(serviceName, path, interfaceName) {
  const bus = await getSessionBus("display_manager_kde", false);
  const service = bus.getService(serviceName);
  return new Promise((resolve, reject) => {
    service.getInterface(path, interfaceName, (error, iface) => {
      if (error)
        return reject(
          new Error(
            `Failed to get interface ${interfaceName}: ${error.message}`,
          ),
        );
      resolve(iface);
    });
  });
}

async function getBrightness() {
  const iface = await getInterface(
    BRIGHTNESS_SERVICE,
    BRIGHTNESS_PATH,
    BRIGHTNESS_INTERFACE,
  );

  const max = await new Promise((resolve, reject) => {
    iface.brightnessMax((error, value) => {
      if (error) return reject(error);
      resolve(value);
    });
  });

  const current = await new Promise((resolve, reject) => {
    iface.brightness((error, value) => {
      if (error) return reject(error);
      resolve(value);
    });
  });

  if (max <= 0) return current;
  return Math.round((current / max) * 100);
}

async function setBrightness(brightness) {
  const iface = await getInterface(
    BRIGHTNESS_SERVICE,
    BRIGHTNESS_PATH,
    BRIGHTNESS_INTERFACE,
  );
  const value = Number.parseInt(brightness, 10);

  const max = await new Promise((resolve, reject) => {
    iface.brightnessMax((error, value) => {
      if (error) return reject(error);
      resolve(value);
    });
  });

  const target = Math.round((value / 100) * max);

  await new Promise((resolve, reject) => {
    iface.setBrightness(target, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

async function getNightLightFromDbus() {
  let iface;
  try {
    logInfo("KDE night light: trying org.kde.KWin.NightLight");
    iface = await getInterface(
      "org.kde.KWin.NightLight",
      "/org/kde/KWin/NightLight",
      "org.kde.KWin.NightLight",
    );
  } catch (error) {
    logWarn(
      "KDE night light: org.kde.KWin.NightLight unavailable, trying ColorCorrect",
      error?.message || error,
    );
    iface = await getInterface(
      "org.kde.kwin.ColorCorrect",
      "/ColorCorrect",
      "org.kde.kwin.ColorCorrect",
    );
  }

  return new Promise((resolve, reject) => {
    if (typeof iface.running === "function") {
      logInfo("KDE night light: reading state via running()");
      iface.running((error, value) => {
        if (error) return reject(error);
        resolve(value);
      });
      return;
    }

    if (typeof iface.nightColorRunning === "function") {
      logInfo("KDE night light: reading state via nightColorRunning()");
      iface.nightColorRunning((error, value) => {
        if (error) return reject(error);
        resolve(value);
      });
      return;
    }

    reject(new Error("No supported KDE night light state method found"));
  });
}

async function getNightLightFromConfig() {
  logInfo("KDE night light: reading state from kwinrc");
  const { stdout } = await execFilePromise("kreadconfig5", [
    "--file",
    "kwinrc",
    "--group",
    "NightColor",
    "--key",
    "Active",
  ]);
  logInfo("KDE night light: kwinrc Active =", stdout.trim());
  return stdout.trim() === "true";
}

async function readNightColorConfigKey(key, defaultValue = "") {
  const { stdout } = await execFilePromise("kreadconfig5", [
    "--file",
    "kwinrc",
    "--group",
    "NightColor",
    "--key",
    key,
  ]);

  const value = stdout.trim();
  return value.length ? value : defaultValue;
}

async function getNightLightSettings() {
  const [enabled, temperatureValue, eveningBeginFixed, morningBeginFixed] =
    await Promise.all([
      getNightLightState(),
      readNightColorConfigKey(
        "NightTemperature",
        String(DEFAULT_NIGHT_TEMPERATURE),
      ),
      readNightColorConfigKey(
        "EveningBeginFixed",
        DEFAULT_EVENING_BEGIN_FIXED,
      ),
      readNightColorConfigKey(
        "MorningBeginFixed",
        DEFAULT_MORNING_BEGIN_FIXED,
      ),
    ]);

  return {
    enabled,
    temperature: Number.parseInt(temperatureValue, 10) || DEFAULT_NIGHT_TEMPERATURE,
    scheduleStart: eveningBeginFixed,
    scheduleEnd: morningBeginFixed,
  };
}

async function setNightLightInConfig(enabled) {
  logInfo("KDE night light: writing fallback state to kwinrc", enabled);
  await execFilePromise("kwriteconfig5", [
    "--file",
    "kwinrc",
    "--group",
    "NightColor",
    "--key",
    "Active",
    enabled ? "true" : "false",
  ]);
  try {
    logInfo("KDE night light: requesting KWin reconfigure");
    await execFilePromise("qdbus", ["org.kde.KWin", "/KWin", "reconfigure"]);
  } catch (error) {
    logWarn("KDE night light: unable to reconfigure KWin after kwinrc write", error?.message || error);
  }
}

async function setNightLightSettings(settings = {}) {
  const wasEnabled = await getNightLightState();
  const writes = [];

  if (typeof settings.enabled === "boolean") {
    writes.push([
      "--file",
      "kwinrc",
      "--group",
      "NightColor",
      "--key",
      "Active",
      settings.enabled ? "true" : "false",
    ]);
  }

  if (typeof settings.temperature === "number" && Number.isFinite(settings.temperature)) {
    const temperature = Math.max(1000, Math.min(6500, Math.round(settings.temperature)));
    writes.push([
      "--file",
      "kwinrc",
      "--group",
      "NightColor",
      "--key",
      "NightTemperature",
      String(temperature),
    ]);
    writes.push([
      "--file",
      "kwinrc",
      "--group",
      "NightColor",
      "--key",
      "Mode",
      "Constant",
    ]);
  }

  const scheduleTouched =
    typeof settings.scheduleStart === "string" ||
    typeof settings.scheduleEnd === "string";

  if (typeof settings.scheduleStart === "string") {
    writes.push([
      "--file",
      "kwinrc",
      "--group",
      "NightColor",
      "--key",
      "EveningBeginFixed",
      settings.scheduleStart,
    ]);
  }

  if (typeof settings.scheduleEnd === "string") {
    writes.push([
      "--file",
      "kwinrc",
      "--group",
      "NightColor",
      "--key",
      "MorningBeginFixed",
      settings.scheduleEnd,
    ]);
  }

  if (scheduleTouched) {
    writes.push([
      "--file",
      "kwinrc",
      "--group",
      "NightColor",
      "--key",
      "Mode",
      "Times",
    ]);
  }

  for (const args of writes) {
    await execFilePromise("kwriteconfig5", args);
  }

  if (writes.length) {
    try {
      logInfo("KDE night light: requesting KWin reconfigure after settings write");
      await execFilePromise("qdbus", ["org.kde.KWin", "/KWin", "reconfigure"]);
    } catch (error) {
      logWarn(
        "KDE night light: unable to reconfigure KWin after settings write",
        error?.message || error,
      );
    }

    if (wasEnabled) {
      try {
        logInfo("KDE night light: forcing refresh by toggling Night Color off/on");
        await invokeNightLightShortcut();
        await sleep(300);
        await invokeNightLightShortcut();
      } catch (error) {
        logWarn(
          "KDE night light: unable to force refresh via shortcut after settings write",
          error?.message || error,
        );
      }
    }
  }
}

async function getNightLightState() {
  try {
    logInfo("KDE night light: resolving state via DBus");
    return await getNightLightFromDbus();
  } catch (error) {
    logWarn("KDE night light: DBus state unavailable, falling back to kwinrc", error?.message || error);
    return await getNightLightFromConfig();
  }
}

async function getNightLight() {
  return await getNightLightState();
}

async function setNightLight(enabled) {
  logInfo("KDE night light: requested set", enabled);
  const current = await getNightLightState();
  logInfo("KDE night light: current state", current);
  if (current === enabled) {
    logInfo("KDE night light: requested state already active");
    return;
  }

  try {
    logInfo("KDE night light: trying Toggle Night Color shortcut via kglobalaccel");
    await invokeNightLightShortcut();
    logInfo("KDE night light: toggle shortcut invoked successfully");
    return;
  } catch (error) {
    logWarn("KDE night light: shortcut toggle unavailable, falling back to kwinrc", error?.message || error);
  }

  await setNightLightInConfig(enabled);
}

async function invokeNightLightShortcut() {
  const iface = await getInterface(
    "org.kde.kglobalaccel",
    "/component/kwin",
    "org.kde.kglobalaccel.Component",
  );

  await new Promise((resolve, reject) => {
    iface.invokeShortcut("Toggle Night Color", (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

async function openNightLightSettings() {
  for (const [command, args] of NIGHT_COLOR_SETTINGS_COMMANDS) {
    if (!existsSync(command)) continue;
    logInfo("KDE night light: opening native settings", command, args);
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  }

  throw new Error("Unable to find KDE Night Color settings application.");
}

module.exports = {
  getBrightness,
  setBrightness,
  getNightLight,
  setNightLight,
  getNightLightSettings,
  setNightLightSettings,
  openNightLightSettings,
};
