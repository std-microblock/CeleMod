import _i18n, { useI18N } from "src/i18n";
import { useEffect, useRef, useState } from "react";
import { GameSelector } from "../components/GameSelector";
import { Icon } from "../components/Icon";
import {
  featureVisible,
  refreshLatestUpdateInfo,
  useUpdateInfo,
} from "../api/updateInfo";
import { useEverestUpdate } from "../api/everestUpdate";
import { checkUpdate } from "../components/SelfUpdate";
import { callRemote, selectGamePath, useBlockingMask } from "../utils";
// @ts-ignore
import strawberry from "../resources/Celemod.png";
import {
  reloadBlacklistState,
  useAppStore,
  useCurrentBlacklistProfile,
  useCurrentEverestUltra,
  useCurrentEverestVersion,
  useGamePath,
  useMirror,
} from "../states";
import "./Home.scss";
import { useGlobalContext } from "src/App";
import { detectDesktopPlatform, isMobileLayout } from "../tauri/window";
import { SteamAccount } from "../components/SteamAccount";
import { HomeUpdatesCard } from "../components/HomeUpdatesCard";
import { Collapse } from "../components/Motion";

interface ShortcutItem {
  page: string;
  icon: string;
  title: string;
  description: string;
}

const formatEverestVersion = (version: string) => {
  const trimmed = version.trim();
  if (!trimmed) return "";
  return /^v/i.test(trimmed) ? trimmed : `v${trimmed}`;
};

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
  const [activeModsExpanded, setActiveModsExpanded] = useState(false);

  const isAndroid = detectDesktopPlatform() === "android";
  const chinese = i18n.currentLang === "zh-CN";

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
  const loennUltra = (
    updateInfo as
      | (typeof updateInfo & {
          loenn_ultra?: { enabled: boolean; only_zh_cn?: boolean };
        })
      | null
  )?.loenn_ultra;
  const showLoenn =
    featureVisible(updateInfo?.loenn, i18n.currentLang) ||
    featureVisible(loennUltra, i18n.currentLang);

  const shortcuts: ShortcutItem[] = [
    ...(gamePath
      ? [
          {
            page: "Everest",
            icon: "chart-area",
            title: "Everest",
            description: chinese ? "安装与更新加载器" : "Install & update",
          },
          {
            page: "Manage",
            icon: "drive",
            title: _i18n.t("管理"),
            description: chinese ? "模组、依赖与预设" : "Mods & profiles",
          },
          {
            page: "Search",
            icon: "search",
            title: _i18n.t("搜索"),
            description: chinese ? "发现新的模组" : "Discover new mods",
          },
          {
            page: "RecommendMods",
            icon: "flag",
            title: _i18n.t("推荐模组"),
            description: chinese ? "精选地图与实用工具" : "Maps & useful tools",
          },
          {
            page: "KeyBindings",
            icon: "keyboard",
            title: _i18n.t("按键"),
            description: isAndroid
              ? chinese
                ? "虚拟按钮与 Mod 功能"
                : "Touch buttons & Mod actions"
              : chinese
                ? "按键映射与冲突检查"
                : "Bindings & conflicts",
          },
          ...(chinese
            ? [
                {
                  page: "Multiplayer",
                  icon: "web",
                  title: _i18n.t("联机相关"),
                  description: "和朋友一起登山",
                },
              ]
            : []),
        ]
      : []),
    ...(showLoenn
      ? [
          {
            page: "Loenn",
            icon: "edit",
            title: "Loenn",
            description: chinese ? "地图编辑器" : "Map editor",
          },
        ]
      : []),
    {
      page: "Downloads",
      icon: "download",
      title: _i18n.t("下载任务"),
      description: chinese ? "查看下载进度" : "Download progress",
    },
    {
      page: "Settings",
      icon: "settings",
      title: _i18n.t("设置"),
      description: chinese ? "外观与运行选项" : "Appearance & runtime",
    },
  ];

  const profileEnabled = useAppStore((state) => state.profileEnabled);
  const installedMods = useAppStore((state) => state.installedMods);
  const installedModsLoaded = useAppStore((state) => state.installedModsLoaded);
  const alwaysOnMods = useAppStore((state) => state.alwaysOnMods);
  const { profiles, activeProfileNames } = useCurrentBlacklistProfile();
  const { currentEverestVersion } = useCurrentEverestVersion();
  const { currentEverestIsUltra } = useCurrentEverestUltra();
  const {
    installedBuild: everestInstalledBuild,
    target: everestTarget,
    hasUpdate: hasEverestUpdate,
    refresh: refreshEverestUpdate,
  } = useEverestUpdate();

  const mask = useBlockingMask();
  const launchPending = useRef(false);
  const [launchError, setLaunchError] = useState("");
  const [updateRefreshToken, setUpdateRefreshToken] = useState(0);
  const [updateCheckState, setUpdateCheckState] = useState<
    "idle" | "checking" | "success" | "error"
  >("idle");

  const checkUpdates = () => {
    if (updateCheckState === "checking") return;
    setUpdateCheckState("checking");
    setUpdateRefreshToken((value) => value + 1);
    if (gamePath) {
      globalCtx.everest.updateEverestVersion();
    }
    void Promise.allSettled([
      refreshLatestUpdateInfo().then(() => checkUpdate(true)),
      gamePath ? refreshEverestUpdate() : Promise.resolve(null),
    ]).then((results) => {
      const rejected = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (rejected) {
        console.error("Failed to refresh update information", rejected.reason);
        setUpdateCheckState("error");
        return;
      }
      setUpdateCheckState("success");
    });
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

  const formattedEverest = formatEverestVersion(currentEverestVersion);
  const activeProfileLabel =
    activeProfileNames.length === 0
      ? "—"
      : activeProfileNames.length === 1
        ? activeProfileNames[0]
        : `${activeProfileNames[0]} +${activeProfileNames.length - 1}`;

  const updateCheckLabel =
    updateCheckState === "checking"
      ? _i18n.t("检查中…")
      : updateCheckState === "success"
        ? _i18n.t("检查完成")
        : updateCheckState === "error"
          ? _i18n.t("检查失败")
          : _i18n.t("检查更新");

  return (
    <div className="home home-page">
      <header className="home-header">
        <div className="home-brand">
          <div className="home-brand-mark" aria-hidden="true">
            <img
              src={strawberry}
              alt=""
              data-splash-target="strawberry"
              draggable={false}
            />
          </div>
          <div className="home-brand-copy">
            <h1 className="home-brand-title">CeleMod</h1>
            <p className="home-brand-subtitle">
              An alternative mod manager for Celeste
            </p>
          </div>
        </div>

        <div className="home-header-actions">
          <label className="home-language">
            <Icon name="web" />
            <select
              aria-label={chinese ? "界面语言" : "Language"}
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

          <button
            type="button"
            className="home-update-btn"
            data-state={updateCheckState}
            disabled={updateCheckState === "checking"}
            onClick={checkUpdates}
            aria-live="polite"
          >
            <Icon
              name={
                updateCheckState === "success"
                  ? "i-tick"
                  : updateCheckState === "error"
                    ? "fail"
                    : "replay"
              }
            />
            <span>{updateCheckLabel}</span>
          </button>
        </div>
      </header>

      <Collapse
        open={Boolean(gamePath && newKeyboardInputEnabled === true)}
        appear
      >
        <aside className="home-keyboard-input-banner" role="alert">
          <span className="home-banner-icon" aria-hidden="true">
            <Icon name="warn" />
          </span>
          <div className="home-banner-copy">
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
              type="button"
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
      </Collapse>

      <section
        className="home-launch-card"
        aria-label={_i18n.t("选择游戏路径")}
      >
        <div className="home-launch-body">
          <div className="home-launch-eyebrow">
            <span>{_i18n.t("选择游戏路径")}</span>
          </div>

          {gamePath ? (
            <GameSelector
              paths={gamePaths}
              onSelect={(event) => {
                const value = event.target.value;
                if (value === "__other__") {
                  event.target.value = gamePath;
                  selectGamePath(setGamePath);
                } else {
                  setGamePath(value);
                }
              }}
              launchGame={async (v) => {
                if (launchPending.current) return;
                launchPending.current = true;
                setLaunchError("");
                if (isAndroid)
                  window.dispatchEvent(new Event("celemod:launch-preparing"));
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
                  setLaunchError(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  launchPending.current = false;
                  if (isAndroid)
                    window.dispatchEvent(new Event("celemod:launch-finished"));
                  mask.setMaskEnabled(false);
                }
              }}
            />
          ) : (
            <div className="home-game-missing">
              <div className="home-game-missing-copy">
                <span className="home-missing-icon" aria-hidden="true">
                  <Icon name="warn" />
                </span>
                <div>
                  <strong>
                    {chinese
                      ? "尚未定位到 Celeste 游戏目录"
                      : "Celeste installation not found"}
                  </strong>
                  <p>
                    {_i18n.t(
                      "未找到游戏！请先安装 Steam 商店或 Epic 商店版的 Celeste，或",
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="primary home-missing-cta"
                onClick={() => selectGamePath(setGamePath)}
              >
                <Icon name="folder" />
                <span>{chinese ? "手动选择游戏路径" : "Select game path"}</span>
              </button>
            </div>
          )}

          <Collapse open={Boolean(launchError)} appear>
            <div className="home-launch-error" role="alert">
              <div className="home-launch-error-head">
                <Icon name="fail" />
                <strong>
                  {chinese ? "游戏未能启动" : "Could not start the game"}
                </strong>
              </div>
              <p>{launchError}</p>
              {isAndroid ? (
                <p className="home-launch-error-hint">
                  {chinese
                    ? "如果是 Steam 同步问题，请在下方 Steam 面板重试或处理冲突；需要离线游玩时，请明确开启离线模式。"
                    : "For Steam sync errors, retry or resolve conflicts in the Steam panel below. Enable offline mode explicitly if you want to play offline."}
                </p>
              ) : null}
            </div>
          </Collapse>
        </div>

        {gamePath ? (
          <div
            className={`home-status-strip ${profileEnabled ? "cols-3" : "cols-2"}`}
          >
            <button
              type="button"
              className="home-status-item"
              onClick={() => globalCtx.pageController.setPage("Everest")}
            >
              <span className="home-status-meta">
                <span className="home-status-label">Everest</span>
                <span className="home-status-value">
                  {formattedEverest ? (
                    <>
                      <span>{formattedEverest}</span>
                      {currentEverestIsUltra ? (
                        <span className="home-status-pill">Ultra</span>
                      ) : null}
                      {hasEverestUpdate && everestTarget ? (
                        <span className="home-status-pill home-status-pill-update">
                          {chinese
                            ? `可更新 → ${everestTarget.version}`
                            : `Update → ${everestTarget.version}`}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="is-muted">
                      {chinese ? "未安装" : _i18n.t("尚未安装")}
                    </span>
                  )}
                </span>
              </span>
              <Icon name="i-right" />
            </button>

            <button
              type="button"
              className="home-status-item"
              onClick={() => globalCtx.pageController.setPage("Manage")}
            >
              <span className="home-status-meta">
                <span className="home-status-label">
                  {chinese ? "已安装模组" : "Installed mods"}
                </span>
                <span className="home-status-value">
                  {installedModsLoaded || installedMods.length > 0
                    ? installedMods.length
                    : "—"}
                </span>
              </span>
              <Icon name="i-right" />
            </button>

            {profileEnabled ? (
              <button
                type="button"
                className="home-status-item"
                onClick={() => globalCtx.pageController.setPage("Manage")}
              >
                <span className="home-status-meta">
                  <span className="home-status-label">
                    {chinese ? "当前预设" : "Active profile"}
                  </span>
                  <span className="home-status-value">
                    <span
                      className="home-status-ellipsis"
                      title={activeProfileNames.join(", ")}
                    >
                      {activeProfileLabel}
                    </span>
                    <span className="home-status-sub">
                      {chinese
                        ? `${activeMods.length} 已启用`
                        : `${activeMods.length} enabled`}
                    </span>
                  </span>
                </span>
                <Icon name="i-right" />
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {isAndroid && <SteamAccount />}

      <HomeUpdatesCard
        refreshToken={updateRefreshToken}
        everestTarget={everestTarget}
        hasEverestUpdate={hasEverestUpdate}
        everestInstalledBuild={everestInstalledBuild}
      />

      {profileEnabled && gamePath && profiles.length > 0 ? (
        <section className="home-section home-profiles-section">
          <div className="home-section-head">
            <h2>{_i18n.t("Profile 选择")}</h2>
            <span className="home-section-pill">
              {chinese
                ? `${activeMods.length} 个模组已启用`
                : `${activeMods.length} mods active`}
            </span>
          </div>

          <div className="profiles">
            {profiles.map((v) => {
              const selected = activeProfileNames.includes(v.name);
              return (
                <button
                  type="button"
                  key={v.name}
                  className={`profile ${selected ? "selected" : ""}`}
                  onClick={() => toggleProfile(v.name)}
                  aria-pressed={selected}
                >
                  <div className="profile-top">
                    <span className="name" title={v.name}>
                      {v.name}
                    </span>
                    <span
                      className={`profile-active-indicator ${selected ? "is-active" : ""}`}
                      aria-label={selected ? _i18n.t("已启用") : undefined}
                      aria-hidden={!selected || undefined}
                    >
                      <Icon name="i-tick" />
                    </span>
                  </div>
                  <div className="profile-meta">
                    {_i18n.t("启用 {count} 个 Mod", {
                      count: v.enabled_mods.length,
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          <div
            className={`home-active-mods ${activeModsExpanded ? "is-expanded" : ""}`}
          >
            <button
              type="button"
              className="home-active-mods-toggle"
              aria-expanded={activeModsExpanded}
              onClick={() => setActiveModsExpanded((expanded) => !expanded)}
            >
              <span className="home-active-mods-heading">
                <Icon name="list" />
                <span>
                  {_i18n.t("当前实际启用 {count} 个 Mod", {
                    count: activeMods.length,
                  })}
                </span>
              </span>
              <span className="home-active-mods-action">
                <span>
                  {activeModsExpanded
                    ? chinese
                      ? "收起"
                      : "Hide"
                    : chinese
                      ? "展开"
                      : "Show"}
                </span>
                <Icon name="i-down" />
              </span>
            </button>

            <Collapse open={activeModsExpanded} unmountOnExit>
              <div className="home-active-mod-list" role="status">
                {activeMods.length > 0 ? (
                  activeMods.map((name) => <span key={name}>{name}</span>)
                ) : (
                  <p className="home-active-mods-empty">
                    {chinese
                      ? "当前未启用任何模组"
                      : "No mods currently active"}
                  </p>
                )}
              </div>
            </Collapse>
          </div>
        </section>
      ) : null}

      {isMobileLayout() && (
        <section className="home-section home-shortcuts-section">
          <div className="home-section-head">
            <h2>{chinese ? "常用功能" : "Quick access"}</h2>
          </div>
          <div className="home-shortcuts">
            {shortcuts.map((shortcut) => (
              <button
                type="button"
                key={shortcut.page}
                className="home-shortcut"
                onClick={() => globalCtx.pageController.setPage(shortcut.page)}
              >
                <span className="shortcut-icon" aria-hidden="true">
                  <Icon name={shortcut.icon} />
                </span>
                <span className="shortcut-copy">
                  <strong title={shortcut.title}>{shortcut.title}</strong>
                  <small title={shortcut.description}>
                    {shortcut.description}
                  </small>
                </span>
                <Icon name="i-right" />
              </button>
            ))}
          </div>
        </section>
      )}

      {chinese ? (
        <footer className="home-footer home-community">
          <span className="home-community-group">反馈群：550358997</span>
          <button
            type="button"
            className="home-community-link"
            onClick={() =>
              void callRemote(
                "open_url",
                "https://github.com/std-microblock/CeleMod",
              )
            }
          >
            <Icon name="external" />
            <span>GitHub 仓库</span>
          </button>
        </footer>
      ) : null}
    </div>
  );
};
