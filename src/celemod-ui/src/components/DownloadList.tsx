import _i18n from "src/i18n";
import "./DownloadList.scss";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Collapse } from "./Motion";
import { Download, useDownloadStore } from "../stores/download";
import { useGamePath } from "../states";
import { useGlobalContext } from "../App";

type FilterKey = "all" | "active" | "finished" | "failed";

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

const formatBytesPair = (downloadedBytes: number, totalBytes: number) => {
  if (totalBytes > 0) {
    return `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
  }
  if (downloadedBytes > 0) {
    return formatBytes(downloadedBytes);
  }
  return null;
};

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
  if (task.mirrorPreparing)
    return {
      label: _i18n.t("制作镜像中"),
      icon: "download",
      tone: "preparing",
    };
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
  const isTransferring =
    task.state === "pending" && !task.canceled && !task.paused;
  const bytesSummary = formatBytesPair(task.downloadedBytes, task.totalBytes);

  return (
    <div className={`download-detail-row download-detail-row-${status.tone}`}>
      <div className="download-dependency-main">
        <span className="download-dependency-status-icon" aria-hidden="true">
          <Icon name={status.icon} />
        </span>
        <span className="download-dependency-name" title={task.name}>
          {label ?? task.name}
        </span>
        <span className="download-dependency-meta">
          {bytesSummary ? <span>{bytesSummary}</span> : null}
          {isTransferring && task.speedBytesPerSec > 0 ? (
            <span className="download-dependency-speed">
              {formatSpeed(task.speedBytesPerSec)}
            </span>
          ) : null}
        </span>
        <strong className="download-dependency-percent">
          {Math.round(progress)}%
        </strong>
        {canControl ? (
          <span className="download-dependency-actions">
            <button
              type="button"
              title={task.paused ? _i18n.t("继续") : _i18n.t("暂停")}
              aria-label={task.paused ? _i18n.t("继续") : _i18n.t("暂停")}
              onClick={() => togglePauseDownload(task.name)}
            >
              <Icon name={task.paused ? "play" : "pause"} />
            </button>
            <button
              type="button"
              className="download-dependency-cancel"
              title={_i18n.t("取消")}
              aria-label={_i18n.t("取消")}
              onClick={() => cancelDownload(task.name)}
            >
              <Icon name="i-cross" />
            </button>
          </span>
        ) : null}
      </div>
      <div className="download-dependency-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      {children}
      <Collapse open={Boolean(task.error)} appear>
        <div className="download-dependency-error" role="alert">
          {task.error}
        </div>
      </Collapse>
    </div>
  );
};

export const DownloadTask = ({
  task,
  dependencyTasks = [],
  initialExpanded,
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
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    initialExpanded ?? null,
  );

  const metricTasks = [task, ...dependencyTasks];
  const metrics = getMetrics(metricTasks);
  const progress = Math.max(0, Math.min(100, Number(metrics.progress) || 0));
  const displayTask = getRootStatus(task, dependencyTasks);
  const status = stateLabel(displayTask);
  const hasDependencies = dependencyTasks.length > 0;
  const autoExpanded =
    hasDependencies &&
    !displayTask.canceled &&
    (displayTask.state === "pending" || displayTask.state === "failed");
  const expanded = hasDependencies ? (expandedOverride ?? autoExpanded) : false;

  const canControl =
    allowControl && displayTask.state === "pending" && !displayTask.canceled;
  const isTransferring =
    displayTask.state === "pending" &&
    !displayTask.canceled &&
    !displayTask.paused;
  const bytesSummary = formatBytesPair(
    metrics.downloadedBytes,
    metrics.totalBytes,
  );
  const collapsedError =
    task.error || dependencyTasks.find((dep) => dep.error)?.error;

  const action =
    allowRetry && task.state === "failed" && task.source
      ? {
          icon: "replay",
          onClick: () => downloadMod(task.name, task.source!, { force: true }),
          title: _i18n.t("重试"),
        }
      : null;

  const toggleExpanded = () => setExpandedOverride(!expanded);

  return (
    <article className={`download-task download-task-${status.tone}`}>
      <div className="download-task-topline">
        {hasDependencies ? (
          <button
            type="button"
            className="download-task-toggle"
            aria-expanded={expanded}
            onClick={toggleExpanded}
          >
            <span className="download-task-status-icon" aria-hidden="true">
              <Icon name={status.icon} />
            </span>
            <span className="download-task-heading-group">
              <span className="download-task-title" title={task.name}>
                {task.name}
              </span>
              <span className="download-task-status-text">{status.label}</span>
              <span className="download-task-dep-badge">
                +{dependencyTasks.length} {_i18n.t("依赖")}
              </span>
            </span>
          </button>
        ) : (
          <div className="download-task-identity">
            <span className="download-task-status-icon" aria-hidden="true">
              <Icon name={status.icon} />
            </span>
            <span className="download-task-heading-group">
              <span className="download-task-title" title={task.name}>
                {task.name}
              </span>
              <span className="download-task-status-text">{status.label}</span>
            </span>
          </div>
        )}

        <div className="download-task-actions">
          {canControl ? (
            <button
              type="button"
              className="download-task-action"
              title={displayTask.paused ? _i18n.t("继续") : _i18n.t("暂停")}
              aria-label={
                displayTask.paused ? _i18n.t("继续") : _i18n.t("暂停")
              }
              onClick={() => togglePauseDownload(task.name)}
            >
              <Icon name={displayTask.paused ? "play" : "pause"} />
            </button>
          ) : null}
          {canControl ? (
            <button
              type="button"
              className="download-task-action download-task-cancel"
              title={_i18n.t("取消")}
              aria-label={_i18n.t("取消")}
              onClick={() => cancelDownload(task.name)}
            >
              <Icon name="i-cross" />
            </button>
          ) : action ? (
            <button
              type="button"
              className="download-task-action"
              title={action.title}
              aria-label={action.title}
              onClick={action.onClick}
            >
              <Icon name={action.icon} />
            </button>
          ) : null}
          {hasDependencies ? (
            <button
              type="button"
              className={`download-task-action download-task-expand${expanded ? " is-expanded" : ""}`}
              aria-expanded={expanded}
              title={expanded ? _i18n.t("收起依赖") : _i18n.t("展开依赖")}
              aria-label={expanded ? _i18n.t("收起依赖") : _i18n.t("展开依赖")}
              onClick={toggleExpanded}
            >
              <Icon name="i-right" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="download-task-body">
        <div className="download-task-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="download-task-summary">
          <span className="download-task-summary-left">
            <strong>{Math.round(progress)}%</strong>
            {bytesSummary ? (
              <span className="download-task-bytes">{bytesSummary}</span>
            ) : null}
          </span>
          {isTransferring && metrics.speedBytesPerSec > 0 ? (
            <span className="download-task-speed">
              {formatSpeed(metrics.speedBytesPerSec)}
            </span>
          ) : null}
        </div>
      </div>

      <Collapse
        open={Boolean(collapsedError && (!hasDependencies || !expanded))}
        appear
      >
        <div className="download-task-error-details" role="alert">
          {collapsedError}
        </div>
      </Collapse>

      <Collapse open={hasDependencies && expanded} unmountOnExit>
        <div className="download-dependency-list">
          <DownloadDetailRow
            task={task}
            allowControl={allowControl}
            label={_i18n.t("主文件")}
          />
          {dependencyTasks.map((dependency) => (
            <DownloadDetailRow
              key={dependency.name}
              task={dependency}
              allowControl={allowControl}
            />
          ))}
        </div>
      </Collapse>
    </article>
  );
};

export const DownloadListPage = () => {
  const downloadTasks = useDownloadStore((state) => state.tasks);
  const clearFinishedTasks = useDownloadStore(
    (state) => state.clearFinishedTasks,
  );
  const [gamePath] = useGamePath();
  const { pageController } = useGlobalContext();
  const [filter, setFilter] = useState<FilterKey>("all");

  const {
    rootItems,
    activeCount,
    finishedCount,
    failedCount,
    totalActiveSpeed,
    hasClearableTasks,
  } = useMemo(() => {
    const allTasks = Object.values(downloadTasks);
    const taskMap = new Map(
      allTasks.map((task) => [task.name.toLocaleLowerCase(), task]),
    );
    const roots = allTasks.filter((task) => task.requested);
    const visibleRoots = (roots.length > 0 ? roots : allTasks)
      .slice()
      .sort((a, b) => b.attemptId - a.attemptId);

    const activeCancelKeys = new Set<string>();
    let speedSum = 0;
    for (const task of allTasks) {
      if (task.state === "pending" && !task.canceled) {
        if (task.cancelKey) activeCancelKeys.add(task.cancelKey);
        if (!task.paused) {
          speedSum += task.speedBytesPerSec;
        }
      }
    }

    let active = 0;
    let finished = 0;
    let failed = 0;
    let clearable = false;

    const items = visibleRoots.map((task) => {
      const dependencies = collectDependencies(task, taskMap);
      const dependencyTasks =
        dependencies.length > 0
          ? dependencies
          : allTasks.filter(
              (candidate) =>
                !candidate.requested && candidate.cancelKey === task.cancelKey,
            );
      const displayTask = getRootStatus(task, dependencyTasks);
      let category: Exclude<FilterKey, "all">;
      if (displayTask.canceled || displayTask.state === "failed") {
        category = "failed";
        failed += 1;
      } else if (displayTask.state === "finished") {
        category = "finished";
        finished += 1;
      } else {
        category = "active";
        active += 1;
      }

      if (
        (displayTask.state === "finished" || displayTask.canceled) &&
        (!task.cancelKey || !activeCancelKeys.has(task.cancelKey))
      ) {
        clearable = true;
      }

      return { task, dependencyTasks, category };
    });

    return {
      rootItems: items,
      activeCount: active,
      finishedCount: finished,
      failedCount: failed,
      totalActiveSpeed: speedSum,
      hasClearableTasks: clearable,
    };
  }, [downloadTasks]);

  const totalCount = rootItems.length;
  const filteredItems = useMemo(
    () =>
      filter === "all"
        ? rootItems
        : rootItems.filter((item) => item.category === filter),
    [filter, rootItems],
  );

  const filterTabs: Array<{ id: FilterKey; label: string; count: number }> = [
    { id: "all", label: _i18n.t("全部"), count: totalCount },
    { id: "active", label: _i18n.t("进行中"), count: activeCount },
    { id: "finished", label: _i18n.t("已完成"), count: finishedCount },
    { id: "failed", label: _i18n.t("异常"), count: failedCount },
  ];

  return (
    <div className="download-page">
      <div className="download-page-inner">
        <header className="download-page-header">
          <div className="download-page-heading">
            <h1>{_i18n.t("下载任务")}</h1>
            <p className="download-page-subtitle" role="status">
              {activeCount > 0 ? (
                <>
                  <span>
                    {_i18n.t("{count} 项进行中", { count: activeCount })}
                  </span>
                  <span className="download-subtitle-sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="download-subtitle-speed">
                    {formatSpeed(totalActiveSpeed)}
                  </span>
                </>
              ) : totalCount > 0 ? (
                <span>
                  {_i18n.t("共 {total} 项任务 · {finished} 已完成", {
                    total: totalCount,
                    finished: finishedCount,
                  })}
                </span>
              ) : (
                <span>{_i18n.t("模组与依赖的下载进度将在此集中显示")}</span>
              )}
            </p>
          </div>

          {totalCount > 0 && hasClearableTasks ? (
            <div className="download-page-controls">
              <button
                type="button"
                className="download-clear-button"
                onClick={clearFinishedTasks}
              >
                <Icon name="delete" />
                <span>{_i18n.t("清除已完成")}</span>
              </button>
            </div>
          ) : null}
        </header>

        {totalCount > 0 ? (
          <>
            <div
              className="download-filter-bar"
              role="group"
              aria-label={_i18n.t("按状态筛选下载任务")}
            >
              {filterTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`download-filter-pill${filter === tab.id ? " is-active" : ""}`}
                  aria-pressed={filter === tab.id}
                  onClick={() => setFilter(tab.id)}
                >
                  <span>{tab.label}</span>
                  <span className="download-filter-count">{tab.count}</span>
                </button>
              ))}
            </div>

            <div className="download-page-list">
              <div
                key={`${filter}-${filteredItems.length > 0 ? "items" : "empty"}`}
                className="ui-fade-enter"
              >
                {filteredItems.length > 0 ? (
                  filteredItems.map(({ task, dependencyTasks }) => (
                    <DownloadTask
                      key={task.name}
                      task={task}
                      dependencyTasks={dependencyTasks}
                    />
                  ))
                ) : (
                  <div className="download-filter-empty">
                    <p>{_i18n.t("当前筛选下没有下载任务")}</p>
                    <button
                      type="button"
                      className="download-filter-reset"
                      onClick={() => setFilter("all")}
                    >
                      {_i18n.t("查看全部")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="download-list-empty">
            <span className="download-empty-icon" aria-hidden="true">
              <Icon name="download" />
            </span>
            <h2>{_i18n.t("暂无下载任务")}</h2>
            <p>
              {_i18n.t(
                "在搜索或推荐模组中点击下载，进度与依赖会在这里实时显示",
              )}
            </p>
            {gamePath ? (
              <button
                type="button"
                className="download-empty-action"
                onClick={() => pageController.setPage("Search")}
              >
                <Icon name="search" />
                <span>{_i18n.t("前往搜索模组")}</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
