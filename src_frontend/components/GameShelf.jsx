import React, { useEffect, useRef } from "react";
import GameCard from "./GameCard";
import GameCover from "./GameCover";
import "../styles/GameShelf.css";
import { useTranslation } from "../contexts/TranslationContext";
import { formatDate, formatPlaytime } from "../utils/datetime";

const GameShelf = ({
  title,
  games,
  layout = "default",
  focusedCardIndex = 0,
  featuredGame: featuredGameOverride = null,
  isFeaturedRunning = false,
  isFeaturedPaused = false,
  onRequestForceClose,
  shelfIndex,
  setCardRef,
  setShelfRef,
  setGridRef,
  onCardFocus,
  onCardClick,
}) => {
  const { t } = useTranslation();
  const isHeroShelf = layout === "hero";
  const featuredCardIndex = Math.min(
    Math.max(focusedCardIndex || 0, 0),
    Math.max(games.length - 1, 0),
  );
  const featuredGame = isHeroShelf
    ? featuredGameOverride || games[featuredCardIndex]
    : null;
  const featuredLastPlayed = featuredGame
    ? formatDate(featuredGame.lastPlayed) || t("Never")
    : t("Never");
  const featuredPlaytime = featuredGame
    ? formatPlaytime(featuredGame.playtimeSeconds)
    : formatPlaytime(0);
  const featuredCategory =
    featuredGame?.categories?.[0] || t("Uncategorized");
  const featuredReleaseYear = featuredGame?.releaseYear || t("Unknown");
  const featuredPlatform =
    featuredGame?.platform || featuredGame?.runner || t("Unknown");
  const featuredPlatformIconPath = featuredGame?.runtimeIconPath || null;
  const heroGridRef = useRef(null);

  useEffect(() => {
    if (!isHeroShelf) return;
    const gridNode = heroGridRef.current;
    if (!gridNode) return;

    const heroCards = gridNode.querySelectorAll(".game-card-hero");
    const firstCard = heroCards[0];
    const selectedCard = heroCards[featuredCardIndex];
    if (!firstCard || !selectedCard) return;

    const maxLeft = Math.max(0, gridNode.scrollWidth - gridNode.clientWidth);
    const targetScrollLeft = Math.round(
      Math.max(0, Math.min(maxLeft, selectedCard.offsetLeft - firstCard.offsetLeft)),
    );

    if (Math.abs(targetScrollLeft - gridNode.scrollLeft) > 0.5) {
      // Use direct scrollLeft assignment to avoid intermediary fractional
      // positions from smooth scrolling that can visually clip edge covers.
      gridNode.scrollLeft = targetScrollLeft;
    }
  }, [featuredCardIndex, isHeroShelf, games.length]);

  useEffect(() => {
    if (!isHeroShelf) return;
    const gridNode = heroGridRef.current;
    if (!gridNode) return;

    const maxLeft = Math.max(0, gridNode.scrollWidth - gridNode.clientWidth);
    const clampedLeft = Math.max(0, Math.min(maxLeft, Math.round(gridNode.scrollLeft)));
    if (Math.abs(gridNode.scrollLeft - clampedLeft) > 0.5) {
      gridNode.scrollLeft = clampedLeft;
    }
  }, [games.length, isHeroShelf]);

  return (
    <section
      ref={(el) => setShelfRef(el, shelfIndex)}
      className={`game-shelf ${isHeroShelf ? "game-shelf-hero" : ""}`}
    >
      <h2 className="game-shelf-title">{title}</h2>

      {isHeroShelf ? (
        <div className="recently-played-layout">
          {featuredGame && (
            <div
              className="hero-featured"
              onClick={() => onCardClick(featuredGame)}
            >
              <div className="hero-featured-backdrop">
                {featuredGame.coverPath ? (
                  <img
                    src={`app://${featuredGame.coverPath}`}
                    alt=""
                    className="hero-featured-backdrop-image"
                  />
                ) : (
                  <GameCover game={featuredGame} className="hero-featured-fallback" />
                )}
              </div>
              <div className="hero-featured-content">
                <div className="hero-featured-poster">
                  {featuredGame.coverPath ? (
                    <img
                      src={`app://${featuredGame.coverPath}`}
                      alt={featuredGame.title}
                      className="hero-featured-poster-image"
                    />
                  ) : (
                    <GameCover
                      game={featuredGame}
                      className="hero-featured-poster-image"
                    />
                  )}
                </div>
                <div className="hero-featured-meta">
                  <div className="hero-featured-meta-top">
                    <div className="hero-featured-title-row">
                      <h3>{featuredGame.title}</h3>
                      {isFeaturedRunning && (
                        <span
                          className={`hero-running-badge ${
                            isFeaturedPaused ? "is-paused" : "is-running"
                          }`}
                        >
                          {isFeaturedPaused ? t("Paused") : t("Running")}
                        </span>
                      )}
                    </div>
                    <div className="hero-featured-stats">
                      <div className="hero-featured-stat-row">
                        <span className="hero-featured-stat-label">
                          {t("Playtime")}:
                        </span>
                        <strong className="hero-featured-stat-value">
                          {featuredPlaytime}
                        </strong>
                      </div>
                      <div className="hero-featured-stat-row">
                        <span className="hero-featured-stat-label">
                          {t("Last played")}:
                        </span>
                        <strong className="hero-featured-stat-value">
                          {featuredLastPlayed}
                        </strong>
                      </div>
                      <div className="hero-featured-stat-row">
                        <span className="hero-featured-stat-label">
                          {t("Category")}:
                        </span>
                        <strong className="hero-featured-stat-value">
                          {featuredCategory}
                        </strong>
                      </div>
                      <div className="hero-featured-stat-row">
                        <span className="hero-featured-stat-label">
                          {t("Release year")}:
                        </span>
                        <strong className="hero-featured-stat-value">
                          {featuredReleaseYear}
                        </strong>
                      </div>
                      <div className="hero-featured-stat-row">
                        <span className="hero-featured-stat-label">
                          {t("Platform")}:
                        </span>
                        <strong className="hero-featured-stat-value hero-featured-stat-value-with-icon">
                          {featuredPlatformIconPath && (
                            <img
                              src={`app://${featuredPlatformIconPath}`}
                              alt=""
                              className="hero-featured-platform-icon"
                            />
                          )}
                          <span>{featuredPlatform}</span>
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className="hero-featured-actions">
                    {!isFeaturedRunning && (
                      <button
                        type="button"
                        className="hero-featured-action-btn primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCardClick(featuredGame);
                        }}
                      >
                        {t("Launch Game")}
                      </button>
                    )}
                    {isFeaturedRunning && (
                      <>
                        <button
                          type="button"
                          className="hero-featured-action-btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestForceClose?.();
                          }}
                        >
                          {t("Force close")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="game-grid-hero-wrap">
            <div
              className="hero-carousel-indicator hero-carousel-indicator-prev"
              aria-hidden="true"
            >
              &#8249;
            </div>
            <div
              ref={(el) => {
                setGridRef(el, shelfIndex);
                heroGridRef.current = el;
              }}
              className="game-grid game-grid-hero"
            >
              <div className="hero-grid-spacer hero-grid-spacer-start" />
              {games.map((game, cardIndex) => (
                <GameCard
                  key={game.id}
                  ref={(el) => setCardRef(el, shelfIndex, cardIndex)}
                  game={game}
                  variant="hero"
                  isRunning={!!game.isRunning}
                  isPaused={!!game.isPaused}
                  onFocus={() => onCardFocus({ shelf: shelfIndex, card: cardIndex })}
                  onClick={() => onCardClick(game)}
                />
              ))}
              <div className="hero-grid-spacer hero-grid-spacer-end" />
            </div>
            <div
              className="hero-carousel-indicator hero-carousel-indicator-next"
              aria-hidden="true"
            >
              &#8250;
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={(el) => {
            setGridRef(el, shelfIndex);
          }}
          className="game-grid"
        >
          {games.map((game, cardIndex) => (
            <GameCard
              key={game.id}
              ref={(el) => setCardRef(el, shelfIndex, cardIndex)}
              game={game}
              variant="default"
              isRunning={!!game.isRunning}
              isPaused={!!game.isPaused}
              onFocus={() => onCardFocus({ shelf: shelfIndex, card: cardIndex })}
              onClick={() => onCardClick(game)}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export default React.memo(GameShelf);
