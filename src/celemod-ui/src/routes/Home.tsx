import _i18n from "src/i18n";
import { useI18N } from "src/i18n";
import { useContext, useRef, useState } from "react";
import { GameSelector } from "../components/GameSelector";
import { Icon } from "../components/Icon";
import { callRemote, selectGamePath, useBlockingMask } from "../utils";
// @ts-ignore
import strawberry from "../resources/Celemod.png";
import {
  useAlwaysOnMods,
  useAppStore,
  useCurrentBlacklistProfile,
  useGamePath,
  useInstalledMods,
  useMirror,
} from "../states";
import { useEffect } from "react";
import "./Home.scss";
import { createPopup, PopupContext } from "../components/Popup";
import { useGlobalContext } from "src/App";

export const Home = () => {
  const i18n = useI18N();
  const [gamePath, setGamePath] = useGamePath();
  const [gamePaths, setGamePaths] = useState<string[]>([]);
  useEffect(() => {
    void callRemote<string>("get_celeste_dirs")
      .then((paths) => setGamePaths(paths.split("\n").filter(Boolean)))
      .catch(console.error);
  }, [gamePath]);
  const globalCtx = useGlobalContext();
  const checkBlacklistSync = useAppStore((state) => state.checkBlacklistSync);

  const {
    profiles,
    setProfiles,
    currentProfileName,
    setCurrentProfileName,
    currentProfile,
    setCurrentProfile,
  } = useCurrentBlacklistProfile();

  const mask = useBlockingMask();

  useEffect(() => {
    if (!gamePath) return;
    void callRemote<string>("get_current_profile", gamePath)
      .then(setCurrentProfileName)
      .catch(console.error);
    callRemote("get_blacklist_profiles", gamePath, (data: string) => {
      setProfiles(JSON.parse(data));
    });
  }, [gamePath]);

  useEffect(() => {
    setCurrentProfile(
      profiles.find((v) => v.name === currentProfileName) || null
    );
  }, [currentProfileName, profiles]);

  const [alwaysOnMods] = useAlwaysOnMods();
  const { installedMods } = useInstalledMods();
  const blacklistSyncPopupRef = useRef<ReturnType<typeof createPopup> | null>(
    null
  );

  useEffect(() => {
    if (
      !checkBlacklistSync ||
      !currentProfile ||
      !gamePath ||
      blacklistSyncPopupRef.current
    )
      return;
    const checkSync = async () => {
      const content = await callRemote<string>(
        "get_current_blacklist_content",
        gamePath
      );
      const disabledFiles: string[] = content
        .split("\n")
        .map((v) => v.trim())
        .filter((v) => v && !v.startsWith("#"))
        .sort();
      const installedModsByName = new Map(
        installedMods.map((mod) => [mod.name, mod])
      );
      const alwaysOnFiles = new Set(
        installedMods
          .filter((mod) => alwaysOnMods.includes(mod.name))
          .map((mod) => mod.file)
      );
      const expectedDisabledFiles = [
        ...new Set(
          currentProfile.mods.flatMap((profileMod) => {
            const installedMod = installedModsByName.get(profileMod.name);
            if (!installedMod || alwaysOnFiles.has(installedMod.file)) return [];
            return [installedMod.file];
          })
        ),
      ].sort();
      const onlyInProfile = [
        ...new Set<string>(
          expectedDisabledFiles.filter((file) => !disabledFiles.includes(file))
        ),
      ];
      const onlyInFile = [
        ...new Set<string>(
          disabledFiles.filter((file) => !expectedDisabledFiles.includes(file))
        ),
      ];
      if (
        (onlyInProfile.length > 0 || onlyInFile.length > 0) &&
        !blacklistSyncPopupRef.current
      ) {
        const popup = createPopup(() => {
          const { hide } = useContext(PopupContext);
          const [error, setError] = useState("");

          const refreshProfiles = async (selectedProfileName?: string) => {
            const nextProfiles = await new Promise<typeof profiles>(
              (resolve, reject) => {
                void callRemote(
                  "get_blacklist_profiles",
                  gamePath,
                  (data: string) => {
                    try {
                      resolve(JSON.parse(data));
                    } catch (error) {
                      reject(error);
                    }
                  }
                ).catch(reject);
              }
            );
            const nextProfileName = selectedProfileName ?? currentProfileName;
            setProfiles(nextProfiles);
            setCurrentProfileName(nextProfileName);
            setCurrentProfile(
              nextProfiles.find((profile) => profile.name === nextProfileName) ??
                nextProfiles[0] ??
                null
            );
          };

          return (
            <div className="popup-content blacklist-sync-popup">
              <div className="title">{_i18n.t("同步黑名单 Mod 列表")}</div>
              <div className="content">
                {_i18n.t(
                  "blacklist.txt 与当前 CeleMod Profile 不一致。请选择要保留的版本。"
                )}
              </div>
              <div className="blacklist-diff-list">
                {onlyInProfile.length > 0 && (
                  <section>
                    <div className="diff-title">
                      <span>{_i18n.t("仅 CeleMod Profile 中禁用")}</span>
                      <span className="diff-count">{onlyInProfile.length}</span>
                    </div>
                    {onlyInProfile.map((file) => (
                      <div
                        className="diff-item profile-only"
                        key={`profile-${file}`}
                        title={file}
                      >
                        <span className="diff-source">C</span>
                        <span className="diff-file">{file}</span>
                      </div>
                    ))}
                  </section>
                )}
                {onlyInFile.length > 0 && (
                  <section>
                    <div className="diff-title">
                      <span>{_i18n.t("仅 blacklist.txt 中禁用")}</span>
                      <span className="diff-count">{onlyInFile.length}</span>
                    </div>
                    {onlyInFile.map((file) => (
                      <div
                        className="diff-item file-only"
                        key={`file-${file}`}
                        title={file}
                      >
                        <span className="diff-source">F</span>
                        <span className="diff-file">{file}</span>
                      </div>
                    ))}
                  </section>
                )}
              </div>
              <div className="blacklist-sync-note">
                {_i18n.t("注意，该功能不支持通配符等")}
              </div>
              {error && <div className="blacklist-sync-error">{error}</div>}
              <div className="buttons">
                <button
                  onClick={async () => {
                    try {
                      await globalCtx.blacklist.switchProfile(currentProfileName);
                      await refreshProfiles(currentProfileName);
                      hide();
                    } catch (error) {
                      setError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  {_i18n.t("使用 CeleMod Profile")}
                </button>
                <button
                  onClick={async () => {
                    const importedProfileName = await callRemote<string>(
                      "import_blacklist_file_as_profile",
                      gamePath,
                      JSON.stringify(alwaysOnMods)
                    );
                    if (importedProfileName.startsWith("Failed")) {
                      setError(importedProfileName);
                      return;
                    }
                    try {
                      await refreshProfiles(importedProfileName);
                      hide();
                    } catch (error) {
                      setError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  {_i18n.t("将文件保存为新 Profile")}
                </button>
                <button onClick={() => hide()}>{_i18n.t("忽略")}</button>
              </div>
            </div>
          );
        });
        const hide = popup.hide;
        popup.hide = () => {
          if (blacklistSyncPopupRef.current === popup) {
            blacklistSyncPopupRef.current = null;
          }
          hide();
        };
        blacklistSyncPopupRef.current = popup;
      }
    };
    void checkSync().catch(console.error);
  }, [
    checkBlacklistSync,
    currentProfile,
    gamePath,
    alwaysOnMods,
    installedMods,
    currentProfileName,
  ]);

  const [, setMirror] = useMirror();

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
                v === "origin"
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
                "未找到游戏！请先安装 Steam 商店或 Epic 商店版的 Celeste，或"
              )}
            </span>
            <button onClick={() => selectGamePath(setGamePath)}>
              {_i18n.t("点此手动选择")}
            </button>
          </div>
        )}
      </section>

      <section className="home-section home-profiles-section">
        <div className="home-section-heading">
          <Icon name="file" />
          <h2>{_i18n.t("Profile 选择")}</h2>
        </div>
        <div className="profiles">
          {profiles.map((v) => (
            <div
              key={v.name}
              className={`profile ${
                v.name === currentProfileName && "selected"
              }`}
              onClick={() => {
                globalCtx.blacklist.switchProfile(v.name);
              }}
            >
              <div className="profile-main">
                <div className="name">{v.name}</div>
                <div className="profile-meta">
                  <span>
                    {_i18n.t("启用 {count} 个 Mod", {
                      count: installedMods.length - v.mods.length,
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
