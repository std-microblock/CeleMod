import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import _i18n from "../i18n";
import { Icon } from "./Icon";
import { checkUpdate } from "./SelfUpdate";
import {
  featureVisible,
  type LoennEdition,
  type LoennPackage,
  type LoennVersion,
  useUpdateInfo,
} from "../api/updateInfo";
import type { EverestUpdateTarget } from "../api/everestUpdate";
import { useEverestInstallState } from "../context/everest";
import {
  collectModUpdates,
  type LatestModInfo,
  type LatestModTuple,
} from "../modUpdates";
import {
  reloadInstalledMods,
  useAppStore,
  useCurrentEverestUltra,
  useCurrentLang,
  useGamePath,
  useMirror,
} from "../states";
import { useDownloadStore } from "../stores/download";
import { detectDesktopPlatform } from "../tauri/window";
import { callRemote, compareVersion } from "../utils";
import { useGlobalContext } from "../App";

interface LoennState {
  installed: boolean;
  version: string | null;
  edition: string | null;
  path: string | null;
}

type DesktopPlatform = "windows" | "linux" | "macos";

interface LoennUpdateTarget {
  edition: LoennEdition;
  name: string;
  currentVersion: string;
  version: LoennVersion;
  pkg: LoennPackage;
}

const LOENN_INSTALL_ROOT_STORAGE_KEY = "celemod-loenn-install-root";

const loadLoennInstallRoot = () => {
  try {
    return localStorage.getItem(LOENN_INSTALL_ROOT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

const isDesktopOs = (value: string | null): value is DesktopPlatform =>
  value === "windows" || value === "linux" || value === "macos";

const normalizeAppVersion = (raw: string) =>
  raw
    .split("")
    .filter((ch) => ch === "." || !Number.isNaN(Number.parseInt(ch, 10)))
    .join("");

export interface HomeUpdatesCardProps {
  refreshToken: number;
  everestTarget: EverestUpdateTarget | null;
  hasEverestUpdate: boolean;
  everestInstalledBuild: number;
}

export const HomeUpdatesCard = ({
  refreshToken,
  everestTarget,
  hasEverestUpdate,
  everestInstalledBuild,
}: HomeUpdatesCardProps) => {
  const globalCtx = useGlobalContext();
  const { currentLang } = useCurrentLang();
  const chinese = currentLang === "zh-CN";
  const isAndroid = detectDesktopPlatform() === "android";
  const [gamePath] = useGamePath();
  const [mirror] = useMirror();
  const { currentEverestIsUltra } = useCurrentEverestUltra();
  const installedMods = useAppStore((state) => state.installedMods);
  const showUpdate = useAppStore((state) => state.showUpdate);
  const downloadMod = useDownloadStore((state) => state.downloadMod);
  const { data: updateInfo } = useUpdateInfo();
  const everestInstallState = useEverestInstallState(
    (state) => state.everestInstallState,
  );

  // 1. CeleMod self-update state
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    if (isAndroid) return;
    let active = true;
    void callRemote<string>("celemod_version")
      .then((ver) => {
        if (active) setAppVersion(normalizeAppVersion(ver));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isAndroid, refreshToken]);

  const celemodLatestVersion = useMemo(
    () => (updateInfo?.version ? normalizeAppVersion(updateInfo.version) : ""),
    [updateInfo?.version],
  );
  const hasCelemodUpdate = Boolean(
    !isAndroid &&
      appVersion &&
      celemodLatestVersion &&
      compareVersion(appVersion, celemodLatestVersion) < 0,
  );

  // 2. Mod updates state (exact same archive hash + catalog check as Manage)
  const [latestRaw, setLatestRaw] = useState<LatestModTuple[]>([]);
  const [archiveHashes, setArchiveHashes] = useState<Record<string, string>>(
    {},
  );
  const [modBatchProgress, setModBatchProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const modUpdateActive = useRef(false);

  useEffect(() => {
    if (!gamePath || !showUpdate) {
      setLatestRaw([]);
      return;
    }
    let active = true;
    void callRemote("get_mod_latest_info", (data: string) => {
      if (!active) return;
      try {
        setLatestRaw(JSON.parse(data) as LatestModTuple[]);
      } catch (error) {
        console.error("Failed to parse latest mod info", error);
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [gamePath, showUpdate, refreshToken]);

  useEffect(() => {
    if (!gamePath || !showUpdate || installedMods.length === 0) {
      setArchiveHashes({});
      return;
    }
    let active = true;
    void callRemote(
      "get_mod_archive_hashes",
      `${gamePath}/Mods`,
      (data: string) => {
        if (!active) return;
        try {
          setArchiveHashes(JSON.parse(data) as Record<string, string>);
        } catch (error) {
          console.error("Failed to parse mod hashes", error);
        }
      },
    ).catch(() => {});
    return () => {
      active = false;
    };
  }, [gamePath, installedMods, showUpdate, refreshToken]);

  const modUpdates = useMemo<LatestModInfo[]>(() => {
    if (!gamePath || !showUpdate || installedMods.length === 0) return [];
    // Deduplicate by mod name (keep highest version per name)
    const byName = new Map<
      string,
      { name: string; version: string; file: string; isDirectory: boolean }
    >();
    for (const mod of installedMods) {
      const existing = byName.get(mod.name);
      if (!existing || compareVersion(mod.version, existing.version) > 0) {
        byName.set(mod.name, {
          name: mod.name,
          version: mod.version,
          file: mod.file,
          isDirectory: mod.is_directory,
        });
      }
    }
    return collectModUpdates([...byName.values()], archiveHashes, latestRaw);
  }, [archiveHashes, gamePath, installedMods, latestRaw, showUpdate]);

  // 3. Loenn / Loenn Ultra update state
  const [platform, setPlatform] = useState<string | null>(null);
  const [loennState, setLoennState] = useState<LoennState | null>(null);
  const [loennInstallState, setLoennInstallState] = useState<string | null>(
    null,
  );
  const [loennProgress, setLoennProgress] = useState<number>(0);

  const refreshLoennState = useCallback(() => {
    if (isAndroid) return;
    const root = loadLoennInstallRoot();
    void callRemote<LoennState>("get_loenn_state", root)
      .then(setLoennState)
      .catch(() => {});
  }, [isAndroid]);

  useEffect(() => {
    if (isAndroid) return;
    let active = true;
    void callRemote<string>("runtime_platform")
      .then((value) => {
        if (active) setPlatform(value);
      })
      .catch(() => {});
    refreshLoennState();
    return () => {
      active = false;
    };
  }, [isAndroid, refreshLoennState, refreshToken]);

  const loennUpdate = useMemo<LoennUpdateTarget | null>(() => {
    if (
      isAndroid ||
      !isDesktopOs(platform) ||
      !loennState?.installed ||
      !loennState.version
    ) {
      return null;
    }
    const installedEdition: LoennEdition =
      loennState.edition === "ultra" ? "ultra" : "official";
    const config =
      installedEdition === "ultra"
        ? updateInfo?.loenn_ultra
        : updateInfo?.loenn;
    if (!featureVisible(config, currentLang)) return null;
    const latest = config?.versions?.[0];
    if (!latest) return null;
    const pkg = latest.packages?.[platform];
    if (!pkg) return null;
    if (compareVersion(latest.version, loennState.version) <= 0) return null;
    return {
      edition: installedEdition,
      name:
        config?.name || (installedEdition === "ultra" ? "Loenn Ultra" : "Lönn"),
      currentVersion: loennState.version,
      version: latest,
      pkg,
    };
  }, [currentLang, isAndroid, loennState, platform, updateInfo]);

  // 4. Everest install state
  const everestInstalling =
    everestInstallState.installingUrl !== null &&
    everestInstallState.status !== "Success" &&
    everestInstallState.status !== "Failed";
  const loennInstalling =
    loennInstallState !== null &&
    loennInstallState !== "success" &&
    loennInstallState !== "failed";

  // Actions
  const startEverestUpdate = useCallback(() => {
    if (!everestTarget || everestInstalling) return;
    if (everestInstallState.installingUrl !== null) {
      globalCtx.everest.clearInstallState();
    }
    globalCtx.everest.downloadAndInstallEverest(
      everestTarget.url,
      everestTarget.postInstallFixes,
    );
  }, [
    everestInstallState.installingUrl,
    everestInstalling,
    everestTarget,
    globalCtx.everest,
  ]);

  const updateSources = useCallback(
    (update: LatestModInfo) => {
      const mirrorUrl = update.gbFile
        ? mirror === "wegfan"
          ? `https://celeste.weg.fan/api/v2/download/gamebanana-files/${update.gbFile}`
          : mirror === "0x0ade"
            ? `https://celestemodupdater.0x0a.de/banana-mirror/${update.gbFile}.zip`
            : `https://gamebanana.com/dl/${update.gbFile}`
        : "";
      return [
        ...new Set(
          [mirrorUrl, update.url, update.gbFile].filter(
            (source): source is string => Boolean(source),
          ),
        ),
      ];
    },
    [mirror],
  );

  const downloadOneMod = useCallback(
    (name: string, source: string) =>
      new Promise<boolean>((resolve) => {
        downloadMod(name, source, {
          force: true,
          deferProfileUpdate: true,
          onFinished: () => resolve(true),
          onFailed: () => resolve(false),
        });
      }),
    [downloadMod],
  );

  const startModUpdates = useCallback(() => {
    if (modUpdateActive.current || modUpdates.length === 0 || !gamePath) return;
    modUpdateActive.current = true;
    const targets = [...modUpdates];
    setModBatchProgress({ completed: 0, total: targets.length });

    let completed = 0;
    const step = () => {
      completed += 1;
      setModBatchProgress({ completed, total: targets.length });
    };

    void Promise.all(
      targets.map(async (item) => {
        try {
          for (const source of updateSources(item)) {
            if (await downloadOneMod(item.name, source)) break;
          }
        } finally {
          step();
        }
      }),
    )
      .then(() => reloadInstalledMods(gamePath))
      .catch(console.error)
      .finally(() => {
        modUpdateActive.current = false;
        setModBatchProgress(null);
      });
  }, [downloadOneMod, gamePath, modUpdates, updateSources]);

  const startLoennUpdate = useCallback(() => {
    if (!loennUpdate || loennInstalling) return;
    const root = loadLoennInstallRoot();
    setLoennInstallState("download");
    setLoennProgress(0);
    void callRemote(
      "download_and_install_loenn",
      root,
      loennUpdate.version.version,
      loennUpdate.pkg.url,
      loennUpdate.pkg.package_type,
      loennUpdate.pkg.file_name,
      loennUpdate.pkg.executable,
      loennUpdate.pkg.sha256 || "",
      loennUpdate.edition,
      (state: string, value: unknown) => {
        setLoennInstallState(state);
        if (typeof value === "number") setLoennProgress(value);
        if (state === "success") {
          refreshLoennState();
          window.setTimeout(() => setLoennInstallState(null), 1500);
        }
      },
    ).catch((error) => {
      console.error("Failed to update Loenn from Home", error);
      setLoennInstallState("failed");
    });
  }, [loennInstalling, loennUpdate, refreshLoennState]);

  const showEverestRow = Boolean(
    (hasEverestUpdate && everestTarget) || everestInstalling,
  );
  const showModsRow = Boolean(modUpdates.length > 0 || modBatchProgress);
  const showLoennRow = Boolean(loennUpdate || loennInstalling);

  const actionableCount =
    (hasCelemodUpdate ? 1 : 0) +
    (hasEverestUpdate && everestTarget ? 1 : 0) +
    modUpdates.length +
    (loennUpdate ? 1 : 0);

  const hasAnyVisibleRow =
    hasCelemodUpdate || showEverestRow || showModsRow || showLoennRow;

  if (!hasAnyVisibleRow) return null;

  const hasAutoUpdatable =
    (hasEverestUpdate && everestTarget && !everestInstalling) ||
    (modUpdates.length > 0 && !modBatchProgress) ||
    (loennUpdate && !loennInstalling);

  const anyBusy =
    everestInstalling || modBatchProgress !== null || loennInstalling;

  const updateAll = () => {
    if (hasEverestUpdate && everestTarget && !everestInstalling) {
      startEverestUpdate();
    }
    if (modUpdates.length > 0 && !modBatchProgress) {
      startModUpdates();
    }
    if (loennUpdate && !loennInstalling) {
      startLoennUpdate();
    }
    if (hasCelemodUpdate && !hasAutoUpdatable) {
      void checkUpdate(true).catch(console.error);
    }
  };

  const modPreviewNames = (() => {
    const names = modUpdates.slice(0, 3).map((item) => item.name);
    if (modUpdates.length > 3) {
      return chinese
        ? `${names.join("、")} 等 ${modUpdates.length} 个模组`
        : `${names.join(", ")} +${modUpdates.length - 3} more`;
    }
    return names.join(chinese ? "、" : ", ");
  })();

  return (
    <section className="home-updates-card" aria-label={_i18n.t("发现可用更新")}>
      <div className="home-updates-header">
        <div className="home-updates-title-group">
          <span className="home-updates-icon" aria-hidden="true">
            <Icon name="download" />
          </span>
          <div>
            <h2>{_i18n.t("发现可用更新")}</h2>
            <p>
              {chinese
                ? `共 ${Math.max(actionableCount, 1)} 项可更新内容`
                : `${Math.max(actionableCount, 1)} updates available`}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="primary home-updates-all-btn"
          disabled={!hasAutoUpdatable && !hasCelemodUpdate}
          onClick={updateAll}
        >
          <Icon name="download" />
          <span>
            {anyBusy && !hasAutoUpdatable
              ? _i18n.t("更新中…")
              : _i18n.t("一键更新全部")}
          </span>
        </button>
      </div>

      <div className="home-updates-list">
        {hasCelemodUpdate ? (
          <div className="home-update-row">
            <div className="home-update-info">
              <strong>CeleMod</strong>
              <span>
                v{appVersion} → v{celemodLatestVersion}
              </span>
            </div>
            <div className="home-update-actions">
              <button
                type="button"
                className="home-update-row-btn"
                onClick={() => void checkUpdate(true).catch(console.error)}
              >
                {_i18n.t("查看更新")}
              </button>
            </div>
          </div>
        ) : null}

        {showEverestRow ? (
          <div className="home-update-row">
            <div className="home-update-info">
              <strong>
                {currentEverestIsUltra ? "Everest Ultra" : "Everest"}
              </strong>
              <span>
                {everestInstalling
                  ? _i18n.t("Everest 更新中…")
                  : everestTarget
                    ? `v${everestInstalledBuild} → ${everestTarget.version}`
                    : ""}
              </span>
            </div>
            <div className="home-update-actions">
              <button
                type="button"
                className="home-update-row-btn"
                onClick={() =>
                  everestInstalling
                    ? globalCtx.pageController.setPage("Everest")
                    : startEverestUpdate()
                }
              >
                {everestInstalling
                  ? _i18n.t("查看进度")
                  : _i18n.t("更新")}
              </button>
            </div>
          </div>
        ) : null}

        {showModsRow ? (
          <div className="home-update-row">
            <div className="home-update-info">
              <strong>
                {chinese
                  ? `模组（${modBatchProgress ? modBatchProgress.total : modUpdates.length} 个）`
                  : `Mods (${modBatchProgress ? modBatchProgress.total : modUpdates.length})`}
              </strong>
              <span title={modUpdates.map((item) => item.name).join(", ")}>
                {modBatchProgress
                  ? `${_i18n.t("更新中…")} (${modBatchProgress.completed}/${modBatchProgress.total})`
                  : modPreviewNames}
              </span>
            </div>
            <div className="home-update-actions">
              <button
                type="button"
                className="home-update-row-link"
                onClick={() => globalCtx.pageController.setPage("Manage")}
              >
                {_i18n.t("管理")}
              </button>
              <button
                type="button"
                className="home-update-row-btn"
                disabled={modBatchProgress !== null}
                onClick={startModUpdates}
              >
                {modBatchProgress ? _i18n.t("更新中…") : _i18n.t("更新")}
              </button>
            </div>
          </div>
        ) : null}

        {showLoennRow ? (
          <div className="home-update-row">
            <div className="home-update-info">
              <strong>{loennUpdate?.name || "Lönn"}</strong>
              <span>
                {loennInstalling
                  ? `${_i18n.t("更新中…")} ${Math.round(loennProgress)}%`
                  : loennUpdate
                    ? `v${loennUpdate.currentVersion} → v${loennUpdate.version.version}`
                    : ""}
              </span>
            </div>
            <div className="home-update-actions">
              <button
                type="button"
                className="home-update-row-btn"
                disabled={loennInstalling}
                onClick={startLoennUpdate}
              >
                {loennInstalling ? _i18n.t("更新中…") : _i18n.t("更新")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};
