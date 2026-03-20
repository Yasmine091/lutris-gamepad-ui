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
const warnedCapabilities = new Set();

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

module.exports = {
  getBrightness: async () => {
    try {
      return await implementation.getBrightness();
    } catch (error) {
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
};
