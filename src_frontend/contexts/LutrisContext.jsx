import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as ipc from "../utils/ipc";
import { useIsMounted } from "../hooks/useIsMounted";

const LutrisContext = createContext(null);
export const useLutris = () => useContext(LutrisContext);

function extractReleaseYear(game) {
  const candidates = [
    game?.releaseYear,
    game?.release_year,
    game?.year,
    game?.releaseDate,
    game?.release_date,
    game?.released,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const asString = String(candidate).trim();
    const match = asString.match(/\b(19|20)\d{2}\b/);
    if (match) {
      return Number(match[0]);
    }
  }

  return null;
}

function extractPlatform(game) {
  const hasFlatpakHint = [
    game?.platform,
    game?.platform_name,
    game?.system,
    game?.runner,
    game?.runner_name,
    game?.service,
    game?.slug,
    game?.exe,
    game?.exe_path,
    game?.command,
    game?.directory,
    game?.configpath,
  ].some((value) => {
    if (!value) return false;
    const normalized = String(value).toLowerCase();
    return (
      normalized.includes("flatpak") ||
      normalized.includes("/var/lib/flatpak") ||
      normalized.includes("/.local/share/flatpak")
    );
  });

  if (hasFlatpakHint) {
    return "Flatpak";
  }

  if (Array.isArray(game?.platforms) && game.platforms.length > 0) {
    return String(game.platforms[0]);
  }

  const directCandidates = [
    game?.platform,
    game?.platform_name,
    game?.system,
    game?.runner,
  ];

  for (const candidate of directCandidates) {
    if (!candidate) continue;
    const value = String(candidate).trim();
    if (value) {
      const normalized = value.toLowerCase();
      if (normalized === "linux") return "Linux";
      if (normalized === "wine") return "Wine";
      if (normalized === "steam") return "Steam";
      if (normalized === "native") return "Native";
      return value.charAt(0).toUpperCase() + value.slice(1);
    }
  }

  return null;
}

export const LutrisProvider = ({ children }) => {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningGame, setRunningGame] = useState(null);
  const [isGamePaused, setIsGamePaused] = useState(false);
  const isMounted = useIsMounted();

  const fetchGames = useCallback(async () => {
    setLoading(true);
    try {
      const allGames = await ipc.getGames();

      const mappedGames = allGames.map((game) => ({
        id: game.id,
        title: game.name || game.slug,
        playtimeSeconds: game.playtime * 3600,
        lastPlayed: game.lastplayed ? new Date(game.lastplayed * 1000) : null,
        coverPath: game.coverPath,
        bannerPath: game.bannerPath || game.banner_path || game.banner || null,
        runtimeIconPath: game.runtimeIconPath || null,
        runner: game.runner || null,
        platform: extractPlatform(game),
        releaseYear: extractReleaseYear(game),
        categories: game.categories || [],
        hidden: game.hidden || false,
      }));

      if (isMounted()) {
        setGames(mappedGames);
      }
    } catch (error) {
      ipc.logError("Error fetching games in context:", error);
    } finally {
      if (isMounted()) {
        setLoading(false);
      }
    }
  }, [isMounted]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  useEffect(() => {
    const handleGameStarted = (gameId) => {
      ipc.logInfo(`[IPC] Received game-started for ID: ${gameId}`);
      const game = games.find((g) => g.id === gameId);
      if (game) {
        setRunningGame(game);
        setIsGamePaused(false);
      }
    };

    const handleGameClosed = () => {
      ipc.logInfo("[IPC] Received game-closed");
      setRunningGame(null);
      setIsGamePaused(false);
      fetchGames();
    };

    const handleGamePauseStateChanged = (paused) => {
      setIsGamePaused(paused);
    };

    const unsubscribeOnGameStarted = ipc.onGameStarted(handleGameStarted);
    const unsubscribeOnGameClosed = ipc.onGameClosed(handleGameClosed);
    const unsubscribeOnGamePauseStateChanged = ipc.onGamePauseStateChanged(
      handleGamePauseStateChanged,
    );

    return () => {
      unsubscribeOnGameStarted();
      unsubscribeOnGameClosed();
      unsubscribeOnGamePauseStateChanged();
    };
  }, [games, fetchGames]);

  const launchGame = useCallback(
    (game) => {
      if (runningGame) return;
      ipc.launchGame(game);
    },
    [runningGame],
  );

  const closeRunningGame = useCallback(() => {
    if (!runningGame) return;
    ipc.closeGame(runningGame);
  }, [runningGame]);

  const value = {
    games,
    loading,
    runningGame,
    isGamePaused,
    fetchGames,
    launchGame,
    closeRunningGame,
  };

  return (
    <LutrisContext.Provider value={value}>{children}</LutrisContext.Provider>
  );
};
