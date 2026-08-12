import _i18n from "src/i18n";
import { Fragment, useContext, useEffect, useState } from "react";
import { useGlobalContext } from "../App";
import {
  initAutoDisableNewMods,
  reloadBlacklistState,
  useAppStore,
  useAutoDisableNewMods,
  useGamePath,
} from "../states";
import { callRemote } from "../utils";
import { Icon } from "./Icon";
import { PopupContext, createPopup } from "./Popup";
import { ProgressIndicator } from "./Progress";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./DropInstaller.scss";
import { installProfileFile } from "../profileInstall";

interface LocalInstallProgress {
  current: number;
  total: number;
  file: string;
  detail: string;
  progress: number;
}

interface LocalInstallResult {
  file: string;
  packageType: "mod" | "everest" | "unknown";
  success: boolean;
  error: string;
}

let localInstallRunning = false;

const getDroppedPaths = (event: any): string[] => {
  const detail = event.detail ?? event.details ?? event.data;
  const value = detail?.data?.file;
  if (!value) return [];
  const paths = Array.isArray(value) ? value : [value];

  return paths
    .filter((path) => typeof path === "string")
    .map((path) => {
      let decoded = path;
      try {
        decoded = decodeURI(path);
      } catch (_) {
        // Keep the original path; the backend will report a useful error.
      }
      if (!decoded.startsWith("file://")) return decoded;
      decoded = decoded.slice("file://".length);
      if (
        navigator.userAgent.includes("Windows") &&
        /^\/[A-Za-z]:/.test(decoded)
      ) {
        decoded = decoded.slice(1);
      }
      return decoded;
    });
};

const consumeDropEvent = (event: any) => {
  event.preventDefault?.();
  event.stopPropagation?.();
};

const getDisplayFileName = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

const splitProgressDetail = (detail: string) => {
  const match = detail.match(/^\[(\d+)\/(\d+)\]\s*(.*)$/);
  if (!match) return { step: "", description: detail };
  return {
    step: `${match[1]} / ${match[2]}`,
    description: match[3],
  };
};

const LocalInstallPopup = ({
  paths,
  gamePath,
  autoDisableNewMods,
  onInstalled,
}: {
  paths: string[];
  gamePath: string;
  autoDisableNewMods: boolean;
  onInstalled: (results: LocalInstallResult[]) => void;
}) => {
  const { hide } = useContext(PopupContext);
  const [progress, setProgress] = useState<LocalInstallProgress | null>(null);
  const [results, setResults] = useState<LocalInstallResult[] | null>(null);
  const [fatalError, setFatalError] = useState("");
  const profileEnabled = useAppStore((state) => state.profileEnabled);
  const currentProfileName = useAppStore((state) => state.currentProfileName);
  const alwaysOnMods = useAppStore((state) => state.alwaysOnMods);

  useEffect(() => {
    callRemote(
      "install_local_packages",
      gamePath,
      JSON.stringify(paths),
      autoDisableNewMods,
      profileEnabled,
      currentProfileName,
      JSON.stringify(alwaysOnMods),
      (state: string, payload: string) => {
        if (state === "progress") {
          setProgress(JSON.parse(payload));
          return;
        }
        localInstallRunning = false;
        if (state === "finished") {
          const nextResults = JSON.parse(payload) as LocalInstallResult[];
          setResults(nextResults);
          onInstalled(nextResults);
        } else {
          setFatalError(payload);
        }
      }
    );
  }, []);

  const successCount = results?.filter((result) => result.success).length ?? 0;
  const current = progress?.current ?? 1;
  const total = progress?.total ?? paths.length;
  const progressValue = progress?.progress ?? 0;
  const detail = splitProgressDetail(progress?.detail ?? "");

  return (
    <div className="popup-content local-install-popup">
      <div className="title">{_i18n.t("拖入安装")}</div>
      <div className="content">
        {fatalError ? (
          <Fragment>
            <div className="install-summary failed">
              <Icon name="i-cross" />
              <span>{_i18n.t("安装失败")}</span>
            </div>
            <div className="fatal-error">{_i18n.t(fatalError)}</div>
          </Fragment>
        ) : results ? (
          <Fragment>
            <div className="install-summary">
              <Icon
                name={successCount === results.length ? "i-tick" : "i-asterisk"}
              />
              <span>
                {_i18n.t("已安装 {success}/{total} 个包", {
                  success: successCount,
                  total: results.length,
                })}
              </span>
            </div>
            <div className="local-install-results">
              {results.map((result, index) => (
                <div
                  key={`${result.file}-${index}`}
                  className={`local-install-result ${
                    result.success ? "success" : "failed"
                  }`}
                >
                  <div className="result-main">
                    <span className="result-status">
                      <Icon name={result.success ? "i-tick" : "i-cross"} />
                    </span>
                    <span className="result-file" title={result.file}>
                      {result.file}
                    </span>
                    <span className="result-type">
                      {result.packageType === "everest"
                        ? "Everest"
                        : result.packageType === "mod"
                        ? "Mod"
                        : "?"}
                    </span>
                  </div>
                  {result.error ? (
                    <div className="result-error">{result.error}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </Fragment>
        ) : (
          <div className="local-install-progress">
            <ProgressIndicator
              size={80}
              lineWidth={5}
              {...(progressValue > 0
                ? { value: progressValue, max: 100 }
                : { infinite: true })}
            />
            <div className="progress-heading">
              <span className="progress-title">{_i18n.t("正在安装")}</span>
              {total > 1 ? (
                <span className="progress-count">
                  {current} / {total}
                </span>
              ) : null}
            </div>
            <div className="progress-file" title={progress?.file ?? paths[0]}>
              {progress?.file ?? getDisplayFileName(paths[0])}
            </div>
            {detail.description ? (
              <div className="progress-detail" title={progress?.detail}>
                {detail.step ? (
                  <span className="progress-step">{detail.step}</span>
                ) : null}
                <span className="progress-description">
                  {_i18n.t(detail.description)}
                </span>
                {progressValue > 0 ? (
                  <span className="progress-percent">
                    {Math.round(progressValue)}%
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {(results || fatalError) && (
        <div className="buttons">
          <button onClick={hide}>{_i18n.t("确认")}</button>
        </div>
      )}
    </div>
  );
};

const showMissingGamePopup = () => {
  createPopup(() => {
    const { hide } = useContext(PopupContext);
    return (
      <div className="popup-content">
        <div className="title">{_i18n.t("无法安装")}</div>
        <div className="content">
          {_i18n.t("请先选择 Celeste 游戏路径，再拖入安装包。")}
        </div>
        <div className="buttons">
          <button onClick={hide}>{_i18n.t("确认")}</button>
        </div>
      </div>
    );
  });
};

export const DropInstaller = () => {
  initAutoDisableNewMods();
  const [autoDisableNewMods] = useAutoDisableNewMods();
  const [gamePath] = useGamePath();
  const ctx = useGlobalContext();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter") {
          if (!localInstallRunning && event.payload.paths.length > 0)
            setDragging(true);
          return;
        }
        if (event.payload.type === "leave") {
          setDragging(false);
          return;
        }
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths;
        setDragging(false);
        if (localInstallRunning || paths.length === 0) return;
        const profilePath = paths.find((path) => /\.json$/i.test(path));
        if (profilePath) {
          if (!gamePath) {
            showMissingGamePopup();
            return;
          }
          void installProfileFile(gamePath, profilePath, () => {
            void ctx.modManage.reloadMods();
          }).catch(console.error);
          return;
        }
        if (!gamePath) {
          showMissingGamePopup();
          return;
        }

        localInstallRunning = true;
        createPopup(
          () => (
            <LocalInstallPopup
              paths={paths}
              gamePath={gamePath}
              autoDisableNewMods={autoDisableNewMods}
              onInstalled={(results) => {
                if (
                  results.some(
                    (result) => result.success && result.packageType === "mod"
                  )
                ) {
                  ctx.modManage.reloadMods().catch(console.error);
                  if (autoDisableNewMods) {
                    void reloadBlacklistState(gamePath).catch(console.error);
                  }
                }
                if (
                  results.some(
                    (result) =>
                      result.success && result.packageType === "everest"
                  )
                ) {
                  ctx.everest.updateEverestVersion();
                }
              }}
            />
          ),
          { cancelable: false }
        );
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(console.error);
    return () => unlisten?.();
  }, [autoDisableNewMods, gamePath, ctx]);

  return (
    <div className={`drop-install-overlay ${dragging ? "visible" : ""}`}>
      <div className="drop-install-card">
        <Icon name="download" />
        <div className="drop-install-title">{_i18n.t("松开以安装")}</div>
        <div className="drop-install-description">
          {_i18n.t("支持 Mod 与 Everest 的 zip 安装包")}
        </div>
      </div>
    </div>
  );
};
