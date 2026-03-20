import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useIsMounted } from "../hooks/useIsMounted";
import * as ipc from "../utils/ipc";

const SettingsStateContext = createContext(null);
const SettingsActionsContext = createContext(null);

export const useSettingsState = () => useContext(SettingsStateContext);
export const useSettingsActions = () => useContext(SettingsActionsContext);

function applyAccentColor(color) {
  if (!color) return;
  document.documentElement.style.setProperty("--accent-color", color);
}

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    ipc
      .getAppConfig()
      .then((config) => {
        if (isMounted()) {
          setSettings(config || {});
          applyAccentColor(config?.accentColor);
        }
      })
      .catch((error) => {
        ipc.logError("Failed to get initial app config:", error);
        if (isMounted()) {
          setSettings({});
        }
      });

    const unsubscribe = ipc.onAppConfigChanged((newConfig) => {
      setSettings(newConfig);
      applyAccentColor(newConfig?.accentColor);
    });

    return () => {
      unsubscribe();
    };
  }, [isMounted]);

  const updateSetting = useCallback((key, value) => {
    ipc.setAppConfig(key, value);
  }, []);

  const stateValue = useMemo(() => ({ settings }), [settings]);

  const actionsValue = useMemo(() => ({ updateSetting }), [updateSetting]);

  if (settings === null) {
    return null;
  }

  return (
    <SettingsStateContext.Provider value={stateValue}>
      <SettingsActionsContext.Provider value={actionsValue}>
        {children}
      </SettingsActionsContext.Provider>
    </SettingsStateContext.Provider>
  );
};
