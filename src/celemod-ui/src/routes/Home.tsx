import _i18n from "src/i18n";
import { useI18N } from "src/i18n";
import { useEffect, useRef, useState } from "react";
import { GameSelector } from "../components/GameSelector";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { refreshLatestUpdateInfo, featureVisible, useUpdateInfo } from "../api/updateInfo";
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
import { detectDesktopPlatform } from "../tauri/window";
import { SteamAccount } from "../components/SteamAccount";

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
  const { data: updateInfo } = useUpdateInfo();
  const chinese = i18n.currentLang === "zh-CN";
  const shortcuts = [
    ...(gamePath ? [
      { page: "Everest", icon: "chart-area", title: "Everest", description: chinese ? "安装与更新加载器" : "Install & update", tone: "purple" },
      { page: "Manage", icon: "drive", title: _i18n.t("管理"), description: chinese ? "模组、依赖与预设" : "Mods & profiles", tone: "blue" },
      { page: "Search", icon: "search", title: _i18n.t("搜索"), description: chinese ? "发现新的模组" : "Discover new mods", tone: "pink" },
      { page: "RecommendMods", icon: "flag", title: _i18n.t("推荐模组"), description: chinese ? "精选地图与实用工具" : "Maps & useful tools", tone: "amber" },
      { page: "KeyBindings", icon: "keyboard", title: _i18n.t("按键"), description: detectDesktopPlatform() === "android" ? (chinese ? "虚拟按钮与 Mod 功能" : "Touch buttons & Mod actions") : (chinese ? "按键映射与冲突检查" : "Bindings & conflicts"), tone: "green" },
      ...(chinese ? [{ page: "Multiplayer", icon: "web", title: _i18n.t("联机相关"), description: "和朋友一起登山", tone: "blue" }] : []),
    ] : []),
    ...(featureVisible(updateInfo?.loenn, i18n.currentLang) ? [{ page: "Loenn", icon: "edit", title: "Loenn", description: chinese ? "地图编辑器" : "Map editor", tone: "green" }] : []),
    { page: "Downloads", icon: "download", title: _i18n.t("下载任务"), description: chinese ? "查看下载进度" : "Download progress", tone: "purple" },
    { page: "Settings", icon: "settings", title: _i18n.t("设置"), description: chinese ? "外观与运行选项" : "Appearance & runtime", tone: "neutral" },
  ];
  const profileEnabled = useAppStore((state) => state.profileEnabled);
  const { profiles, activeProfileNames } = useCurrentBlacklistProfile();
  const alwaysOnMods = useAppStore((state) => state.alwaysOnMods);
  const mask = useBlockingMask();
  const launchPending = useRef(false);
  const [launchError, setLaunchError] = useState("");
  const [updateCheckState, setUpdateCheckState] = useState<
    "idle" | "checking" | "success" | "error"
  >("idle");

  const checkUpdates = () => {
    if (updateCheckState === "checking") return;
    setUpdateCheckState("checking");
    void refreshLatestUpdateInfo().then(
      () => setUpdateCheckState("success"),
      (error) => {
        console.error("Failed to refresh update information", error);
        setUpdateCheckState("error");
      },
    );
  };

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
        <div className="home-update-actions">
          <Button
            disabled={updateCheckState === "checking"}
            onClick={checkUpdates}
          >
            {updateCheckState === "checking"
              ? _i18n.t("检查中…")
              : updateCheckState === "success"
                ? _i18n.t("检查完成")
                : updateCheckState === "error"
                  ? _i18n.t("检查失败")
                  : _i18n.t("检查更新")}
          </Button>
        </div>
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
            launchGame={async (v) => {
              if (launchPending.current) return;
              launchPending.current = true;
              setLaunchError("");
              const android = detectDesktopPlatform() === "android";
              if (android) window.dispatchEvent(new Event("celemod:launch-preparing"));
              else mask.setMaskEnabled(true);
              mask.setMaskText(_i18n.t("正在启动"));
              try {
                await callRemote(
                  "start_game_directly",
                  gamePath || gamePaths[0],
                  v === "origin",
                  v === "legacy",
                );
              } catch (error) {
                setLaunchError(error instanceof Error ? error.message : String(error));
              } finally {
                launchPending.current = false;
                if (android) window.dispatchEvent(new Event("celemod:launch-finished"));
                mask.setMaskEnabled(false);
              }
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
        {launchError && <div className="home-launch-error" role="alert">
          <strong>{chinese ? "游戏未能启动" : "Could not start the game"}</strong>
          <p>{launchError}</p>
          {detectDesktopPlatform() === "android" && <p>{chinese
            ? "如果是 Steam 同步问题，请在下方 Steam 面板重试或处理冲突；需要离线游玩时，请明确开启离线模式。"
            : "For Steam sync errors, retry or resolve conflicts in the Steam panel below. Enable offline mode explicitly if you want to play offline."}</p>}
        </div>}
      </section>

      {detectDesktopPlatform() === "android" && <SteamAccount />}

      <section className="home-section home-shortcuts-section">
        <div className="home-section-heading"><Icon name="grid" /><h2>{chinese ? "常用功能" : "Quick access"}</h2></div>
        <div className="home-shortcuts">
          {shortcuts.map(shortcut => <button type="button" key={shortcut.page} className={`home-shortcut tone-${shortcut.tone}`}
            onClick={() => globalCtx.pageController.setPage(shortcut.page)}>
            <span className="shortcut-icon"><Icon name={shortcut.icon} /></span>
            <span className="shortcut-copy"><strong title={shortcut.title}>{shortcut.title}</strong><small title={shortcut.description}>{shortcut.description}</small></span>
            <Icon name="i-right" />
          </button>)}
        </div>
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
                {activeProfileNames.includes(v.name) && (
                  <span className="profile-active-indicator" aria-label={_i18n.t("已启用")}>
                    <Icon name="i-tick" />
                    {_i18n.t("已启用")}
                  </span>
                )}
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
