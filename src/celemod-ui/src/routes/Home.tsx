import _i18n from "src/i18n";
import { useI18N } from "src/i18n";
import { useEffect, useState } from "react";
import { GameSelector } from "../components/GameSelector";
import { Icon } from "../components/Icon";
import { callRemote, selectGamePath, useBlockingMask } from "../utils";
// @ts-ignore
import strawberry from "../resources/Celemod.png";
import {
  reloadBlacklistState,
  useAppStore,
  useCurrentBlacklistProfile,
  useGamePath,
  useMirror,
} from "../states";
import "./Home.scss";
import { useGlobalContext } from "src/App";

export const Home = () => {
  const i18n = useI18N();
  const [gamePath, setGamePath] = useGamePath();
  const [gamePaths, setGamePaths] = useState<string[]>([]);
  const [newKeyboardInputEnabled, setNewKeyboardInputEnabled] = useState<
    boolean | null
  >(null);
  const [removingNewKeyboardInput, setRemovingNewKeyboardInput] =
    useState(false);
  const [newKeyboardInputError, setNewKeyboardInputError] = useState("");
  useEffect(() => {
    void callRemote<string>("get_celeste_dirs")
      .then((paths) => setGamePaths(paths.split("\n").filter(Boolean)))
      .catch(console.error);
  }, [gamePath]);
  useEffect(() => {
    if (!gamePath) {
      setNewKeyboardInputEnabled(null);
      return;
    }
    const checkNewKeyboardInput = () => {
      void callRemote<boolean>("has_new_keyboard_input_enabled", gamePath)
        .then((enabled) => {
          setNewKeyboardInputEnabled(enabled);
          setNewKeyboardInputError("");
        })
        .catch((error) => {
          console.error("Failed to read everest-env.txt", error);
          setNewKeyboardInputEnabled(false);
          setNewKeyboardInputError(String(error));
        });
    };
    checkNewKeyboardInput();
    window.addEventListener("focus", checkNewKeyboardInput);
    return () => window.removeEventListener("focus", checkNewKeyboardInput);
  }, [gamePath]);
  const globalCtx = useGlobalContext();
  const profileEnabled = useAppStore((state) => state.profileEnabled);
  const { profiles, activeProfileNames } = useCurrentBlacklistProfile();
  const alwaysOnMods = useAppStore((state) => state.alwaysOnMods);
  const mask = useBlockingMask();

  useEffect(() => {
    if (!gamePath) return;
    void reloadBlacklistState(gamePath).catch(console.error);
  }, [gamePath, profileEnabled]);

  const [, setMirror] = useMirror();

  const [activeMods, setActiveMods] = useState<string[]>([]);
  useEffect(() => {
    if (!gamePath || !profileEnabled) {
      setActiveMods([]);
      return;
    }
    void callRemote<string>(
      "get_active_profile_mods",
      gamePath,
      JSON.stringify(alwaysOnMods),
    )
      .then((data) => setActiveMods(JSON.parse(data) as string[]))
      .catch(console.error);
  }, [activeProfileNames, alwaysOnMods, gamePath, profileEnabled]);

  const toggleProfile = (name: string) => {
    const nextNames = activeProfileNames.includes(name)
      ? activeProfileNames.filter((profileName) => profileName !== name)
      : [...activeProfileNames, name];
    if (nextNames.length === 0) return;
    void globalCtx.blacklist.setActiveProfiles(nextNames).catch(console.error);
  };
  return (
    <div className="home home-page">
      <header className="home-header">
        <div className="home-brand">
          <img src={strawberry} alt="" />
          <div>
            <h1>CeleMod</h1>
            <p>An alternative mod manager for Celeste</p>
          </div>
        </div>
        {i18n.currentLang === "zh-CN" ? (
          <div className="home-community">
            <span>反馈群：550358997</span>
            <button
              type="button"
              onClick={() =>
                callRemote(
                  "open_url",
                  "https://github.com/std-microblock/CeleMod",
                )
              }
            >
              <Icon name="external" /> GitHub 仓库
            </button>
          </div>
        ) : null}
        <label className="home-language">
          <Icon name="web" />
          <select
            value={i18n.currentLang}
            onChange={(event) => {
              i18n.setLang(event.target.value);
              setMirror(event.target.value === "zh-CN" ? "wegfan" : "0x0ade");
            }}
          >
            <option value="zh-CN">{_i18n.t("简体中文")}</option>
            <option value="en-US">English</option>
            <option value="ru-RU">русский</option>
            <option value="pt-BR">Brazilian Portuguese</option>
          </select>
        </label>
      </header>

      {gamePath && newKeyboardInputEnabled === true ? (
        <aside className="home-keyboard-input-banner">
          <Icon name="warn" />
          <div>
            <strong>{_i18n.t("建议删除 Everest 新键盘输入配置")}</strong>
            <span>
              {_i18n.t(
                "EVEREST_NEW_KEYBOARD_INPUT=1 会导致群服聊天输入异常，请从 everest-env.txt 中删除此配置：",
              )}
            </span>
            {newKeyboardInputError ? (
              <span className="home-keyboard-input-error">
                {newKeyboardInputError}
              </span>
            ) : null}
          </div>
          <div className="home-keyboard-input-actions">
            <code>EVEREST_NEW_KEYBOARD_INPUT=1</code>
            <button
              disabled={removingNewKeyboardInput}
              onClick={() => {
                setRemovingNewKeyboardInput(true);
                setNewKeyboardInputError("");
                void callRemote("remove_new_keyboard_input", gamePath)
                  .then(() => setNewKeyboardInputEnabled(false))
                  .catch((error) => setNewKeyboardInputError(String(error)))
                  .finally(() => setRemovingNewKeyboardInput(false));
              }}
            >
              {_i18n.t("立即删除")}
            </button>
          </div>
        </aside>
      ) : null}

      <section className="home-section home-game-section">
        <div className="home-section-heading">
          <Icon name="save" />
          <h2>{_i18n.t("选择游戏路径")}</h2>
        </div>
        {gamePath ? (
          <GameSelector
            paths={gamePaths}
            onSelect={(e: InputEvent) => {
              // @ts-ignore
              const value = e.target.value;
              if (value === "__other__") {
                // @ts-ignore
                e.target.value = gamePath;
                selectGamePath(setGamePath);
              } else setGamePath(value);
            }}
            launchGame={(v) => {
              mask.setMaskEnabled(true);
              mask.setMaskText(_i18n.t("正在启动"));
              callRemote(
                "start_game_directly",
                gamePath || gamePaths[0],
                v === "origin",
              );
              setTimeout(() => {
                mask.setMaskEnabled(false);
              }, 20000);
            }}
          />
        ) : (
          <div className="home-game-missing">
            <Icon name="warn" />
            <span>
              {_i18n.t(
                "未找到游戏！请先安装 Steam 商店或 Epic 商店版的 Celeste，或",
              )}
            </span>
            <button onClick={() => selectGamePath(setGamePath)}>
              {_i18n.t("点此手动选择")}
            </button>
          </div>
        )}
      </section>

      {profileEnabled && (
        <section className="home-section home-profiles-section">
          <div className="home-section-heading">
            <Icon name="file" />
            <h2>{_i18n.t("Profile 选择")}</h2>
          </div>
          <div className="profiles">
            {profiles.map((v) => (
              <button
                type="button"
                key={v.name}
                className={`profile ${
                  activeProfileNames.includes(v.name) ? "selected" : ""
                }`}
                onClick={() => toggleProfile(v.name)}
                aria-pressed={activeProfileNames.includes(v.name)}
              >
                <div className="profile-main">
                  <div className="name">{v.name}</div>
                  <div className="profile-meta">
                    <span>
                      {_i18n.t("启用 {count} 个 Mod", {
                        count: v.enabled_mods.length,
                      })}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="home-active-mods">
            <div className="home-active-mods-heading">
              <Icon name="list" />
              <strong>
                {_i18n.t("当前实际启用 {count} 个 Mod", {
                  count: activeMods.length,
                })}
              </strong>
            </div>
            <div className="home-active-mod-list">
              {activeMods.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
