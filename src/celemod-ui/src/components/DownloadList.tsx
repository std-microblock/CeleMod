import _i18n from 'src/i18n';
import { h } from 'preact';
import './DownloadList.scss';
import { useGlobalContext } from '../App';
import { useEffect } from 'react';
import { useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { Download } from '../context/download';

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};

const formatSpeed = (bytesPerSec: number) => {
  if (!bytesPerSec) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
};

const Task = ({ task, download }: { task: Download.TaskInfo; download: any }) => {
  const all = task.subtasks.length;
  const finished = task.subtasks.filter((v) => v.state === 'Finished').length;

  const [expanded, setExpanded] = useState(false);

  const activeSubtask = task.subtasks.find((v) => v.state === 'Downloading');
  const action = task.state === 'pending'
    ? {
      icon: 'i-cross',
      onClick: () => download.cancelDownload(task.name),
      title: _i18n.t('取消'),
    }
    : (task.state === 'failed' || task.canceled) && task.source
      ? {
        icon: 'replay',
        onClick: () => download.downloadMod(task.name, task.source, { force: true }),
        title: _i18n.t('重试'),
      }
      : null;

  return (
    <div class="task">
      <label>
        <div className="infoLine">
          <button
            class="b1"
            onClick={() => {
              setExpanded((v) => !v);
            }}
          >
            {<Icon name={expanded ? 'i-down' : 'i-right'} />}
          </button>
          <span className="name">{task.name}</span>
          {action && (
            <span className="taskInlineAction" title={action.title} onClick={action.onClick}>
              <Icon name={action.icon} />
            </span>
          )}
          <span className="progress-label">{finished}/{all}</span>
        </div>
      </label>
      {activeSubtask && (
        <div className="metaLine">
          <span>{formatBytes(activeSubtask.downloadedBytes)}/{formatBytes(activeSubtask.totalBytes)}</span>
          <span>{formatSpeed(activeSubtask.speedBytesPerSec)}</span>
        </div>
      )}
      {expanded && (
        <div className="subTasks">
          {task.subtasks
            .filter((v) => v.state !== 'Finished' || v.error)
            .map((subtask) => (
              <div class="subTask" key={subtask.name}>
                <div class="name">{subtask.name}</div>
                <div className="progressLine">
                  <div class="progress">
                    <div
                      class="bar"
                      style={{
                        width: `${subtask.progress}%`,
                      }}
                    ></div>
                  </div>
                  <div class="text">{subtask.progress}%</div>
                </div>
                <div className="metaLine subMetaLine">
                  <span>{formatBytes(subtask.downloadedBytes)}/{formatBytes(subtask.totalBytes)}</span>
                  <span>{formatSpeed(subtask.speedBytesPerSec)}</span>
                </div>
                {subtask.state === 'Failed' && (
                  <div class="error">
                    <Icon name="fail" />
                    {subtask.error}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export const DownloadListMenu = () => {
  const { download } = useGlobalContext();
  const [downloadTasks, setDownloadTasks] = useState(
    download.downloadTasks.current
  );

  useEffect(() => {
    download.eventBus.on('taskListChanged', () => {
      setDownloadTasks({ ...download.downloadTasks.current });
    });
  }, []);

  return (
    <menu className="popup downloadList">
      <h2>{_i18n.t('下载任务')}</h2>
      <div className="taskList">
        {Object.values(downloadTasks)
          .filter((v) => v.state !== 'finished' || v.canceled)
          .map((task) => (
            <Task task={task} download={download} />
          ))}
      </div>
    </menu>
  );
};
