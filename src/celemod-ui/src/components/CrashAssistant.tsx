import { DragEvent, useContext, useEffect, useMemo, useState } from "react";
import _i18n from "../i18n";
import { findCrashModFix } from "../api/crashModFix";
import { CrashModFix, getLatestUpdateInfo } from "../api/updateInfo";
import { fetch } from "../lib/http";
import { useGlobalContext } from "../App";
import { useGamePath } from "../states";
import { useDownloadStore } from "../stores/download";
import { callRemote } from "../utils";
import { Icon } from "./Icon";
import { createPopup, PopupContext } from "./Popup";
import "./CrashAssistant.scss";

interface CrashSuspect {
  name: string;
  file: string;
  installedVersion: string;
  latestVersion?: string;
  gameBananaFileId?: number;
  downloadUrl?: string;
  updateAvailable: boolean;
  confidence: number;
  evidence: string;
  dependents: { name: string; optional: boolean }[];
}

interface CrashAnalysis {
  fingerprint: string;
  eventId: string;
  crashIndex: number;
  logModifiedAt: number;
  sourceLog: string;
  errorLog?: string;
  reportPath: string;
  exception: string;
  summary: string;
  reasons: string[];
  suggestions: string[];
  suspects: CrashSuspect[];
  everestVersion?: number;
  isEverestUltra: boolean;
  excerpt: string;
}

interface OfficialEverestVersion {
  version: number;
  branch: string;
  mainDownload: string;
}

interface EverestUpdate {
  version: number;
  displayVersion: string;
  url: string;
}

const SEEN_CRASHES_KEY = "celemod-seen-everest-crashes-v1";
let crashPopupOpen = false;

interface SeenCrash {
  fingerprint: string;
  eventId?: string;
  crashIndex: number;
  logModifiedAt: number;
  sourceLog?: string;
  exception?: string;
}

const readSeenCrashes = () => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_CRASHES_KEY) || "{}") as Record<
      string,
      SeenCrash
    >;
  } catch {
    return {};
  }
};

const rememberCrash = (gamePath: string, analysis: CrashAnalysis) => {
  const seen = readSeenCrashes();
  seen[gamePath.toLocaleLowerCase()] = {
    fingerprint: analysis.fingerprint,
    eventId: analysis.eventId,
    crashIndex: analysis.crashIndex,
    logModifiedAt: analysis.logModifiedAt,
    sourceLog: analysis.sourceLog,
    exception: analysis.exception,
  };
  localStorage.setItem(SEEN_CRASHES_KEY, JSON.stringify(seen));
};

const hasSeenCrash = (gamePath: string, analysis: CrashAnalysis) => {
  const seen = readSeenCrashes()[gamePath.toLocaleLowerCase()];
  if (!seen) return false;
  if (seen.eventId && analysis.eventId && seen.eventId === analysis.eventId)
    return true;
  if (seen.fingerprint === analysis.fingerprint) return true;

  // Compatibility with records written before eventId was introduced. While
  // Everest flushes one crash, the file mtime and full-stack fingerprint can
  // change several times even though it is still the same log entry.
  return (
    seen.crashIndex === analysis.crashIndex &&
    seen.sourceLog?.toLocaleLowerCase() ===
      analysis.sourceLog.toLocaleLowerCase() &&
    seen.exception === analysis.exception &&
    Math.abs(seen.logModifiedAt - analysis.logModifiedAt) <= 5 * 60 * 1000
  );
};

const versionBuild = (value: string | number) => {
  if (typeof value === "number") return value;
  const numbers = value.match(/\d+/g)?.map(Number) || [];
  return numbers.length === 0 ? 0 : Math.max(...numbers);
};

const compareLooseVersion = (left: string, right: string) => {
  const leftParts = left.match(/\d+/g)?.map(Number) || [];
  const rightParts = right.match(/\d+/g)?.map(Number) || [];
  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index += 1
  ) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const loadCrashModFix = async (
  analysis: CrashAnalysis
): Promise<CrashModFix | null> => {
  const updateInfo = await getLatestUpdateInfo();
  return findCrashModFix(updateInfo.crash_mod_fixes, analysis);
};

const loadLatestEverest = async (
  analysis: CrashAnalysis
): Promise<EverestUpdate | null> => {
  if (analysis.isEverestUltra) {
    const updateInfo = await getLatestUpdateInfo();
    const latest = (updateInfo.everest_ultra?.versions || [])
      .filter(
        (version) =>
          !version.channel || version.channel.toLocaleLowerCase() === "stable"
      )
      .sort(
        (left, right) =>
          versionBuild(right.version) - versionBuild(left.version)
      )[0];
    return latest
      ? {
          version: versionBuild(latest.version),
          displayVersion: latest.version,
          url: latest.url,
        }
      : null;
  }

  const response = await fetch(
    "https://maddie480.ovh/celeste/everest-versions?supportsNativeBuilds=true"
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const versions = (await response.json()) as OfficialEverestVersion[];
  const latest = versions
    .filter((version) => version.branch.toLocaleLowerCase() === "stable")
    .sort((left, right) => right.version - left.version)[0];
  return latest
    ? {
        version: latest.version,
        displayVersion: String(latest.version),
        url: latest.mainDownload,
      }
    : null;
};

const fileName = (path: string) =>
  path.split(/[\\/]/).pop() || "CeleMod-Crash.txt";

const fileUri = (path: string) => {
  const slashPath = path.replace(/\\/g, "/");
  const prefix = slashPath.startsWith("/") ? "file://" : "file:///";
  return encodeURI(`${prefix}${slashPath}`);
};

const startReportDrag = (event: DragEvent<HTMLDivElement>, path: string) => {
  const uri = fileUri(path);
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(
    "DownloadURL",
    `text/plain:${fileName(path)}:${uri}`
  );
  event.dataTransfer.setData("text/uri-list", uri);
  event.dataTransfer.setData("text/plain", path);
};

const cleanLogPrefix = (line: string) =>
  line
    .replace(
      /^\([^)]*\)\s+\[Everest\]\s+\[[^\]]+\]\s+\[[^\]]+\]\s*(?:>>\s*)?/,
      ""
    )
    .trim();

const displayException = (analysis: CrashAnalysis) => {
  const fromLog = analysis.excerpt
    .split(/\r?\n/)
    .map(cleanLogPrefix)
    .find(
      (line) =>
        /\b(?:System\.)?[\w.`+]+Exception(?::|\s)/.test(line) &&
        !/^\s*(?:at|在)\s/.test(line)
    );
  return fromLog || analysis.exception;
};

const formatStacktrace = (analysis: CrashAnalysis, exception: string) => {
  const lines = analysis.excerpt.split(/\r?\n/);
  const markerIndex = lines.findLastIndex((line) =>
    /critical error/i.test(line)
  );
  const exceptionIndex = lines.findIndex(
    (line, index) =>
      index >= Math.max(0, markerIndex) &&
      /\b(?:System\.)?[\w.`+]+Exception(?::|\s)/.test(line)
  );
  const start =
    exceptionIndex >= 0 ? exceptionIndex : Math.max(0, markerIndex + 1);
  const cleaned = lines
    .slice(start, start + 180)
    .map((line) =>
      line
        .replace(
          /^\([^)]*\)\s+\[Everest\]\s+\[[^\]]+\]\s+\[[^\]]+\]\s*(?:>>\s*)?/,
          ""
        )
        .replace(/^\s*--->\s*/, "↳ ")
        .replace(/^\s+(at|在)\s+/, "  $1 ")
        .trimEnd()
    )
    .filter((line, index) => {
      if (index === 0 && cleanLogPrefix(line) === exception.trim())
        return false;
      return !/ENCOUNTERED A CRITICAL ERROR/i.test(line);
    });
  return cleaned.join("\n").trim() || analysis.excerpt;
};

const CrashPopup = ({
  analysis,
  gamePath,
}: {
  analysis: CrashAnalysis;
  gamePath: string;
}) => {
  const popup = useContext(PopupContext);
  const globalContext = useGlobalContext();
  const downloadMod = useDownloadStore((state) => state.downloadMod);
  const [suspects, setSuspects] = useState(analysis.suspects);
  const [selected, setSelected] = useState(
    () => new Set(analysis.suspects.map((suspect) => suspect.name))
  );
  const [latestEverest, setLatestEverest] = useState<EverestUpdate | null>(
    null
  );
  const [crashModFix, setCrashModFix] = useState<CrashModFix | null>(null);
  const [latestError, setLatestError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadLatestEverest(analysis)
      .then((latest) => active && setLatestEverest(latest))
      .catch((reason) => active && setLatestError(String(reason)));
    loadCrashModFix(analysis)
      .then((fix) => active && setCrashModFix(fix))
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [analysis]);

  useEffect(() => {
    callRemote("get_mod_latest_info", (data: string) => {
      const latest = new Map(
        (JSON.parse(data) as [string, string, string, string][]).map(
          ([name, version, fileId, url]) => [
            name.toLocaleLowerCase(),
            { version, fileId, url },
          ]
        )
      );
      setSuspects((current) =>
        current.map((suspect) => {
          const update = latest.get(suspect.name.toLocaleLowerCase());
          if (!update) return suspect;
          return {
            ...suspect,
            latestVersion: update.version,
            gameBananaFileId: Number(update.fileId),
            downloadUrl: update.url,
            updateAvailable:
              compareLooseVersion(update.version, suspect.installedVersion) > 0,
          };
        })
      );
    }).catch(console.error);
  }, []);

  const close = () => {
    crashPopupOpen = false;
    popup.hide();
  };

  const selectedSuspects = useMemo(
    () => suspects.filter((suspect) => selected.has(suspect.name)),
    [selected, suspects]
  );
  const selectedUpdates = selectedSuspects.filter(
    (suspect) => suspect.updateAvailable
  );
  const everestUpdateAvailable = Boolean(
    latestEverest &&
      analysis.everestVersion &&
      latestEverest.version > analysis.everestVersion
  );
  const exception = useMemo(() => displayException(analysis), [analysis]);
  const stacktrace = useMemo(
    () => formatStacktrace(analysis, exception),
    [analysis, exception]
  );

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setStatus(_i18n.t("游戏已重新启动"));
      setTimeout(close, 650);
    } catch (reason) {
      setError(String(reason));
      setStatus("");
      setBusy(false);
    }
  };

  const restart = (legacyLoader = false) =>
    runAction(async () => {
      setStatus(
        legacyLoader
          ? _i18n.t("正在使用 Legacy Loader 重启…")
          : _i18n.t("正在重启…")
      );
      await callRemote("restart_game_with_loader", gamePath, legacyLoader);
    });

  const disableAndRestart = () =>
    runAction(async () => {
      if (selectedSuspects.length === 0)
        throw new Error(_i18n.t("请至少选择一个 Mod"));
      setStatus(_i18n.t("正在禁用所选 Mod 并重启…"));
      await globalContext.blacklist.setModsEnabled(
        selectedSuspects.map((suspect) => ({
          name: suspect.name,
          file: suspect.file,
        })),
        false
      );
      await callRemote("restart_game_with_loader", gamePath, false);
    });

  const updateSelectedMods = async () => {
    if (selectedUpdates.length === 0)
      throw new Error(_i18n.t("所选 Mod 没有可用更新"));
    await callRemote("stop_game_for_restart", gamePath);
    for (let index = 0; index < selectedUpdates.length; index += 1) {
      const suspect = selectedUpdates[index];
      setStatus(
        _i18n.t("正在更新 {name} ({current}/{total})…", {
          name: suspect.name,
          current: index + 1,
          total: selectedUpdates.length,
        })
      );
      const source =
        suspect.gameBananaFileId !== undefined &&
        suspect.gameBananaFileId !== -1
          ? String(suspect.gameBananaFileId)
          : suspect.downloadUrl;
      if (!source)
        throw new Error(`${suspect.name}: ${_i18n.t("没有可用下载地址")}`);
      await new Promise<void>((resolve, reject) => {
        downloadMod(suspect.name, source, {
          force: true,
          ownerId: `crash-${analysis.fingerprint}`,
          onProgress: (_task, progress) =>
            setStatus(
              `${_i18n.t("正在更新")} ${suspect.name} · ${progress.toFixed(0)}%`
            ),
          onFinished: () => resolve(),
          onFailed: (_task, reason) =>
            reject(new Error(`${suspect.name}: ${reason}`)),
        });
      });
    }
  };

  const updateModsAndRestart = () =>
    runAction(async () => {
      await updateSelectedMods();
      setStatus(_i18n.t("更新完成，正在重启…"));
      await callRemote("restart_game_with_loader", gamePath, false);
    });

  const updateEverestAndRestart = () =>
    runAction(async () => {
      if (!latestEverest) throw new Error(_i18n.t("没有可用的 Everest 更新"));
      await callRemote("stop_game_for_restart", gamePath);
      await new Promise<void>((resolve, reject) => {
        callRemote(
          "download_and_install_everest",
          gamePath,
          latestEverest.url,
          (state: string, data: unknown) => {
            if (state === "Failed") reject(new Error(String(data)));
            else if (state === "Success") resolve();
            else {
              const progress =
                typeof data === "number" ? ` · ${data.toFixed(0)}%` : "";
              setStatus(`${_i18n.t("正在更新 Everest")}${progress}`);
            }
          }
        ).catch(reject);
      });
      setStatus(_i18n.t("Everest 更新完成，正在重启…"));
      await callRemote("restart_game_with_loader", gamePath, false);
    });

  const installCrashModFixAndRestart = () =>
    runAction(async () => {
      if (!crashModFix) throw new Error(_i18n.t("没有可用的 Mod 修复包"));
      await callRemote("stop_game_for_restart", gamePath);
      await new Promise<void>((resolve, reject) => {
        callRemote(
          "download_and_install_crash_mod_fix",
          gamePath,
          crashModFix.mod_name,
          JSON.stringify(crashModFix.affected_versions),
          crashModFix.fixed_version,
          crashModFix.url,
          crashModFix.sha256,
          (state: string, data: unknown) => {
            if (state === "Failed") reject(new Error(String(data)));
            else if (state === "Success") resolve();
            else {
              const progress =
                typeof data === "number" ? ` · ${data.toFixed(0)}%` : "";
              const action =
                state === "verify"
                  ? _i18n.t("正在校验修复包")
                  : state === "install"
                  ? _i18n.t("正在替换 Mod")
                  : _i18n.t("正在下载修复包");
              setStatus(`${action}${progress}`);
            }
          }
        ).catch(reject);
      });
      setStatus(_i18n.t("修复完成，正在重启…"));
      await callRemote("restart_game_with_loader", gamePath, false);
    });

  return (
    <div className="popup-content crash-assistant-popup">
      <div className="crash-popup-heading">
        <div className="crash-popup-icon">
          <Icon name="warn" />
        </div>
        <div>
          <div>{_i18n.t("检测到 Everest 崩溃")}</div>
          <div className="crash-time">
            {new Date(analysis.logModifiedAt).toLocaleString()} · #
            {analysis.crashIndex}
          </div>
        </div>
        <button
          className="crash-close"
          disabled={busy}
          onClick={close}
          aria-label={_i18n.t("关闭")}
        >
          ×
        </button>
      </div>

      <div className="crash-summary-line">
        <strong>{analysis.summary}</strong>
        <span>{analysis.reasons.join(" ")}</span>
      </div>

      <div className="crash-main-grid">
        <section className="crash-suspects">
          <h3>{_i18n.t("可能相关的 Mod")}</h3>
          {suspects.length === 0 ? (
            <div className="crash-empty">
              {_i18n.t("未能从 stacktrace 中可靠定位到具体 Mod")}
            </div>
          ) : (
            suspects.map((suspect) => {
              const dependents = suspect.dependents || [];
              return (
                <label className="crash-suspect" key={suspect.name}>
                  <input
                    type="checkbox"
                    checked={selected.has(suspect.name)}
                    disabled={busy}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(suspect.name);
                        else next.delete(suspect.name);
                        return next;
                      })
                    }
                  />
                  <span className="crash-suspect-main">
                    <span>
                      <strong>{suspect.name}</strong>
                      <em>{suspect.confidence}%</em>
                    </span>
                    <small>
                      {suspect.installedVersion}
                      {suspect.updateAvailable
                        ? ` → ${suspect.latestVersion}`
                        : ""}
                    </small>
                    <small title={suspect.evidence}>{suspect.evidence}</small>
                    {dependents.length > 0 ? (
                      <small
                        className="crash-dependent-list"
                        title={dependents.map((item) => item.name).join(", ")}
                      >
                        {_i18n.t("被这些 Mod 依赖")}:{" "}
                        {dependents
                          .map(
                            (item) =>
                              `${item.name}${
                                item.optional ? ` (${_i18n.t("可选")})` : ""
                              }`
                          )
                          .join(", ")}
                      </small>
                    ) : null}
                  </span>
                  {suspect.updateAvailable ? (
                    <span className="crash-update-badge">
                      {_i18n.t("可更新")}
                    </span>
                  ) : null}
                </label>
              );
            })
          )}
        </section>

        <section className="crash-trace">
          <div className="crash-trace-heading">
            <h3>{_i18n.t("异常与 Stacktrace")}</h3>
            <div className="crash-everest-state">
              <span>Everest {analysis.everestVersion || "?"}</span>
              {analysis.isEverestUltra ? (
                <span className="ultra">Ultra</span>
              ) : null}
              {everestUpdateAvailable ? (
                <span className="outdated">
                  {_i18n.t("最新版 {version}", {
                    version: latestEverest!.displayVersion,
                  })}
                </span>
              ) : null}
            </div>
          </div>
          <code className="crash-exception">{exception}</code>
          <pre className="crash-excerpt">{stacktrace}</pre>
        </section>
      </div>

      <div className="crash-advice">
        <strong>{_i18n.t("建议")}</strong>
        <div>
          {analysis.suggestions.map((suggestion) => (
            <span key={suggestion}>{suggestion}</span>
          ))}
        </div>
        {latestError ? (
          <small>
            {_i18n.t("检查 Everest 更新失败")}: {latestError}
          </small>
        ) : null}
      </div>

      <div
        className="crash-report-file"
        draggable
        onDragStart={(event) => startReportDrag(event, analysis.reportPath)}
        title={analysis.reportPath}
      >
        <Icon name="file" />
        <div>
          <strong>{fileName(analysis.reportPath)}</strong>
          <span>{_i18n.t("如需向别人求助，请将此日志发送给他")}</span>
        </div>
        <button
          onClick={() => callRemote("reveal_crash_report", analysis.reportPath)}
        >
          {_i18n.t("打开所在位置")}
        </button>
      </div>

      {status ? <div className="crash-action-status">{status}</div> : null}
      {error ? <div className="crash-action-error">{error}</div> : null}

      <div className="buttons crash-actions">
        {crashModFix ? (
          <button
            className="primary"
            disabled={busy}
            onClick={installCrashModFixAndRestart}
          >
            {_i18n.t("安装 {name} 修复并重启", { name: crashModFix.mod_name })}
          </button>
        ) : null}
        {suspects.length > 0 ? (
          <button
            disabled={busy || selectedSuspects.length === 0}
            onClick={disableAndRestart}
          >
            {_i18n.t("禁用所选 Mod 并重启")}
          </button>
        ) : null}
        {suspects.some((suspect) => suspect.updateAvailable) ? (
          <button
            className="primary"
            disabled={busy || selectedUpdates.length === 0}
            onClick={updateModsAndRestart}
          >
            {_i18n.t("更新所选 Mod 并重启")}
          </button>
        ) : null}
        {everestUpdateAvailable ? (
          <button
            className="primary"
            disabled={busy}
            onClick={updateEverestAndRestart}
          >
            {_i18n.t("更新 Everest 并重启")}
          </button>
        ) : null}
        {analysis.isEverestUltra ? (
          <button disabled={busy} onClick={() => restart(true)}>
            {_i18n.t("使用 Legacy Loader 重启")}
          </button>
        ) : null}
        <button disabled={busy} onClick={close}>
          {_i18n.t("忽略")}
        </button>
      </div>
    </div>
  );
};

const showCrashPopup = (analysis: CrashAnalysis, gamePath: string) => {
  if (crashPopupOpen) return;
  crashPopupOpen = true;
  rememberCrash(gamePath, analysis);
  createPopup(() => <CrashPopup analysis={analysis} gamePath={gamePath} />, {
    cancelable: false,
    backgroundMask: "#131313",
    className: "crash-popup-container",
  });
};

export const CrashAssistant = () => {
  const [gamePath] = useGamePath();

  useEffect(() => {
    if (!gamePath) return undefined;
    let active = true;
    let checking = false;

    const check = async () => {
      if (!active || checking) return;
      checking = true;
      try {
        const analysis = await callRemote<CrashAnalysis | null>(
          "check_everest_crash",
          gamePath
        );
        if (
          active &&
          analysis &&
          !crashPopupOpen &&
          !hasSeenCrash(gamePath, analysis)
        ) {
          showCrashPopup(analysis, gamePath);
        }
      } catch (error) {
        console.error("Failed to check Everest crash logs", error);
      } finally {
        checking = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [gamePath]);

  return null;
};
