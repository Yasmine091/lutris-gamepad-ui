import React from "react";
import "../styles/ControlsOverlay.css";
import ButtonIcon from "./ButtonIcon";
import { useTranslation } from "../contexts/TranslationContext";

const ControlsOverlay = ({
  onCloseRunningGame,
  runningGameTitle,
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
