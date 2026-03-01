import React from "react";
import GameShelf from "./GameShelf";
import "../styles/GameLibrary.css";
import { useTranslation } from "../contexts/TranslationContext";

const GameLibrary = ({
  shelves,
  onCardFocus,
  onCardClick,
  setCardRef,
  setShelfRef,
  setGridRef,
  libraryContainerRef,
  searchQuery,
  tabs = [],
  activeTabId,
  onTabSelect,
  focusCoords,
  heroFeaturedGame,
  heroIsRunning = false,
  heroIsPaused = false,
  onHeroForceClose,
  showTabs = true,
}) => {
  const { t } = useTranslation();
  const hasResults = shelves.some((shelf) => (shelf.games || []).length > 0);
  const showTabRow = showTabs && tabs.length > 1;
  const heroShelf = shelves[0]?.layout === "hero" ? shelves[0] : null;
  const categoryShelves = heroShelf ? shelves.slice(1) : shelves;
  const categoryShelfStartIndex = heroShelf ? 1 : 0;

  return (
    <main ref={libraryContainerRef} className="game-library">
      <header className="library-header">
        <div className="library-header-row">
          <h1>{searchQuery ? t("Search") : t("My Library")}</h1>
        </div>
      </header>
      {hasResults ? (
        <>
          {heroShelf && (
            <GameShelf
              key={heroShelf.id || heroShelf.title}
              title={heroShelf.title}
              games={heroShelf.games}
              layout={heroShelf.layout || "hero"}
              shelfIndex={0}
              focusedCardIndex={focusCoords?.shelf === 0 ? focusCoords.card : 0}
              featuredGame={heroFeaturedGame}
              isFeaturedRunning={heroIsRunning}
              isFeaturedPaused={heroIsPaused}
              onRequestForceClose={onHeroForceClose}
              setCardRef={setCardRef}
              setShelfRef={setShelfRef}
              setGridRef={setGridRef}
              onCardFocus={onCardFocus}
              onCardClick={onCardClick}
            />
          )}

          {showTabRow && (
            <div className="library-tabs-wrap">
              <div className="library-tabs" role="tablist">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeTabId}
                    className={`library-tab ${
                      tab.id === activeTabId ? "active" : ""
                    }`}
                    onClick={() => onTabSelect?.(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {categoryShelves.map((shelf, shelfIndex) => {
            const actualShelfIndex = categoryShelfStartIndex + shelfIndex;
            return (
              <GameShelf
                key={shelf.id || shelf.title}
                title={shelf.title}
                games={shelf.games}
                layout={shelf.layout || "default"}
                shelfIndex={actualShelfIndex}
                focusedCardIndex={
                  focusCoords?.shelf === actualShelfIndex ? focusCoords.card : 0
                }
                setCardRef={setCardRef}
                setShelfRef={setShelfRef}
                setGridRef={setGridRef}
                onCardFocus={onCardFocus}
                onCardClick={onCardClick}
              />
            );
          })}
        </>
      ) : (
        <div className="empty-library-message">
          <h2>
            {searchQuery
              ? t('No results for "{{searchQuery}}"', { searchQuery })
              : t("No games found")}
          </h2>
          <p>
            {searchQuery
              ? t("Try a different search term or press 'B' to clear.")
              : t("Add games in Lutris and reload.")}
          </p>
        </div>
      )}
    </main>
  );
};

export default React.memo(GameLibrary);
