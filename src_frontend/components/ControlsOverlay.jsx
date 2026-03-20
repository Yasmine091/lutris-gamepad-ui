import React from "react";
import "../styles/ControlsOverlay.css";
import { useTranslation } from "../contexts/TranslationContext";
import LegendaContainer from "./LegendaContainer";

const ControlsOverlay = ({
  children,
  onCloseRunningGame,
  runningGameTitle,
  onShowGameSettings,
  onLaunchGame,
  onClearSearch,
  onShowSearchModal,
  onOpenSystemMenu,
  onPrevTab,
  onNextTab,
  onPrevShelf,
  onNextShelf,
}) => {
  const { t } = useTranslation();
  const legendItems = [];

  if (onCloseRunningGame) {
    legendItems.push({ button: "Super", label: t("Toggle Overlay") });
    legendItems.push({
      button: "B",
      onClick: onCloseRunningGame,
      label: t("Force close {{gameTitle}}", {
        gameTitle: runningGameTitle || t("game"),
      }),
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

  if (onShowGameSettings) {
    legendItems.push({
      button: "Y",
      label: t("Game Settings"),
      onClick: onShowGameSettings,
    });
  }

  if (onPrevTab) {
    legendItems.push({
      button: "L2",
      label: t("Prev Tab"),
      onClick: onPrevTab,
    });
  }

  if (onNextTab) {
    legendItems.push({
      button: "R2",
      label: t("Next Tab"),
      onClick: onNextTab,
    });
  }

  if (onPrevShelf) {
    legendItems.push({
      button: "L1",
      label: t("Prev Shelf"),
      onClick: onPrevShelf,
    });
  }

  if (onNextShelf) {
    legendItems.push({
      button: "R1",
      label: t("Next Shelf"),
      onClick: onNextShelf,
    });
  }

  if (onOpenSystemMenu) {
    legendItems.push({
      button: "Start",
      label: t("Power"),
      onClick: onOpenSystemMenu,
    });
  }

  return (
    <div className="controls-overlay-wrapper">
      <LegendaContainer legendItems={legendItems}>{children}</LegendaContainer>
    </div>
  );
};

export default React.memo(ControlsOverlay);
