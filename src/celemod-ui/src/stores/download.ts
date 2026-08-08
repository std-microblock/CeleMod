import { create } from "zustand";
import { useAppStore } from "../states";
import { callRemote } from "../utils";

export namespace Download {
  export interface SubtaskInfo {
    name: string;
    progress: number;
    from: string;
    to: string;
    state: "Downloading" | "Finished" | "Failed" | "Waiting";
    error?: string;
    downloadedBytes: number;
    totalBytes: number;
    speedBytesPerSec: number;
  }

  export interface TaskInfo {
    name: string;
    subtasks: SubtaskInfo[];
    source?: string;
    ownerId?: string;
    mod: {
      name: string;
      id?: string;
    };
    state: "finished" | "failed" | "pending";
    error?: string;
    progress: number;
    canceled?: boolean;
    attemptId: number;
  }
}

interface BackendDownloadInfo {
  name: string;
  url: string;
  dest: string;
  status: "Waiting" | "Downloading" | "Finished" | "Failed";
  data: string;
  downloaded_bytes: number;
  total_bytes: number;
  speed_bytes_per_sec: number;
}

interface DownloadOptions {
  force?: boolean;
  autoDisableNewMods?: boolean;
  ownerId?: string;
  onProgress?: (task: Download.TaskInfo, progress: number) => void;
  onFinished?: (task: Download.TaskInfo) => void;
  onFailed?: (task: Download.TaskInfo, error: string) => void;
}

interface DownloadStore {
  tasks: Record<string, Download.TaskInfo>;
  cancelDownload: (name: string) => boolean;
  downloadMod: (
    name: string,
    gbFileIdOrUrl: string,
    options?: DownloadOptions
  ) => Download.TaskInfo;
}

let nextAttemptId = 1;

const replaceTask = (
  tasks: Record<string, Download.TaskInfo>,
  task: Download.TaskInfo
) => ({ ...tasks, [task.name]: task });

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  tasks: {},

  cancelDownload(name) {
    const task = get().tasks[name];
    if (!task || task.state !== "pending") return false;

    set((state) => ({
      tasks: replaceTask(state.tasks, { ...task, canceled: true }),
    }));
    void callRemote("cancel_download_mod", name);
    return true;
  },

  downloadMod(name, gbFileIdOrUrl, options = {}) {
    const {
      force = false,
      autoDisableNewMods,
      ownerId,
      onProgress,
      onFinished,
      onFailed,
    } = options;
    const appState = useAppStore.getState();
    const downloadTypeDefaults = {
      ...appState.downloadTypeDefaults,
      __default:
        autoDisableNewMods === undefined
          ? appState.downloadDefaultEnabled
          : !autoDisableNewMods,
    };
    const existingTask = get().tasks[name];

    let url: string;
    if (gbFileIdOrUrl.startsWith("http")) {
      url = gbFileIdOrUrl;
    } else if (appState.mirror === "wegfan") {
      url = `https://celeste.weg.fan/api/v2/download/gamebanana-files/${gbFileIdOrUrl}`;
    } else if (appState.mirror === "0x0ade") {
      url = `https://celestemodupdater.0x0a.de/banana-mirror/${gbFileIdOrUrl}.zip`;
    } else {
      url = `https://gamebanana.com/dl/${gbFileIdOrUrl}`;
    }

    const replacingInstalledMod = appState.installedMods.some(
      (mod) => mod.name === name
    );
    if (replacingInstalledMod && !force) {
      const task: Download.TaskInfo = {
        name,
        subtasks: [],
        source: gbFileIdOrUrl,
        ownerId: ownerId ?? existingTask?.ownerId,
        mod: { name },
        state: "failed",
        error: "Mod already installed",
        progress: 0,
        canceled: false,
        attemptId: nextAttemptId++,
      };
      set((state) => ({ tasks: replaceTask(state.tasks, task) }));
      onFailed?.(task, task.error!);
      return task;
    }

    if (existingTask && !force) return existingTask;

    const attemptId = nextAttemptId++;
    const task: Download.TaskInfo = {
      name,
      subtasks: [
        {
          name,
          progress: 0,
          from: url,
          to: `${appState.gamePath}/Mods/${name}.zip`,
          state: "Waiting",
          downloadedBytes: 0,
          totalBytes: 0,
          speedBytesPerSec: 0,
        },
      ],
      source: gbFileIdOrUrl,
      ownerId: ownerId ?? existingTask?.ownerId,
      mod: { name },
      state: "pending",
      progress: 0,
      canceled: false,
      attemptId,
    };
    set((state) => ({ tasks: replaceTask(state.tasks, task) }));

    const onDownloadEvent = (
      _subtasks: string,
      state: "pending" | "failed" | "finished"
    ) => {
      const currentTask = get().tasks[name];
      if (!currentTask || currentTask.attemptId !== attemptId) return;

      const backendSubtasks = JSON.parse(_subtasks) as BackendDownloadInfo[];
      const subtasks = backendSubtasks.map((subtask) => ({
        name: subtask.name,
        progress:
          subtask.status === "Downloading"
            ? Number.parseFloat(subtask.data)
            : subtask.status === "Finished"
            ? 100
            : 0,
        from: subtask.url,
        to: subtask.dest,
        error: subtask.status === "Failed" ? subtask.data : undefined,
        state: subtask.status,
        downloadedBytes: subtask.downloaded_bytes || 0,
        totalBytes: subtask.total_bytes || 0,
        speedBytesPerSec: subtask.speed_bytes_per_sec || 0,
      }));

      const error =
        state === "failed"
          ? backendSubtasks.find((subtask) => subtask.status === "Failed")?.data
          : undefined;
      const progress =
        state === "pending"
          ? Number.parseFloat(
              backendSubtasks.find(
                (subtask) => subtask.status === "Downloading"
              )?.data || "0"
            )
          : state === "finished"
          ? 100
          : currentTask.progress;
      const nextTask: Download.TaskInfo = {
        ...currentTask,
        subtasks,
        state,
        progress,
        error,
        canceled:
          state === "finished"
            ? false
            : error === "Download canceled"
            ? true
            : currentTask.canceled,
      };

      set((store) => ({ tasks: replaceTask(store.tasks, nextTask) }));

      if (state === "finished") onFinished?.(nextTask);
      else if (state === "failed")
        onFailed?.(nextTask, error || "Download failed");
      else onProgress?.(nextTask, progress);
    };

    void (async () => {
      if (replacingInstalledMod) {
        await callRemote("rm_mod", `${appState.gamePath}/Mods/`, name);
      }
      await callRemote(
        "download_mod",
        name,
        url,
        `${appState.gamePath}/Mods/`,
        JSON.stringify(downloadTypeDefaults),
        onDownloadEvent,
        false,
        appState.useMultiThread
      );
    })().catch((error) => {
      const currentTask = get().tasks[name];
      if (!currentTask || currentTask.attemptId !== attemptId) return;
      const message = String(error);
      const failedTask = {
        ...currentTask,
        state: "failed" as const,
        error: message,
      };
      set((store) => ({ tasks: replaceTask(store.tasks, failedTask) }));
      onFailed?.(failedTask, message);
    });

    return task;
  },
}));
