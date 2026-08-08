import _i18n from "src/i18n";
import { Icon } from "./Icon";
import "./GameSelector.scss";
import { callRemote, useBlockingMask } from "../utils";
import { useGamePath } from "src/states";

export const GameSelector = (props: {
  paths: string[];
  onSelect: any;
  launchGame: (v: string) => void;
}) => {
  const [gamePath] = useGamePath();
  const paths = props.paths.includes(gamePath)
    ? props.paths
    : [...props.paths, gamePath].filter(Boolean);

  return (
    <div className="gameSelector">
      <div className="game-path-field">
        <Icon name="save" />
        <select onChange={props.onSelect} value={gamePath || paths[0]}>
          {paths.map((p) => (
            <option value={p} key={p}>
              {p}
            </option>
          ))}
          <option value="__other__">{_i18n.t("选择其他路径")}</option>
        </select>
      </div>
      <div className="game-actions">
        <button
          className="primary"
          onClick={() => {
            props.launchGame("everest");
          }}
        >
          {_i18n.t("Everest")}
        </button>

        <button
          onClick={() => {
            props.launchGame("origin");
          }}
        >
          {_i18n.t("原版")}
        </button>

        <button
          onClick={() => {
            callRemote("open_url", (gamePath || paths[0]) + "/Mods");
          }}
        >
          {_i18n.t("Mods 文件夹")}
        </button>
      </div>
    </div>
  );
};
