import { getDeterministicGradient } from "../utils/color";
import "../styles/GameCover.css";

const GameCover = ({ game, className, variant = "default" }) => {
  const gradient = getDeterministicGradient(game.title);
  const isHeroVariant = variant === "hero";

  const style = {
    background: `linear-gradient(145deg, ${gradient.start}, ${gradient.end})`,
  };

  return (
    <div
      className={`game-cover ${isHeroVariant ? "game-cover-hero" : ""} ${
        className || ""
      }`}
      style={style}
    >
      <h4 className={`game-cover-title ${isHeroVariant ? "hero" : ""}`}>
        {game.title}
      </h4>
    </div>
  );
};

export default GameCover;
