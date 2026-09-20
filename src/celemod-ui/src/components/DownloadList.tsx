import _i18n from "src/i18n";
import "./DownloadList.scss";
import { useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Download, useDownloadStore } from "../stores/download";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${
    value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)
  } ${units[index]}`;
};

const formatSpeed = (bytesPerSec: number) =>
  bytesPerSec ? `${formatBytes(bytesPerSec)}/s` : "0 B/s";

// Prefer byte counters over the streamed percentage: the latter can lag
// behind and is also used for aggregate root progress in the store.
const getTaskProgress = (task: Download.TaskInfo) => {
  if (task.totalBytes > 0) {
    return Math.max(
      0,
      Math.min(100, (task.downloadedBytes / task.totalBytes) * 100),
    );
  }
  return Math.max(
    0,
    Math.min(100, task.state === "finished" ? 100 : task.progress || 0),
  );
};

const getMetrics = (tasks: Download.TaskInfo[]) => {
  const downloadedBytes = tasks.reduce(
    (sum, task) => sum + task.downloadedBytes,
    0,
  );
  const totalBytes = tasks.reduce((sum, task) => sum + task.totalBytes, 0);
  const speedBytesPerSec = tasks.reduce(
    (sum, task) => sum + task.speedBytesPerSec,
    0,
  );
  const progress =
    totalBytes > 0
      ? (downloadedBytes / totalBytes) * 100
      : tasks.length > 0
        ? tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length
        : 0;
  return {
    downloadedBytes,
    totalBytes,
    speedBytesPerSec,
    progress: Math.min(100, progress),
  };
};

const collectDependencies = (
  root: Download.TaskInfo,
  taskMap: Map<string, Download.TaskInfo>,
) => {
  const result: Download.TaskInfo[] = [];
  const seen = new Set<string>();
  const visit = (names: string[]) => {
    for (const name of names) {
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      const task = taskMap.get(key);
      if (!task) continue;
      seen.add(key);
      result.push(task);
      visit(task.dependencies);
    }
  };
  visit(root.dependencies);
  return result;
};

const stateLabel = (task: Download.TaskInfo) => {
  if (task.canceled)
    return { label: _i18n.t("已取消"), icon: "i-cross", tone: "canceled" };
  if (task.state === "failed")
    return { label: _i18n.t("失败"), icon: "fail", tone: "failed" };
  if (task.state === "finished")
    return { label: _i18n.t("已完成"), icon: "i-tick", tone: "finished" };
  if (task.paused)
    return { label: _i18n.t("已暂停"), icon: "pause", tone: "paused" };
  return { label: _i18n.t("下载中"), icon: "download", tone: "active" };
};

const getRootStatus = (
  task: Download.TaskInfo,
  dependencyTasks: Download.TaskInfo[],
) => {
  if (task.canceled) return task;
  if (dependencyTasks.some((dependency) => dependency.canceled)) {
    return { ...task, canceled: true };
  }
  if (dependencyTasks.some((dependency) => dependency.state === "failed")) {
    return { ...task, state: "failed" as const };
  }
  // A root may finish before its dependencies; keep it active until all are done.
  if (
    task.state === "finished" &&
    dependencyTasks.some((dependency) => dependency.state !== "finished")
  ) {
    return { ...task, state: "pending" as const };
  }
  return task;
};

const DownloadDetailRow = ({
  task,
  children,
  allowControl = true,
  label,
}: {
  task: Download.TaskInfo;
  children?: ReactNode;
  allowControl?: boolean;
  label?: string;
}) => {
  const cancelDownload = useDownloadStore((state) => state.cancelDownload);
  const togglePauseDownload = useDownloadStore(
    (state) => state.togglePauseDownload,
  );
  const progress = getTaskProgress(task);
  const status = stateLabel(task);
  const canControl = allowControl && task.state === "pending" && !task.canceled;
  return (
    <div className={`download-detail-row download-detail-row-${status.tone}`}>
      <div className="download-dependency-main">
        <Icon name={status.icon} />
        <span title={task.name}>{label ?? task.name}</span>
        <strong>{Math.round(progress)}%</strong>
        {canControl ? (
          <span className="download-dependency-actions">
            <button
              title={task.paused ? _i18n.t("继续") : _i18n.t("暂停")}
              aria-label={task.paused ? _i18n.t("继续") : _i18n.t("暂停")}
              onClick={() => togglePauseDownload(task.name)}
            >
              <Icon name={task.paused ? "play" : "pause"} />
            </button>
            <button
              title={_i18n.t("取消")}
              aria-label={_i18n.t("取消")}
              onClick={() => cancelDownload(task.name)}
            >
              <Icon name="i-cross" />
            </button>
          </span>
        ) : null}
      </div>
      <div className="download-dependency-progress">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="download-detail-summary">
        <span>
          {formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}
        </span>
        <span>{formatSpeed(task.speedBytesPerSec)}</span>
      </div>
      {children}
      {task.error ? (
        <div className="download-dependency-error">{task.error}</div>
      ) : null}
    </div>
  );
};

export const DownloadTask = ({
  task,
  dependencyTasks = [],
  initialExpanded = true,
  allowRetry = true,
  allowControl = true,
}: {
  task: Download.TaskInfo;
  dependencyTasks?: Download.TaskInfo[];
  initialExpanded?: boolean;
  allowRetry?: boolean;
  allowControl?: boolean;
}) => {
  const cancelDownload = useDownloadStore((state) => state.cancelDownload);
  const togglePauseDownload = useDownloadStore(
    (state) => state.togglePauseDownload,
  );
  const downloadMod = useDownloadStore((state) => state.downloadMod);
  const [expanded, setExpanded] = useState(initialExpanded);
  const metricTasks = [task, ...dependencyTasks];
  const metrics = getMetrics(metricTasks);
  const progress = Math.max(0, Math.min(100, Number(metrics.progress) || 0));
  const displayTask = getRootStatus(task, dependencyTasks);
  const status = stateLabel(displayTask);
  const canControl =
    allowControl && displayTask.state === "pending" && !displayTask.canceled;
  const action =
    allowRetry && task.state === "failed" && task.source
      ? {
          icon: "replay",
          onClick: () => downloadMod(task.name, task.source!, { force: true }),
          title: _i18n.t("重试"),
        }
      : null;

  return (
    <article className={`download-task download-task-${status.tone}`}>
      <div className="download-task-topline">
        <button
          className="download-task-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="download-task-status-icon">
            <Icon name={status.icon} />
          </span>
          <span className="download-task-title" title={task.name}>
            {task.name}
          </span>
          <span className="download-task-status-text">{status.label}</span>
          <Icon name={expanded ? "i-down" : "i-right"} />
        </button>
        <div className="download-task-actions">
          {canControl ? (
            <button
              className="download-task-action"
              title={task.paused ? _i18n.t("继续") : _i18n.t("暂停")}
              aria-label={task.paused ? _i18n.t("继续") : _i18n.t("暂停")}
              onClick={() => togglePauseDownload(task.name)}
            >
              <Icon name={task.paused ? "play" : "pause"} />
            </button>
          ) : null}
          {canControl ? (
            <button
              className="download-task-action download-task-cancel"
              title={_i18n.t("取消")}
              aria-label={_i18n.t("取消")}
              onClick={() => cancelDownload(task.name)}
            >
              <Icon name="i-cross" />
            </button>
          ) : action ? (
            <button
              className="download-task-action"
              title={action.title}
              aria-label={action.title}
              onClick={action.onClick}
            >
              <Icon name={action.icon} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="download-task-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="download-task-summary">
        <strong>{Math.round(progress)}%</strong>
        <span>{task.requested ? _i18n.t("下载") : _i18n.t("依赖")}</span>
        <span>
          {formatBytes(metrics.downloadedBytes)} /{" "}
          {formatBytes(metrics.totalBytes)}
        </span>
        <span>{formatSpeed(metrics.speedBytesPerSec)}</span>
      </div>

      {expanded && dependencyTasks.length > 0 ? (
        <div className="download-dependency-list">
          <div className="download-dependency-heading">{_i18n.t("主文件")}</div>
          <DownloadDetailRow
            task={task}
            allowControl={allowControl}
            label={_i18n.t("主文件")}
          />
          <div className="download-dependency-heading">
            {_i18n.t("依赖")} <span>{dependencyTasks.length}</span>
          </div>
          {dependencyTasks.map((dependency) => (
            <DownloadDetailRow
              key={dependency.name}
              task={dependency}
              allowControl={allowControl}
            />
          ))}
        </div>
      ) : expanded ? (
        <div className="download-dependency-list download-main-file-only">
          <DownloadDetailRow
            task={task}
            allowControl={allowControl}
            label={_i18n.t("主文件")}
          />
        </div>
      ) : null}
      {task.error && expanded ? (
        <div className="download-task-error-details">{task.error}</div>
      ) : null}
    </article>
  );
};

export const DownloadListPage = () => {
  const downloadTasks = useDownloadStore((state) => state.tasks);
  const allTasks = Object.values(downloadTasks);
  const taskMap = new Map(
    allTasks.map((task) => [task.name.toLocaleLowerCase(), task]),
  );
  const roots = allTasks.filter((task) => task.requested);
  const visibleRoots = roots.length > 0 ? roots : allTasks;
  const visibleCount = allTasks.filter(
    (task) => task.state !== "finished" || task.canceled,
  ).length;

  return (
    <div className="download-page">
      <header className="download-page-header">
        <div className="download-page-heading">
          <span className="download-page-icon">
            <Icon name="download" />
          </span>
          <div>
            <h1>{_i18n.t("下载任务")}</h1>
            <p>
              {visibleCount} {_i18n.t("项")}
            </p>
          </div>
        </div>
      </header>
      <div className="taskList download-page-list">
        {visibleRoots.length > 0 ? (
          visibleRoots.map((task) => (
            <DownloadTask
              key={task.name}
              task={task}
              dependencyTasks={(() => {
                const dependencies = collectDependencies(task, taskMap);
                return dependencies.length > 0
                  ? dependencies
                  : allTasks.filter(
                      (candidate) =>
                        !candidate.requested &&
                        candidate.cancelKey === task.cancelKey,
                    );
              })()}
            />
          ))
        ) : (
          <div className="download-list-empty">
            <Icon name="download" />
            <span>{_i18n.t("无数据")}</span>
          </div>
        )}
      </div>
    </div>
  );
};
