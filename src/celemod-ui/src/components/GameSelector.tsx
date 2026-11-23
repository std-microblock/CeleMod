import type { ChangeEventHandler } from "react";
import _i18n, { useI18N } from "src/i18n";
import { Icon } from "./Icon";
import "./GameSelector.scss";
import { callRemote } from "../utils";
import { useCurrentEverestUltra, useGamePath } from "src/states";
import { detectDesktopPlatform } from "../tauri/window";

export interface GameSelectorProps {
  paths: string[];
  onSelect: ChangeEventHandler<HTMLSelectElement>;
  launchGame: (v: string) => void;
}

export const GameSelector = (props: GameSelectorProps) => {
  const i18n = useI18N();
  const [gamePath] = useGamePath();
  const { currentEverestIsUltra } = useCurrentEverestUltra();
  const isAndroid = detectDesktopPlatform() === "android";
  const chinese = i18n.currentLang === "zh-CN";
  const paths = props.paths.includes(gamePath)
    ? props.paths
    : [...props.paths, gamePath].filter(Boolean);
  const resolvedPath = gamePath || paths[0] || "";

  return (
    <div className="gameSelector">
      <div className="game-path-row">
        <div className="game-path-field">
          <Icon name="folder" />
          <select
            aria-label={_i18n.t("选择游戏路径")}
            onChange={props.onSelect}
            value={resolvedPath}
            title={resolvedPath}
          >
            {paths.map((p) => (
              <option value={p} key={p}>
                {p}
              </option>
            ))}
            <option value="__other__">
              {isAndroid
                ? chinese
                  ? "从文件导入其他游戏目录"
                  : "Import another game folder"
                : _i18n.t("选择其他路径")}
            </option>
          </select>
        </div>

        {!isAndroid && (
          <button
            type="button"
            className="game-mods-btn"
            title={_i18n.t("打开 Mods 文件夹")}
            onClick={() => {
              if (!resolvedPath) return;
              void callRemote("open_url", `${resolvedPath}/Mods`);
            }}
          >
            <Icon name="folder" />
            <span>{_i18n.t("Mods 文件夹")}</span>
          </button>
        )}
      </div>

      <div className="game-actions">
        <button
          type="button"
          className="primary game-launch-primary"
          onClick={() => {
            props.launchGame("everest");
          }}
        >
          <Icon name="play" />
          <span>
            {currentEverestIsUltra
              ? chinese
                ? "启动 Everest Ultra"
                : "Launch Everest Ultra"
              : chinese
                ? "启动 Everest"
                : "Launch Everest"}
          </span>
        </button>

        {currentEverestIsUltra ? (
          <button
            type="button"
            className="game-launch-secondary"
            title={_i18n.t(
              "仅本次禁用 EverestUltra 的并行加载、ILHook 启动事务和 PGO 重排",
            )}
            onClick={() => {
              props.launchGame("legacy");
            }}
          >
            <Icon name="clock" />
            <span>{_i18n.t("慢速启动")}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="game-launch-secondary"
          onClick={() => {
            props.launchGame("origin");
          }}
        >
          <span>{chinese ? "启动原版" : "Launch Vanilla"}</span>
        </button>
      </div>
    </div>
  );
};
