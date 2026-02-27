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
  showTabs = true,
}) => {
  const { t } = useTranslation();
  const hasResults = shelves.length > 0 && shelves[0].games.length > 0;
  const showTabRow = showTabs && tabs.length > 1;

  return (
    <main ref={libraryContainerRef} className="game-library">
      <header className="library-header">
        <div className="library-header-row">
          <h1>{searchQuery ? t("Search") : t("My Library")}</h1>
          {showTabRow && (
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
          )}
        </div>
      </header>
      {hasResults ? (
        shelves.map((shelf, shelfIndex) => (
          <GameShelf
            key={shelf.title}
            title={shelf.title}
            games={shelf.games}
            shelfIndex={shelfIndex}
            setCardRef={setCardRef}
            setShelfRef={setShelfRef}
            setGridRef={setGridRef}
            onCardFocus={onCardFocus}
            onCardClick={onCardClick}
          />
        ))
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
