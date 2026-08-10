import _i18n from "src/i18n";
import "./DownloadList.scss";
import { useState } from "react";
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

const formatSpeed = (bytesPerSec: number) => {
  if (!bytesPerSec) return "0 B/s";
  return `${formatBytes(bytesPerSec)}/s`;
};

const Task = ({ task }: { task: Download.TaskInfo }) => {
  const cancelDownload = useDownloadStore((state) => state.cancelDownload);
  const downloadMod = useDownloadStore((state) => state.downloadMod);
  const [expanded, setExpanded] = useState(false);
  const all = task.subtasks.length;
  const finished = task.subtasks.filter((item) => item.state === "Finished").length;
  const activeSubtask = task.subtasks.find(
    (item) => item.state === "Downloading"
  );
  const visibleSubtasks = task.subtasks.filter(
    (item) => item.state !== "Finished" || item.error
  );
  const status = task.canceled
    ? { label: _i18n.t("已取消"), className: "canceled" }
    : task.state === "failed"
    ? { label: _i18n.t("失败"), className: "failed" }
    : activeSubtask
    ? { label: _i18n.t("下载中"), className: "active" }
    : { label: _i18n.t("等待中"), className: "waiting" };
  const action =
    task.state === "pending" && !task.canceled
      ? {
          icon: "i-cross",
          onClick: () => cancelDownload(task.name),
          title: _i18n.t("取消"),
        }
      : task.state === "failed" && task.source
      ? {
          icon: "replay",
          onClick: () => downloadMod(task.name, task.source!, { force: true }),
          title: _i18n.t("重试"),
        }
      : null;

  return (
    <article className={`download-task ${status.className}`}>
      <div className="download-task-heading">
        <button
          className="download-task-expand"
          aria-expanded={expanded}
          aria-label={expanded ? _i18n.t("收起") : _i18n.t("展开")}
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded ? "i-down" : "i-right"} />
        </button>
        <span className="download-task-state" aria-hidden="true" />
        <span className="download-task-name" title={task.name}>
          {task.name}
        </span>
        <span className="download-task-count">
          {finished}/{all}
        </span>
        {action ? (
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

      <div className="download-task-progress" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} />
      </div>

      <div className="download-task-meta">
        <span className={`download-task-status ${status.className}`}>
          {status.label}
        </span>
        {activeSubtask ? (
          <>
            <span>
              {formatBytes(activeSubtask.downloadedBytes)} / {formatBytes(activeSubtask.totalBytes)}
            </span>
            <span>{formatSpeed(activeSubtask.speedBytesPerSec)}</span>
          </>
        ) : task.error ? (
          <span className="download-task-error" title={task.error}>
            {task.error}
          </span>
        ) : null}
      </div>

      {expanded ? (
        <div className="download-subtasks">
          {visibleSubtasks.map((subtask) => (
            <div className={`download-subtask ${subtask.state.toLowerCase()}`} key={subtask.name}>
              <div className="download-subtask-heading">
                <span title={subtask.name}>{subtask.name}</span>
                <strong>{Math.round(subtask.progress)}%</strong>
              </div>
              <div className="download-subtask-progress" aria-hidden="true">
                <span style={{ width: `${subtask.progress}%` }} />
              </div>
              <div className="download-subtask-meta">
                <span>
                  {formatBytes(subtask.downloadedBytes)} / {formatBytes(subtask.totalBytes)}
                </span>
                <span>{formatSpeed(subtask.speedBytesPerSec)}</span>
              </div>
              {subtask.state === "Failed" ? (
                <div className="download-subtask-error">
                  <Icon name="fail" />
                  <span>{subtask.error}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
};

export const DownloadListMenu = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const downloadTasks = useDownloadStore((state) => state.tasks);
  const visibleTasks = Object.values(downloadTasks).filter(
    (task) => task.state !== "finished" || task.canceled
  );

  if (!open) return null;
  return (
    <div className="downloadListBackdrop" onClick={onClose}>
      <aside
        className="downloadList"
        aria-label={_i18n.t("下载任务")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="download-list-header">
          <div className="download-list-title">
            <Icon name="download" />
            <h2>{_i18n.t("下载任务")}</h2>
            <span>{visibleTasks.length}</span>
          </div>
          <button
            className="downloadListClose"
            onClick={onClose}
            aria-label={_i18n.t("关闭")}
          >
            <Icon name="i-cross" />
          </button>
        </header>
        <div className="taskList">
          {visibleTasks.length > 0 ? (
            visibleTasks.map((task) => <Task key={task.name} task={task} />)
          ) : (
            <div className="download-list-empty">
              <Icon name="download" />
              <span>{_i18n.t("无数据")}</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
