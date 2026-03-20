import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLutris, useLutrisActions } from "../contexts/LutrisContext";
import { useModalActions, useModalState } from "../contexts/ModalContext";
import GameLibrary from "./GameLibrary";
import LoadingIndicator from "./LoadingIndicator";
import ControlsOverlay from "./ControlsOverlay";
import OnScreenKeyboard from "./OnScreenKeyboard";
import { playButtonActionSound as playActionSound } from "../utils/sound";
import { toggleWindowShow } from "../utils/ipc";
import ConfirmationDialog from "./ConfirmationDialog";
import { useScopedInput } from "../hooks/useScopedInput";
import { useGlobalShortcut } from "../hooks/useGlobalShortcut";
import { useTranslation } from "../contexts/TranslationContext";
import { useSettingsState } from "../contexts/SettingsContext";

export const LibraryContainerFocusID = "LibraryContainer";

const LibraryContainer = () => {
  const { t } = useTranslation();
  const { settings } = useSettingsState();
  const { games, loading, runningGame } = useLutris();
  const { launchGame, closeRunningGame } = useLutrisActions();

  const [focusCoords, setFocusCoords] = useState({ shelf: 0, card: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTabId, setActiveTabId] = useState("all");
  const [numColumns, setNumColumns] = useState(0);
  const { showModal } = useModalActions();
  const { isModalOpen } = useModalState();

  const libraryContainerRef = useRef(null);
  const libraryContainerRefNeedScrollTop = useRef(false);
  const cardRefs = useRef([]);
  const shelfRefs = useRef([]);
  const gridRefs = useRef([]);
  const gameCloseCloseModalRef = useRef(null);
  const prevFocusCoords = useRef(null);
  const runningGameIds = useMemo(() => {
    const ids = new Set();
    if (Array.isArray(runningGame)) {
      runningGame.forEach((game) => {
        const id = Number(game?.id);
        if (Number.isFinite(id)) {
          ids.add(id);
        }
      });
      return ids;
    }

    const singleId = Number(runningGame?.id);
    if (Number.isFinite(singleId)) {
      ids.add(singleId);
    }
    return ids;
  }, [runningGame]);

  const currentGames = useMemo(() => {
    return (games || [])
      .filter((g) => {
        if (!settings.showHiddenGames && g.hidden) {
          return false;
        }

        if (
          searchQuery &&
          !g.title.toLowerCase().includes(searchQuery.toLowerCase())
        ) {
          return false;
        }

        return true;
      })
      .map((g) => ({
        ...g,
        isRunning: runningGameIds.has(Number(g.id)),
        isPaused: false,
      }));
  }, [searchQuery, settings, games, runningGameIds]);

  const setShelfRef = useCallback((el, shelfIndex) => {
    shelfRefs.current[shelfIndex] = el;
  }, []);

  const setCardRef = useCallback((el, shelfIndex, cardIndex) => {
    if (!cardRefs.current[shelfIndex]) {
      cardRefs.current[shelfIndex] = [];
    }
    cardRefs.current[shelfIndex][cardIndex] = el;
  }, []);

  const setGridRef = useCallback((el, shelfIndex) => {
    gridRefs.current[shelfIndex] = el;
  }, []);

  const tabs = useMemo(() => {
    const categoriesMap = new Map();
    currentGames.forEach((game) => {
      (game.categories || []).forEach((categoryName) => {
        if (!categoriesMap.has(categoryName)) {
          categoriesMap.set(categoryName, 0);
        }
        categoriesMap.set(categoryName, categoriesMap.get(categoryName) + 1);
      });
    });

    const categoryTabs = [...categoriesMap.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((categoryName) => ({
        id: `category:${categoryName}`,
        label: categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
      }));

    return [{ id: "all", label: t("All Games") }, ...categoryTabs];
  }, [t, currentGames]);

  useEffect(() => {
    if (tabs.length === 0) return;
    const hasActiveTab = tabs.some((tab) => tab.id === activeTabId);
    if (!hasActiveTab) {
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId]);

  const shelves = useMemo(() => {
    cardRefs.current = [];

    if (searchQuery) {
      const searchShelves = [
        {
          id: "search-results",
          title: t('Results for "{{searchQuery}}"', { searchQuery }),
          games: [...currentGames].sort((a, b) =>
            a.title.localeCompare(b.title)
          ),
          layout: "default",
        },
      ];
      return searchShelves;
    }

    const sortByLastPlayed = (gameList) =>
      [...gameList].sort(
        (a, b) =>
          (b.lastPlayed?.getTime() || 0) - (a.lastPlayed?.getTime() || 0),
      );

    const sortByPlaytime = (gameList) =>
      [...gameList].sort(
        (a, b) => (b.playtimeSeconds || 0) - (a.playtimeSeconds || 0),
      );

    const allGamesSorted = [...currentGames].sort((a, b) =>
      a.title.localeCompare(b.title),
    );

    const categoriesShelves = [];
    const categoriesMap = new Map();
    currentGames.forEach((game) => {
      (game.categories || []).forEach((categoryName) => {
        if (!categoriesMap.has(categoryName)) {
          categoriesMap.set(categoryName, []);
        }
        categoriesMap.get(categoryName).push(game);
      });
    });

    const sortedCategoryNames = [...categoriesMap.keys()].sort((a, b) =>
      a.localeCompare(b),
    );

    sortedCategoryNames.forEach((categoryName) => {
      const categoryGames = categoriesMap.get(categoryName);
      categoriesShelves.push({
        id: `category:${categoryName}`,
        title: categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
        games: sortByLastPlayed(categoryGames),
        layout: "default",
      });
    });

    const selectedMainShelf =
      activeTabId === "all"
        ? {
            id: "all-games",
            title: t("All Games"),
            games: allGamesSorted,
            layout: "default",
          }
        : categoriesShelves.find((shelf) => shelf.id === activeTabId) || {
            id: "all-games",
            title: t("All Games"),
            games: allGamesSorted,
            layout: "default",
          };

    const result = [];
    const shouldShowRecentlyPlayed = settings.showRecentlyPlayed !== false;
    const recentlyPlayedGames = sortByLastPlayed(currentGames)
      .filter((game) => !!game.lastPlayed)
      .slice(0, 6);
    const mostPlayedFallback = sortByPlaytime(currentGames)
      .filter((game) => (game.playtimeSeconds || 0) > 0)
      .slice(0, 6);
    const heroGames =
      recentlyPlayedGames.length > 0
        ? recentlyPlayedGames
        : mostPlayedFallback.length > 0
          ? mostPlayedFallback
          : allGamesSorted.slice(0, 6);

    if (shouldShowRecentlyPlayed && heroGames.length > 0) {
      result.push({
        id: "hero-recently-played",
        title: t("Recently Played"),
        games: heroGames,
        layout: "hero",
      });
    }

    result.push(selectedMainShelf);
    return result;
  }, [currentGames, searchQuery, t, activeTabId, settings.showRecentlyPlayed]);

  const shelvesRef = useRef(shelves);
  const focusCoordsRef = useRef(focusCoords);

  useEffect(() => {
    shelvesRef.current = shelves;
  }, [shelves]);

  useEffect(() => {
    focusCoordsRef.current = focusCoords;
  }, [focusCoords]);

  useEffect(() => {
    const calculateAndUpdateColumns = () => {
      let maxColumns = 0;

      gridRefs.current.forEach((gridEl, shelfIndex) => {
        if (shelves[shelfIndex]?.layout === "hero") return;
        if (gridEl) {
          const style = window.getComputedStyle(gridEl);
          const columns = style
            .getPropertyValue("grid-template-columns")
            .split(" ").length;
          if (columns > maxColumns) {
            maxColumns = columns;
          }
        }
      });

      setNumColumns((currentNumColumns) => {
        if (maxColumns !== currentNumColumns) {
          return maxColumns;
        }
        return currentNumColumns;
      });
    };

    calculateAndUpdateColumns();

    const observers = [];
    gridRefs.current.forEach((gridEl, shelfIndex) => {
      if (shelves[shelfIndex]?.layout === "hero") return;
      if (!gridEl) return;
      const observer = new ResizeObserver(calculateAndUpdateColumns);
      observer.observe(gridEl);
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [shelves]);

  useEffect(() => {
    setFocusCoords({ shelf: 0, card: 0 });
    prevFocusCoords.current = null;
  }, [currentGames, searchQuery, setFocusCoords, shelves]);

  const handleCardFocus = useCallback((coords) => {
    setFocusCoords((current) => {
      if (current.shelf === coords.shelf && current.card === coords.card) {
        return current;
      }
      return { ...coords, preventScroll: true };
    });
  }, []);

  const handleLaunchGame = useCallback(
    (game) => {
      if (game && !runningGame) {
        launchGame(game);
      }
    },
    [runningGame, launchGame],
  );

  useEffect(() => {
    if (loading) return;

    cardRefs.current?.forEach((shelfOfRefs) => {
      if (Array.isArray(shelfOfRefs)) {
        shelfOfRefs.forEach((cardNode) => {
          cardNode?.classList.remove("focused");
        });
      }
    });

    const { shelf, card, preventScroll } = focusCoords;
    const focusedShelfLayout = shelves[shelf]?.layout;
    const isHeroFocusedShelf = focusedShelfLayout === "hero";

    const targetNode = cardRefs.current[shelf]?.[card];
    if (targetNode) {
      targetNode.classList.add("focused");
      if (preventScroll) {
        targetNode.focus({ preventScroll: true });
      } else if (isHeroFocusedShelf) {
        targetNode.focus({ preventScroll: true });
      } else {
        targetNode.focus();
        targetNode.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }

    const prevShelf = prevFocusCoords.current?.shelf;
    if (shelf !== prevShelf) {
      const targetShelfNode = shelfRefs.current[shelf];
      targetShelfNode?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }

    const currentRow = numColumns > 0 ? Math.floor(card / numColumns) : 0;
    if (shelf === 0 && currentRow === 0) {
      if (libraryContainerRefNeedScrollTop.current) {
        const scrollParent =
          libraryContainerRef.current?.closest(".legenda-content");
        scrollParent?.scrollTo({ top: 0, behavior: "smooth" });
        libraryContainerRefNeedScrollTop.current = false;
      }
    } else {
      libraryContainerRefNeedScrollTop.current = true;
    }

    prevFocusCoords.current = focusCoords;
  }, [focusCoords, loading, shelves, numColumns]);

  const focusedGame = useMemo(
    () => shelves[focusCoords.shelf]?.games?.[focusCoords.card] || null,
    [shelves, focusCoords],
  );

  const isFocusedGameRunning = useMemo(
    () => !!focusedGame && runningGameIds.has(Number(focusedGame.id)),
    [runningGameIds, focusedGame],
  );

  const showSearchModalCb = useCallback(() => {
    showModal((hideThisModal) => (
      <OnScreenKeyboard
        label={t("Search Library")}
        initialValue={searchQuery}
        onConfirm={(query) => {
          setSearchQuery(query);
          hideThisModal();
        }}
        onClose={hideThisModal}
      />
    ));
  }, [setSearchQuery, showModal, searchQuery, t]);

  const clearSearchCb = useCallback(() => {
    setSearchQuery("");
  }, [setSearchQuery]);

  useEffect(() => {
    if (!runningGame && gameCloseCloseModalRef.current) {
      gameCloseCloseModalRef.current();
      gameCloseCloseModalRef.current = null;
    }
  }, [runningGame, gameCloseCloseModalRef]);

  const closeRunningGameDialogCb = useCallback(() => {
    if (!runningGame) {
      return;
    }
    if (gameCloseCloseModalRef.current) {
      gameCloseCloseModalRef.current();
    }
    showModal((hideThisModal) => {
      gameCloseCloseModalRef.current = hideThisModal;
      return (
        <ConfirmationDialog
          message={t("Are you sure you want to close\n{{title}}?", {
            title: runningGame.title,
          })}
          description={t(
            "This action will force-quit the game. Any unsaved progress may be lost.",
          )}
          onConfirm={() => {
            closeRunningGame();
            hideThisModal();
          }}
          onDeny={hideThisModal}
        />
      );
    });
  }, [closeRunningGame, showModal, runningGame, t]);

  const handleNavigation = useCallback(
    (direction) => {
      setFocusCoords((current) => {
        const { shelf } = current;
        const currentShelfGames = shelves[shelf]?.games;

        if (numColumns === 0 || !currentShelfGames?.length) {
          return current;
        }

        const move = (current, direction, numColumns, shelves) => {
          const { shelf, card } = current;
          const currentShelf = shelves[shelf];
          const currentShelfGames = currentShelf?.games;

          if (!currentShelfGames?.length) return current;

          const effectiveNumColumns =
            currentShelf?.layout === "hero"
              ? currentShelfGames.length
              : numColumns;

          const totalRows = Math.ceil(
            currentShelfGames.length / effectiveNumColumns,
          );
          const currentRow = Math.floor(card / effectiveNumColumns);
          const currentCol = card % effectiveNumColumns;

          switch (direction) {
            case "UP": {
              if (currentRow > 0) {
                return { shelf, card: card - effectiveNumColumns };
              } else {
                const prevShelfIndex =
                  (shelf - 1 + shelves.length) % shelves.length;
                const prevShelf = shelves[prevShelfIndex];
                const prevShelfGames = prevShelf.games;
                if (!prevShelfGames.length) return current;
                const prevShelfColumns =
                  prevShelf.layout === "hero"
                    ? prevShelfGames.length
                    : numColumns;

                const lastCardInPrevShelf = prevShelfGames.length - 1;
                const lastRowInPrevShelf = Math.floor(
                  lastCardInPrevShelf / prevShelfColumns,
                );

                return {
                  shelf: prevShelfIndex,
                  card: Math.min(
                    lastRowInPrevShelf * prevShelfColumns + currentCol,
                    lastCardInPrevShelf,
                  ),
                };
              }
            }
            case "DOWN": {
              if (currentRow < totalRows - 1) {
                return {
                  shelf,
                  card: Math.min(
                    card + effectiveNumColumns,
                    currentShelfGames.length - 1,
                  ),
                };
              } else {
                const nextShelfIndex = (shelf + 1) % shelves.length;
                const nextShelfGames = shelves[nextShelfIndex].games;
                if (!nextShelfGames.length) return current;
                return {
                  shelf: nextShelfIndex,
                  card: Math.min(currentCol, nextShelfGames.length - 1),
                };
              }
            }
            case "LEFT":
            case "RIGHT": {
              const rowStartCard = currentRow * effectiveNumColumns;
              const rowEndCard = Math.min(
                rowStartCard + effectiveNumColumns - 1,
                currentShelfGames.length - 1,
              );

              const gamesInCurrentRow = rowEndCard - rowStartCard + 1;
              if (gamesInCurrentRow <= 1) {
                return current;
              }

              if (direction === "LEFT") {
                return card === rowStartCard
                  ? { shelf, card: rowEndCard }
                  : { shelf, card: card - 1 };
              } else {
                return card === rowEndCard
                  ? { shelf, card: rowStartCard }
                  : { shelf, card: card + 1 };
              }
            }
            default:
              return current;
          }
        };

        const nextFocus = move(current, direction, numColumns, shelves);

        if (
          nextFocus.shelf !== current.shelf ||
          nextFocus.card !== current.card
        ) {
          playActionSound();
          return nextFocus;
        }

        return current;
      });
    },
    [shelves, numColumns],
  );

  const handlePrevShelf = useCallback(() => {
    setFocusCoords((current) => {
      if (shelves.length <= 1) return current;
      const nextShelf = (current.shelf - 1 + shelves.length) % shelves.length;
      return { shelf: nextShelf, card: 0 };
    });
  }, [shelves]);

  const handleNextShelf = useCallback(() => {
    setFocusCoords((current) => {
      if (shelves.length <= 1) return current;
      const nextShelf = (current.shelf + 1) % shelves.length;
      return { shelf: nextShelf, card: 0 };
    });
  }, [shelves]);

  const handlePrevTab = useCallback(() => {
    setActiveTabId((current) => {
      if (tabs.length <= 1) return current;
      const currentIndex = tabs.findIndex((tab) => tab.id === current);
      const resolvedIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (resolvedIndex - 1 + tabs.length) % tabs.length;
      return tabs[nextIndex].id;
    });
  }, [tabs]);

  const handleNextTab = useCallback(() => {
    setActiveTabId((current) => {
      if (tabs.length <= 1) return current;
      const currentIndex = tabs.findIndex((tab) => tab.id === current);
      const resolvedIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (resolvedIndex + 1) % tabs.length;
      return tabs[nextIndex].id;
    });
  }, [tabs]);

  const libraryInputHandler = useCallback(
    (input) => {
      const currentFocusedGame = shelves[focusCoords.shelf]?.games[focusCoords.card];
      const focusedIsRunning =
        !!runningGame &&
        !!currentFocusedGame &&
        Number(runningGame.id) === Number(currentFocusedGame.id);

      switch (input.name) {
        case "UP":
        case "DOWN":
        case "LEFT":
        case "RIGHT":
          handleNavigation(input.name);
          break;
        case "A":
          if (currentFocusedGame) {
            playActionSound();
            handleLaunchGame(currentFocusedGame);
          }
          break;
        case "B":
          if (focusedIsRunning) {
            playActionSound();
            closeRunningGameDialogCb();
          } else if (searchQuery) {
            playActionSound();
            clearSearchCb();
          }
          break;
        case "L1":
          if (shelves.length > 1) {
            playActionSound();
            handlePrevShelf();
          }
          break;
        case "R1":
          if (shelves.length > 1) {
            playActionSound();
            handleNextShelf();
          }
          break;
        case "L2":
          if (!searchQuery && tabs.length > 1) {
            playActionSound();
            handlePrevTab();
          }
          break;
        case "R2":
          if (!searchQuery && tabs.length > 1) {
            playActionSound();
            handleNextTab();
          }
          break;
        case "X":
          playActionSound();
          showSearchModalCb();
          break;
      }
    },
    [
      shelves,
      focusCoords,
      runningGame,
      searchQuery,
      tabs,
      handleLaunchGame,
      closeRunningGameDialogCb,
      clearSearchCb,
      showSearchModalCb,
      handlePrevShelf,
      handleNextShelf,
      handlePrevTab,
      handleNextTab,
      handleNavigation,
    ],
  );

  useScopedInput(
    libraryInputHandler,
    LibraryContainerFocusID,
    !isModalOpen,
  );

  useGlobalShortcut([
    {
      key: "Super",
      action: () => {
        playActionSound();
        toggleWindowShow();
      },
      active: true,
    },
  ]);

  const openSystemMenu = useCallback(() => {
    window.dispatchEvent(new Event("toggle-system-menu"));
  }, []);

  const stableOnLaunchGame = useCallback(() => {
    const { shelf, card } = focusCoordsRef.current;
    const game = shelvesRef.current[shelf]?.games[card];
    if (game) {
      launchGame(game);
    }
  }, [launchGame]);

  if (loading) {
    return <LoadingIndicator message={t("Loading library...")} />;
  }

  const controlsOverlayProps = {
    onOpenSystemMenu: openSystemMenu,
  };

  if (!isModalOpen && isFocusedGameRunning) {
    controlsOverlayProps.onCloseRunningGame = closeRunningGameDialogCb;
    controlsOverlayProps.runningGameTitle = focusedGame?.title || runningGame?.title;
  } else if (!isModalOpen) {
    if (focusedGame && !runningGame) {
      controlsOverlayProps.onLaunchGame = stableOnLaunchGame;
    }
    if (searchQuery) {
      controlsOverlayProps.onClearSearch = clearSearchCb;
    }
    controlsOverlayProps.onShowSearchModal = showSearchModalCb;
    if (!searchQuery && tabs.length > 1) {
      controlsOverlayProps.onPrevTab = handlePrevTab;
      controlsOverlayProps.onNextTab = handleNextTab;
    }
    if (shelves.length > 1) {
      controlsOverlayProps.onPrevShelf = handlePrevShelf;
      controlsOverlayProps.onNextShelf = handleNextShelf;
    }
  }

  return (
    <ControlsOverlay {...controlsOverlayProps}>
      <GameLibrary
        shelves={shelves}
        onCardFocus={handleCardFocus}
        onCardClick={handleLaunchGame}
        setCardRef={setCardRef}
        setShelfRef={setShelfRef}
        setGridRef={setGridRef}
        libraryContainerRef={libraryContainerRef}
        searchQuery={searchQuery}
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={setActiveTabId}
        focusCoords={focusCoords}
        heroFeaturedGame={focusedGame || runningGame || null}
        heroIsRunning={isFocusedGameRunning}
        heroIsPaused={false}
        onHeroForceClose={closeRunningGameDialogCb}
        showTabs={!searchQuery}
      />
    </ControlsOverlay>
  );
};

export default LibraryContainer;
