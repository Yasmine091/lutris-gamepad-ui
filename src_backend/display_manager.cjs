const { logInfo, logWarn } = require("./utils.cjs");

const DESKTOP_GNOME = "gnome";
const DESKTOP_KDE = "kde";
const DESKTOP_OTHER = "other";

function getDesktopEnvironment() {
  const xdgCurrentDesktop = process.env.XDG_CURRENT_DESKTOP?.toLowerCase();
  if (xdgCurrentDesktop?.includes("gnome")) {
    return DESKTOP_GNOME;
  } else if (xdgCurrentDesktop?.includes("kde")) {
    return DESKTOP_KDE;
  }
  return DESKTOP_OTHER;
}

const desktop = getDesktopEnvironment();

let implementation;
const ddcutilImplementation = require("./display_manager_impl_ddcutil.cjs");
const warnedCapabilities = new Set();
const fallbackNotices = new Set();

if (desktop === DESKTOP_GNOME) {
  logInfo("Using GNOME implementation for display management");
  implementation = require("./display_manager_impl_gnome.cjs");
} else if (desktop === DESKTOP_KDE) {
  logInfo("Using KDE implementation for display management");
  implementation = require("./display_manager_impl_kde.cjs");
} else {
  logInfo("Using ddcutil implementation for display management");
  implementation = require("./display_manager_impl_ddcutil.cjs");
}

function logFallbackOnce(key, message) {
  if (fallbackNotices.has(key)) return;
  fallbackNotices.add(key);
  logInfo(message);
}

module.exports = {
  getBrightness: async () => {
    try {
      return await implementation.getBrightness();
    } catch (error) {
      if (desktop === DESKTOP_KDE) {
        try {
          logFallbackOnce(
            "kde-brightness-ddcutil",
            "KDE brightness interface unavailable, falling back to ddcutil",
          );
          return await ddcutilImplementation.getBrightness();
        } catch (fallbackError) {
          error = fallbackError;
        }
      }
      const key = `brightness:${error?.message || error}`;
      if (!warnedCapabilities.has(key)) {
        warnedCapabilities.add(key);
        logWarn("Display brightness unavailable:", error?.message || error);
      }
      return null;
    }
  },
  setBrightness: async (brightness) => {
    try {
      return await implementation.setBrightness(brightness);
    } catch (error) {
      if (desktop === DESKTOP_KDE) {
        try {
          logFallbackOnce(
            "kde-set-brightness-ddcutil",
            "KDE brightness control unavailable, falling back to ddcutil",
          );
          return await ddcutilImplementation.setBrightness(brightness);
        } catch (fallbackError) {
          error = fallbackError;
        }
      }
      const key = `set-brightness:${error?.message || error}`;
      if (!warnedCapabilities.has(key)) {
        warnedCapabilities.add(key);
        logWarn("Unable to set display brightness:", error?.message || error);
      }
      return false;
    }
  },
  getNightLight: async () => {
    try {
      return await implementation.getNightLight();
    } catch (error) {
      const key = `night-light:${error?.message || error}`;
      if (!warnedCapabilities.has(key)) {
        warnedCapabilities.add(key);
        logWarn("Night light unavailable:", error?.message || error);
      }
      return null;
    }
  },
  setNightLight: async (enabled) => {
    try {
      return await implementation.setNightLight(enabled);
    } catch (error) {
      const key = `set-night-light:${error?.message || error}`;
      if (!warnedCapabilities.has(key)) {
        warnedCapabilities.add(key);
        logWarn("Unable to set night light:", error?.message || error);
      }
      return false;
    }
  },
  getNightLightSettings: async () => {
    if (typeof implementation.getNightLightSettings !== "function") {
      return null;
    }
    try {
      return await implementation.getNightLightSettings();
    } catch (error) {
      const key = `night-light-settings:${error?.message || error}`;
      if (!warnedCapabilities.has(key)) {
        warnedCapabilities.add(key);
        logWarn("Night light settings unavailable:", error?.message || error);
      }
      return null;
    }
  },
  setNightLightSettings: async (settings) => {
    if (typeof implementation.setNightLightSettings !== "function") {
      return false;
    }
    try {
      return await implementation.setNightLightSettings(settings);
    } catch (error) {
      const key = `set-night-light-settings:${error?.message || error}`;
      if (!warnedCapabilities.has(key)) {
        warnedCapabilities.add(key);
        logWarn("Unable to update night light settings:", error?.message || error);
      }
      return false;
    }
  },
  openNightLightSettings: async () => {
    if (typeof implementation.openNightLightSettings !== "function") {
      return false;
    }
    try {
      return await implementation.openNightLightSettings();
    } catch (error) {
      const key = `open-night-light-settings:${error?.message || error}`;
      if (!warnedCapabilities.has(key)) {
        warnedCapabilities.add(key);
        logWarn(
          "Unable to open native night light settings:",
          error?.message || error,
        );
      }
      return false;
    }
  },
};
