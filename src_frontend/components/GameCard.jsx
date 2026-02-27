import React from "react";
import "../styles/GameCard.css";
import GameCover from "./GameCover";
import { formatDate, formatPlaytime } from "../utils/datetime";
import { useTranslation } from "../contexts/TranslationContext";
import { useSettingsState } from "../contexts/SettingsContext";

const GameCard = React.forwardRef(
  ({ game, variant = "default", isRunning = false, onFocus, onClick }, ref) => {
    const { t } = useTranslation();
    const { settings } = useSettingsState();
    const isHeroVariant = variant === "hero";
    const primaryCoverPath = isHeroVariant
      ? game.coverPath || game.bannerPath
      : game.coverPath;

    return (
      <div
        ref={ref}
        className={`game-card ${isHeroVariant ? "game-card-hero" : ""}`}
        tabIndex="-1"
        onClick={onClick}
        onMouseEnter={onFocus}
      >
        {primaryCoverPath ? (
          <img
            src={`app://${primaryCoverPath}`}
            alt={game.title}
            className="game-card-cover"
          />
        ) : (
          <GameCover game={game} variant={variant} className="game-card-cover" />
        )}

        {isRunning && (
          <div
            className="game-card-running-indicator"
            aria-label={t("Running")}
            title={t("Running")}
          />
        )}

        {settings.showRunnerIcon && game.runtimeIconPath && (
          <img
            src={`app://${game.runtimeIconPath}`}
            alt="Runner Icon"
            className="game-card-runner-icon"
          />
        )}

        <div className="game-card-overlay">
          <div className="game-card-info">
            <h3 className="game-card-title">{game.title}</h3>
            <p>
              {t("Playtime: {{playtime}}", {
                playtime: formatPlaytime(game.playtimeSeconds),
              })}
            </p>
            <p>
              {t("Last played: {{date}}", {
                date: formatDate(game.lastPlayed) || t("Never"),
              })}
            </p>
          </div>
        </div>
      </div>
    );
  },
);

export default React.memo(GameCard);
