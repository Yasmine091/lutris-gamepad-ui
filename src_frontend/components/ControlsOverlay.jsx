import React from "react";
import "../styles/ControlsOverlay.css";
import LegendaContainer from "./LegendaContainer";
import { useTranslation } from "../contexts/TranslationContext";

const ControlsOverlay = ({
  children,
  onCloseRunningGame,
  onLaunchGame,
  onClearSearch,
  onShowSearchModal,
  onOpenSystemMenu,
  onToggleGamePause,
  isGamePaused,
  onPrevTab,
  onNextTab,
  onPrevShelf,
  onNextShelf,
}) => {
  const { t } = useTranslation();
  const legendItems = [];

  if (onCloseRunningGame) {
    legendItems.push({ button: "Super", label: t("Toggle Overlay") });

    if (onToggleGamePause) {
      legendItems.push({
        button: "X",
        label: isGamePaused ? t("Resume Game") : t("Pause Game"),
        onClick: onToggleGamePause,
      });
    }

    legendItems.push({
      button: "B",
      label: t("Force close"),
      onClick: onCloseRunningGame,
    });
  }

  if (onLaunchGame) {
    legendItems.push({
      button: "A",
      label: t("Launch Game"),
      onClick: onLaunchGame,
    });
  }

  if (onClearSearch) {
    legendItems.push({
      button: "B",
      label: t("Clear Search"),
      onClick: onClearSearch,
    });
  }

  if (onShowSearchModal) {
    legendItems.push({
      button: "X",
      label: t("Search"),
      onClick: onShowSearchModal,
    });
  }

  if (onOpenSystemMenu) {
    legendItems.push({
      button: "Y",
      label: t("Power"),
      onClick: onOpenSystemMenu,
    });
  }

  return (
    <div className="controls-overlay">
      <div className="hints-list">
        {onCloseRunningGame && (
          <>
            <ButtonIcon button="Super" label={t("Toggle Overlay")} />
            <ButtonIcon
              button="B"
              onClick={onCloseRunningGame}
              label={t("Force close {{gameTitle}}", {
                gameTitle: runningGameTitle || t("game"),
              })}
            />
          </>
        )}

        {onLaunchGame && (
          <ButtonIcon
            button="A"
            label={t("Launch Game")}
            onClick={onLaunchGame}
          />
        )}

        {onClearSearch && (
          <ButtonIcon
            button="B"
            label={t("Clear Search")}
            onClick={onClearSearch}
          />
        )}

        {onShowSearchModal && (
          <ButtonIcon
            button="X"
            label={t("Search")}
            onClick={onShowSearchModal}
          />
        )}

        {onPrevTab && (
          <ButtonIcon
            button="L2"
            label={t("Prev Tab")}
            onClick={onPrevTab}
          />
        )}

        {onNextTab && (
          <ButtonIcon
            button="R2"
            label={t("Next Tab")}
            onClick={onNextTab}
          />
        )}

        {onPrevShelf && (
          <ButtonIcon
            button="L1"
            label={t("Prev Shelf")}
            onClick={onPrevShelf}
          />
        )}

        {onNextShelf && (
          <ButtonIcon
            button="R1"
            label={t("Next Shelf")}
            onClick={onNextShelf}
          />
        )}

        {onOpenSystemMenu && (
          <ButtonIcon
            onClick={onOpenSystemMenu}
            button="Y"
            label={t("Power")}
          />
        )}
      </div>
    </div>
  );
};

export default React.memo(ControlsOverlay);
