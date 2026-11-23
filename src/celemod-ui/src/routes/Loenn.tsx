import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import _i18n from "../i18n";
import {
  featureVisible,
  LoennConfig,
  LoennEdition,
  LoennPackage,
  LoennUltraConfig,
  LoennVersion,
  useUpdateInfo,
} from "../api/updateInfo";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Collapse } from "../components/Motion";
import { ProgressIndicator } from "../components/Progress";
import { useCurrentLang, useGamePath } from "../states";
import { callRemote, displayDate } from "../utils";
import "./Loenn.scss";

interface LoennState {
  installed: boolean;
  version: string | null;
  edition: "ultra" | "official" | string | null;
  path: string | null;
}

type DesktopPlatform = "windows" | "linux" | "macos";
type RuntimePlatform = DesktopPlatform | "android" | string;

interface InstallingTarget {
  version: LoennVersion;
  pkg: LoennPackage;
  edition: LoennEdition;
}

const LOENN_INSTALL_ROOT_STORAGE_KEY = "celemod-loenn-install-root";

const isDesktopPlatform = (
  value: RuntimePlatform | null,
): value is DesktopPlatform =>
  value === "windows" || value === "linux" || value === "macos";

const normalizeEdition = (
  value: string | null | undefined,
): LoennEdition | null => {
  if (value === "ultra") return "ultra";
  if (value === "official") return "official";
  return null;
};

const loadInstallRoot = () => {
  try {
    return localStorage.getItem(LOENN_INSTALL_ROOT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

const formatSize = (size?: number) => {
  if (!size || size <= 0) return "";
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(0)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const formatReleaseDate = (raw: string) => {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return displayDate(parsed);
};

const formatPlatformLabel = (platform: RuntimePlatform | null) => {
  if (platform === "windows") return "Windows";
  if (platform === "macos") return "macOS";
  if (platform === "linux") return "Linux";
  if (platform === "android") return "Android";
  return "";
};

const progressLabel = (state: string | null) => {
  if (state === "download") return _i18n.t("正在下载 Loenn");
  if (state === "verify") return _i18n.t("正在校验文件");
  if (state === "extract") return _i18n.t("正在解压 Loenn");
  if (state === "install") return _i18n.t("正在完成安装");
  return _i18n.t("准备安装");
};

const stepIndexFromState = (state: string | null) => {
  if (state === "download") return 0;
  if (state === "verify") return 1;
  if (state === "extract") return 2;
  if (state === "install") return 3;
  if (state === "success") return 4;
  return 0;
};

const shouldOfferExpand = (text: string) =>
  text.length > 160 || text.split("\n").length > 3;

export const Loenn = () => {
  const { currentLang } = useCurrentLang();
  const [gamePath] = useGamePath();
  const { data: updateInfo, error: configError } = useUpdateInfo();

  const officialConfig: LoennConfig | undefined = updateInfo?.loenn;
  const ultraConfig: LoennUltraConfig | undefined = updateInfo?.loenn_ultra;

  const showOfficial = featureVisible(officialConfig, currentLang);
  const showUltra = featureVisible(ultraConfig, currentLang);
  const visible = showOfficial || showUltra;

  const [activeEdition, setActiveEdition] = useState<LoennEdition>("ultra");
  const cloudDefaultApplied = useRef(false);

  const [platform, setPlatform] = useState<RuntimePlatform | null>(null);
  const [installRoot, setInstallRoot] = useState(loadInstallRoot);
  const [localState, setLocalState] = useState<LoennState | null>(null);

  const [installState, setInstallState] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<number | null>(null);
  const [installingTarget, setInstallingTarget] =
    useState<InstallingTarget | null>(null);
  const [failedReason, setFailedReason] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [expandedDescriptions, setExpandedDescriptions] = useState<
    Record<string, boolean>
  >({});

  const refreshLocalState = useCallback(
    (root = installRoot) =>
      callRemote<LoennState>("get_loenn_state", root)
        .then(setLocalState)
        .catch((error) => setLaunchError(String(error))),
    [installRoot],
  );

  useEffect(() => {
    callRemote<string>("runtime_platform")
      .then((value) => setPlatform(value))
      .catch((error) => setLaunchError(String(error)));
  }, []);

  useEffect(() => {
    setLocalState(null);
    setLaunchError(null);
    setInstallState(null);
    setInstallingTarget(null);
    void refreshLocalState(installRoot);
  }, [installRoot, refreshLocalState]);

  useEffect(() => {
    if (!updateInfo || cloudDefaultApplied.current) return;
    setActiveEdition(
      showUltra && (ultraConfig?.default_tab !== "official" || !showOfficial)
        ? "ultra"
        : "official",
    );
    cloudDefaultApplied.current = true;
  }, [showOfficial, showUltra, ultraConfig?.default_tab, updateInfo]);

  useEffect(() => {
    if (activeEdition === "ultra" && !showUltra && showOfficial) {
      setActiveEdition("official");
    } else if (activeEdition === "official" && !showOfficial && showUltra) {
      setActiveEdition("ultra");
    }
  }, [activeEdition, showOfficial, showUltra]);

  const installing =
    installState !== null &&
    installState !== "success" &&
    installState !== "failed";

  const activeConfig = activeEdition === "ultra" ? ultraConfig : officialConfig;

  const activeVersions = useMemo(
    () => activeConfig?.versions || [],
    [activeConfig?.versions],
  );

  const installedEdition = normalizeEdition(localState?.edition);

  const matchesEdition = useCallback(
    (edition: LoennEdition) => {
      if (!localState?.installed) return false;
      if (installedEdition === edition) return true;
      if (installedEdition === null && edition === "official") return true;
      return false;
    },
    [installedEdition, localState?.installed],
  );

  const isRowInstalled = useCallback(
    (itemVersion: string, edition: LoennEdition) =>
      Boolean(
        localState?.installed &&
          localState.version === itemVersion &&
          matchesEdition(edition),
      ),
    [localState?.installed, localState?.version, matchesEdition],
  );

  const getPackageForPlatform = useCallback(
    (item: LoennVersion): LoennPackage | undefined =>
      isDesktopPlatform(platform) ? item.packages?.[platform] : undefined,
    [platform],
  );

  const quickInstallCandidate = useMemo(() => {
    if (!isDesktopPlatform(platform)) return null;
    for (const item of activeVersions) {
      const pkg = item.packages?.[platform];
      if (pkg) {
        return { version: item, pkg };
      }
    }
    return null;
  }, [activeVersions, platform]);

  const installVersion = (item: LoennVersion, edition: LoennEdition) => {
    const pkg = getPackageForPlatform(item);
    if (!pkg) return;
    setInstallingTarget({ version: item, pkg, edition });
    setInstallState("download");
    setInstallProgress(0);
    setFailedReason(null);
    setLaunchError(null);
    callRemote(
      "download_and_install_loenn",
      installRoot,
      item.version,
      pkg.url,
      pkg.package_type,
      pkg.file_name,
      pkg.executable,
      pkg.sha256 || "",
      edition,
      (state: string, value: unknown) => {
        setInstallState(state);
        if (state === "failed") {
          setFailedReason(String(value));
        } else if (typeof value === "number") {
          setInstallProgress(value);
        }
        if (state === "success") {
          setInstallProgress(100);
          void refreshLocalState(installRoot);
        }
      },
    ).catch((error) => {
      setInstallState("failed");
      setFailedReason(String(error));
    });
  };

  const launch = () => {
    setLaunchError(null);
    // Lönn asks for the Celeste directory on first start; hand it the install CeleMod
    // already manages so the editor opens straight into the map.
    callRemote("start_loenn", installRoot, gamePath).catch((error) =>
      setLaunchError(String(error)),
    );
  };

  const chooseInstallRoot = async () => {
    setLaunchError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: _i18n.t("选择其他路径"),
      });
      if (typeof selected !== "string") return;
      localStorage.setItem(LOENN_INSTALL_ROOT_STORAGE_KEY, selected);
      setInstallRoot(selected);
      if (selected === installRoot) void refreshLocalState(selected);
    } catch (error) {
      setLaunchError(String(error));
    }
  };

  const resetInstallRoot = () => {
    try {
      localStorage.removeItem(LOENN_INSTALL_ROOT_STORAGE_KEY);
      setInstallRoot("");
    } catch (error) {
      setLaunchError(String(error));
    }
  };

  const toggleDescription = (key: string) => {
    setExpandedDescriptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectEdition = (edition: LoennEdition) => {
    if (installing) return;
    setActiveEdition(edition);
    if (installState === "success" || installState === "failed") {
      setInstallState(null);
      setInstallingTarget(null);
    }
  };

  if (!updateInfo && !configError) {
    return (
      <div className="loenn loenn-loading" role="status" aria-live="polite">
        <ProgressIndicator infinite />
      </div>
    );
  }

  if (!visible) {
    return (
      <div className="loenn loenn-unavailable">
        <div className="loenn-empty-notice">
          <Icon name="warn" />
          <strong>{_i18n.t("Loenn 当前不可用")}</strong>
          {configError ? <p>{String(configError)}</p> : null}
        </div>
      </div>
    );
  }

  const ultraName = ultraConfig?.name || "Loenn Ultra";
  const activeName =
    activeConfig?.name || (activeEdition === "ultra" ? "Loenn Ultra" : "Lönn");
  const activeDescription = activeConfig?.description?.trim() || "";
  const activeHomepage = activeConfig?.homepage || "";

  const installSteps = [
    { key: "download", label: _i18n.t("下载") },
    { key: "verify", label: _i18n.t("校验") },
    { key: "extract", label: _i18n.t("解压") },
    { key: "install", label: _i18n.t("完成") },
  ];

  const currentStepIdx = stepIndexFromState(installState);
  const clampedProgress = Math.max(
    0,
    Math.min(100, Math.round(installProgress ?? 0)),
  );
  const isAndroid = platform === "android";
  const platformLabel = formatPlatformLabel(platform);

  return (
    <div className="loenn">
      <header className="loenn-header">
        <div className="loenn-title-group">
          <h1>Lönn</h1>
          <p className="loenn-subtitle">
            {_i18n.t("Celeste 自定义地图编辑器")}
          </p>
        </div>
        <div className="loenn-header-links">
          {activeHomepage ? (
            <button
              type="button"
              className="loenn-ghost-btn"
              onClick={() => callRemote("open_url", activeHomepage)}
            >
              <Icon name="external" />
              <span>{_i18n.t("项目主页")}</span>
            </button>
          ) : null}
          {localState?.path ? (
            <button
              type="button"
              className="loenn-ghost-btn"
              onClick={() => callRemote("open_url", localState.path!)}
            >
              <Icon name="folder" />
              <span>{_i18n.t("打开目录")}</span>
            </button>
          ) : null}
        </div>
      </header>

      <section className="loenn-local" aria-label={_i18n.t("本地版本")}>
        <div className="loenn-status-main">
          <div className="loenn-local-info">
            <span className="loenn-local-label">
              {localState === null
                ? _i18n.t("正在检查本地状态")
                : localState.installed
                  ? _i18n.t("当前已安装")
                  : _i18n.t("本地版本")}
            </span>

            <div className="loenn-local-headline">
              {localState?.installed ? (
                <>
                  <strong className="loenn-local-version">
                    {localState.version || "—"}
                  </strong>
                  {installedEdition === "ultra" ? (
                    <span className="loenn-badge loenn-badge-ultra">Ultra</span>
                  ) : installedEdition === "official" ? (
                    <span className="loenn-badge loenn-badge-neutral">
                      {_i18n.t("官方版")}
                    </span>
                  ) : (
                    <span className="loenn-badge loenn-badge-neutral">
                      {_i18n.t("本地安装")}
                    </span>
                  )}
                </>
              ) : (
                <strong className="loenn-local-version is-empty">
                  {localState === null ? "—" : _i18n.t("尚未安装")}
                </strong>
              )}
            </div>

            <div className="loenn-path-row">
              <span
                className="loenn-path-display"
                title={localState?.path || installRoot || undefined}
              >
                <Icon name="folder" />
                <span className="loenn-path-text">
                  {localState?.path ||
                    installRoot ||
                    _i18n.t("默认安装目录")}
                </span>
              </span>
              <span className="loenn-path-actions">
                <button
                  type="button"
                  className="loenn-inline-link"
                  disabled={installing}
                  onClick={chooseInstallRoot}
                >
                  {_i18n.t("更改路径")}
                </button>
                {installRoot ? (
                  <button
                    type="button"
                    className="loenn-inline-link"
                    disabled={installing}
                    onClick={resetInstallRoot}
                  >
                    {_i18n.t("重置默认")}
                  </button>
                ) : null}
              </span>
            </div>
          </div>

          <div className="loenn-local-cta">
            {localState?.installed ? (
              <Button
                type="primary"
                className="loenn-launch-btn"
                disabled={installing}
                onClick={launch}
              >
                <Icon name="play" />
                <span>
                  {installedEdition === "ultra"
                    ? _i18n.t("启动 Loenn Ultra")
                    : _i18n.t("启动 Lönn")}
                </span>
              </Button>
            ) : quickInstallCandidate ? (
              <Button
                type="primary"
                className="loenn-launch-btn"
                disabled={installing}
                onClick={() =>
                  installVersion(quickInstallCandidate.version, activeEdition)
                }
              >
                <Icon name="download" />
                <span>
                  {activeEdition === "ultra"
                    ? _i18n.t("安装 Loenn Ultra")
                    : _i18n.t("安装 Lönn")}
                </span>
              </Button>
            ) : (
              <Button type="primary" className="loenn-launch-btn" disabled>
                <Icon name="play" />
                <span>{_i18n.t("启动 Lönn")}</span>
              </Button>
            )}
          </div>
        </div>

        <Collapse open={Boolean(launchError)} appear>
          <div className="loenn-inline-error" role="alert">
            <Icon name="warn" />
            <span>{launchError}</span>
            <button
              type="button"
              className="loenn-icon-btn"
              aria-label={_i18n.t("关闭")}
              onClick={() => setLaunchError(null)}
            >
              <Icon name="i-cross" />
            </button>
          </div>
        </Collapse>
      </section>

      {showUltra && showOfficial ? (
        <div
          className="loenn-edition-tabs centered-tab-buttons"
          role="tablist"
          aria-label={_i18n.t("版本分支")}
        >
          {showUltra ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeEdition === "ultra"}
              className={activeEdition === "ultra" ? "active ultra" : "ultra"}
              disabled={installing}
              onClick={() => selectEdition("ultra")}
            >
              <Icon name="star" />
              <span>{ultraName}</span>
              <span className="loenn-rec-badge">{_i18n.t("推荐")}</span>
            </button>
          ) : null}
          {showOfficial ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeEdition === "official"}
              className={activeEdition === "official" ? "active" : ""}
              disabled={installing}
              onClick={() => selectEdition("official")}
            >
              <Icon name="edit" />
              <span>{_i18n.t("Lönn 官方版")}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <section
        key={activeEdition}
        className={`loenn-edition-intro ui-panel-enter${
          activeEdition === "ultra" ? " is-ultra" : ""
        }`}
      >
        <span className="loenn-kicker">
          {activeEdition === "ultra"
            ? `LOENN ULTRA · ${_i18n.t("推荐版本")}`
            : `LÖNN · ${_i18n.t("官方原版")}`}
        </span>
        <strong>{activeName}</strong>
        {activeDescription ? <p>{activeDescription}</p> : null}
      </section>

      {installState !== null ? (
        <section
          key="loenn-install"
          className={`loenn-versions loenn-install-section ui-panel-enter is-${
            installing ? "active" : installState
          }`}
          role="status"
          aria-live="polite"
        >
          {installingTarget ? (
            <div className="loenn-install-target">
              <span
                className={`loenn-badge ${
                  installingTarget.edition === "ultra"
                    ? "loenn-badge-ultra"
                    : "loenn-badge-neutral"
                }`}
              >
                {installingTarget.edition === "ultra"
                  ? ultraName
                  : _i18n.t("Lönn 官方版")}
              </span>
              <strong className="loenn-install-target-ver">
                {installingTarget.version.version}
              </strong>
              {installingTarget.pkg.size ? (
                <span className="loenn-install-target-size">
                  {formatSize(installingTarget.pkg.size)}
                </span>
              ) : null}
            </div>
          ) : null}

          {installing ? (
            <div key="progress" className="loenn-progress-body ui-panel-enter">
              <ol className="loenn-steps">
                {installSteps.map((step, idx) => {
                  const statusClass =
                    idx < currentStepIdx
                      ? "is-done"
                      : idx === currentStepIdx
                        ? "is-current"
                        : "";
                  return (
                    <li key={step.key} className={`loenn-step ${statusClass}`}>
                      <span className="loenn-step-index" aria-hidden="true">
                        {idx < currentStepIdx ? (
                          <span className="loenn-step-check ui-pop-enter">
                            <Icon name="i-tick" />
                          </span>
                        ) : (
                          idx + 1
                        )}
                      </span>
                      <span className="loenn-step-label">{step.label}</span>
                    </li>
                  );
                })}
              </ol>

              <div
                className="loenn-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={clampedProgress}
                aria-label={progressLabel(installState)}
              >
                <div
                  className="loenn-progress-fill"
                  style={{ width: `${clampedProgress}%` }}
                />
              </div>

              <div className="loenn-progress-footer">
                <span className="loenn-progress-label">
                  {progressLabel(installState)}
                </span>
                <span className="loenn-progress-pct">{clampedProgress}%</span>
              </div>
            </div>
          ) : installState === "success" ? (
            <div key="success" className="loenn-result-body ui-panel-enter">
              <div className="loenn-result-heading is-success">
                <span
                  className="loenn-result-icon ui-pop-enter"
                  aria-hidden="true"
                >
                  <Icon name="i-tick" />
                </span>
                <div>
                  <strong>{_i18n.t("安装完成")}</strong>
                  <p>
                    {_i18n.t("已准备好启动编辑器，可直接打开地图开始制作。")}
                  </p>
                </div>
              </div>
              <div className="loenn-result-actions">
                <Button type="primary" onClick={launch}>
                  <Icon name="play" />
                  <span>{_i18n.t("立即启动")}</span>
                </Button>
                <Button onClick={() => setInstallState(null)}>
                  <span>{_i18n.t("查看其他版本")}</span>
                </Button>
              </div>
            </div>
          ) : (
            <div
              key="failed"
              className="loenn-result-body ui-panel-enter"
              role="alert"
            >
              <div className="loenn-result-heading is-failed">
                <span
                  className="loenn-result-icon ui-pop-enter"
                  aria-hidden="true"
                >
                  <Icon name="fail" />
                </span>
                <div>
                  <strong>{_i18n.t("安装失败")}</strong>
                  <p>{_i18n.t("请检查网络连接或目标目录权限后重试。")}</p>
                </div>
              </div>
              <textarea
                readOnly
                className="loenn-error-log"
                aria-label={_i18n.t("安装失败")}
                value={failedReason || ""}
              />
              <div className="loenn-result-actions">
                {installingTarget ? (
                  <Button
                    type="primary"
                    onClick={() =>
                      installVersion(
                        installingTarget.version,
                        installingTarget.edition,
                      )
                    }
                  >
                    <Icon name="replay" />
                    <span>{_i18n.t("重试")}</span>
                  </Button>
                ) : null}
                <Button onClick={() => setInstallState(null)}>
                  <span>{_i18n.t("返回")}</span>
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section
          key={`versions-${activeEdition}`}
          className="loenn-versions ui-panel-enter"
        >
          <div className="loenn-versions-head">
            <div className="loenn-versions-title">
              <h2>{_i18n.t("可用版本")}</h2>
              {activeVersions.length > 0 ? (
                <span className="loenn-count">{activeVersions.length}</span>
              ) : null}
            </div>
            {platformLabel ? (
              <span className="loenn-platform-tag">{platformLabel}</span>
            ) : null}
          </div>

          {isAndroid ? (
            <div className="loenn-flat-state">
              <Icon name="warn" />
              <div className="loenn-flat-state-copy">
                <strong>{_i18n.t("当前系统没有可用安装包")}</strong>
                <p>
                  {_i18n.t(
                    "Lönn 仅提供 Windows、macOS 与 Linux 桌面端安装包。",
                  )}
                </p>
              </div>
            </div>
          ) : activeVersions.length === 0 ? (
            <div className="loenn-flat-state">
              <div className="loenn-flat-state-copy">
                <strong>{_i18n.t("暂无可用版本")}</strong>
              </div>
            </div>
          ) : (
            <div className="loenn-version-list">
              {activeVersions.map((item, index) => {
                const pkg = getPackageForPlatform(item);
                const rowInstalled = isRowInstalled(item.version, activeEdition);
                const isLatest = index === 0;
                const isUpdate = Boolean(
                  localState?.installed &&
                    matchesEdition(activeEdition) &&
                    isLatest &&
                    !rowInstalled,
                );
                const rowKey = `${activeEdition}-${item.version}`;
                const desc = item.description?.trim() || "";
                const canExpand = desc ? shouldOfferExpand(desc) : false;
                const isExpanded = Boolean(expandedDescriptions[rowKey]);
                const hasToggledDesc = Object.prototype.hasOwnProperty.call(
                  expandedDescriptions,
                  rowKey,
                );
                const dateText = formatReleaseDate(item.date);
                const sizeText = formatSize(pkg?.size);

                return (
                  <article
                    key={rowKey}
                    className={`loenn-version-row${
                      rowInstalled ? " is-installed" : ""
                    }`}
                  >
                    <div className="loenn-version-main">
                      <div className="loenn-version-identity">
                        <strong className="loenn-version-tag">
                          {item.version}
                        </strong>
                        {isLatest ? (
                          <span className="loenn-badge loenn-badge-latest">
                            {_i18n.t("最新")}
                          </span>
                        ) : null}
                        {rowInstalled ? (
                          <span className="loenn-badge loenn-badge-installed">
                            <Icon name="i-tick" />
                            <span>{_i18n.t("已安装")}</span>
                          </span>
                        ) : null}
                      </div>

                      <div className="loenn-version-controls">
                        <div className="loenn-version-meta">
                          {dateText ? <span>{dateText}</span> : null}
                          {sizeText ? <span>{sizeText}</span> : null}
                        </div>

                        {!platform ? (
                          <span className="loenn-row-note">
                            {_i18n.t("正在检测系统")}
                          </span>
                        ) : !pkg ? (
                          <span className="loenn-row-note">
                            {_i18n.t("当前系统没有可用安装包")}
                          </span>
                        ) : rowInstalled ? (
                          <div className="loenn-row-action-group">
                            <button
                              type="button"
                              className="loenn-icon-btn"
                              title={_i18n.t("重新安装")}
                              aria-label={_i18n.t("重新安装")}
                              onClick={() =>
                                installVersion(item, activeEdition)
                              }
                            >
                              <Icon name="replay" />
                            </button>
                            <Button className="loenn-row-btn" disabled>
                              <span>{_i18n.t("已安装")}</span>
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type={isLatest ? "primary" : undefined}
                            className="loenn-row-btn"
                            onClick={() => installVersion(item, activeEdition)}
                          >
                            <Icon name="download" />
                            <span>
                              {isUpdate
                                ? _i18n.t("更新")
                                : _i18n.t("安装")}
                            </span>
                          </Button>
                        )}
                      </div>
                    </div>

                    {desc ? (
                      <div className="loenn-version-desc-wrap">
                        <p
                          key={isExpanded ? "expanded" : "clamped"}
                          className={`loenn-version-desc${
                            canExpand && !isExpanded ? " is-clamped" : ""
                          }${hasToggledDesc ? " is-desc-transitioning" : ""}`}
                        >
                          {desc}
                        </p>
                        {canExpand ? (
                          <button
                            type="button"
                            className="loenn-inline-link loenn-desc-toggle"
                            aria-expanded={isExpanded}
                            onClick={() => toggleDescription(rowKey)}
                          >
                            {isExpanded
                              ? _i18n.t("收起")
                              : _i18n.t("展开详情")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
