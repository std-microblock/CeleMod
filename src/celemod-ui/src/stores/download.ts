import { create } from "zustand";
import {
  reloadBlacklistState,
  reloadInstalledMods,
  useAppStore,
} from "../states";
import { callRemote } from "../utils";

export namespace Download {
  export interface TaskInfo {
    name: string;
    requested: boolean;
    dependencies: string[];
    cancelKey: string;
    source?: string;
    ownerId?: string;
    mod: { name: string; id?: string };
    state: "finished" | "failed" | "pending";
    error?: string;
    progress: number;
    downloadedBytes: number;
    totalBytes: number;
    speedBytesPerSec: number;
    canceled?: boolean;
    paused?: boolean;
    attemptId: number;
  }
}

interface BackendModTaskInfo {
  name: string;
  url: string;
  dest: string;
  requested: boolean;
  dependencies: string[];
  cancel_key: string;
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
  deferProfileUpdate?: boolean;
  onProgress?: (task: Download.TaskInfo, progress: number) => void;
  onFinished?: (task: Download.TaskInfo) => void;
  onFailed?: (task: Download.TaskInfo, error: string) => void;
}

interface BatchDownloadOptions {
  force?: boolean;
  autoDisableNewMods?: boolean;
  ownerId?: string;
  deferProfileUpdate?: boolean;
  onProgress?: (tasks: Download.TaskInfo[], progress: number) => void;
  onFinished?: (tasks: Download.TaskInfo[]) => void;
  onFailed?: (tasks: Download.TaskInfo[], error: string) => void;
}

interface DownloadStore {
  tasks: Record<string, Download.TaskInfo>;
  cancelDownload: (name: string) => boolean;
  togglePauseDownload: (name: string) => boolean;
  downloadMods: (
    items: Array<{ name: string; source: string }>,
    options?: BatchDownloadOptions,
  ) => Promise<Download.TaskInfo[]>;
  downloadMod: (
    name: string,
    gbFileIdOrUrl: string,
    options?: DownloadOptions,
  ) => Download.TaskInfo;
}

let nextAttemptId = 1;

const normalizeName = (name: string) => name.trim().toLocaleLowerCase();

const replaceTasks = (
  tasks: Record<string, Download.TaskInfo>,
  updates: Download.TaskInfo[],
) => {
  const next = { ...tasks };
  for (const task of updates) next[normalizeName(task.name)] = task;
  return next;
};

const aggregateProgress = (
  root: Download.TaskInfo,
  byName: Map<string, Download.TaskInfo>,
  seen = new Set<string>(),
): number => {
  const key = normalizeName(root.name);
  if (seen.has(key)) return 0;
  seen.add(key);
  const children = root.dependencies
    .map((name) => byName.get(normalizeName(name)))
    .filter((task): task is Download.TaskInfo => Boolean(task));
  if (children.length === 0) return root.progress;
  const values = [root.progress, ...children.map((task) => aggregateProgress(task, byName, seen))];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  tasks: {},

  cancelDownload(name) {
    const key = normalizeName(name);
    const task = get().tasks[key];
    if (!task || task.state !== "pending") return false;
    set((state) => ({
      tasks: {
        ...state.tasks,
        [key]: { ...task, canceled: true },
      },
    }));
    void callRemote("cancel_mod_download", task.cancelKey || name);
    return true;
  },

  togglePauseDownload(name) {
    const key = normalizeName(name);
    const task = get().tasks[key];
    if (!task || task.state !== "pending") return false;
    const paused = !task.paused;
    void callRemote("set_mod_download_paused", task.cancelKey || name, paused);
    set((state) => ({
      tasks: Object.fromEntries(
        Object.entries(state.tasks).map(([entryKey, entry]) =>
          (entry.cancelKey || entry.name) === (task.cancelKey || name)
            ? [entryKey, { ...entry, paused }]
            : [entryKey, entry],
        ),
      ),
    }));
    return true;
  },

  async downloadMods(items, options = {}) {
    if (items.length === 0) return [];
    const {
      force = false,
      autoDisableNewMods,
      ownerId,
      onProgress,
      onFinished,
      onFailed,
      deferProfileUpdate = false,
    } = options;
    const appState = useAppStore.getState();
    const resolveUrl = (source: string) =>
      source.startsWith("http")
        ? source
        : appState.mirror === "wegfan"
          ? `https://celeste.weg.fan/api/v2/download/gamebanana-files/${source}`
          : appState.mirror === "0x0ade"
            ? `https://celestemodupdater.0x0a.de/banana-mirror/${source}.zip`
            : `https://gamebanana.com/dl/${source}`;
    const roots = items.map(({ name, source }) => [name, resolveUrl(source)] as [string, string]);
    const attemptId = nextAttemptId++;
    const initial = items.map(({ name, source }) => ({
      name,
      requested: true,
      dependencies: [],
      cancelKey: items[0]?.name ?? "",
      source,
      ownerId,
      mod: { name },
      state: "pending" as const,
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      canceled: false,
      attemptId,
    }));
    set((state) => ({ tasks: replaceTasks(state.tasks, initial) }));

    return await new Promise<Download.TaskInfo[]>((resolve, reject) => {
      const onDownloadEvent = (rawTasks: string, state: "pending" | "failed" | "finished") => {
        let backendTasks: BackendModTaskInfo[];
        try {
          const parsed = JSON.parse(rawTasks) as unknown;
          if (!Array.isArray(parsed)) throw new Error("Expected an array");
          backendTasks = parsed as BackendModTaskInfo[];
        } catch (error) {
          const message = `Invalid download status: ${String(error)}`;
          onFailed?.(initial, message);
          reject(new Error(message));
          return;
        }
        const mapped = backendTasks.map((task, index) => ({
          name: task.name,
          requested: Boolean(task.requested),
          dependencies: task.dependencies ?? [],
          cancelKey: task.cancel_key,
          source: task.url,
          ownerId,
          mod: { name: task.name },
          state: (task.status === "Finished" ? "finished" : task.status === "Failed" ? "failed" : "pending") as Download.TaskInfo["state"],
          progress: task.status === "Finished" ? 100 : Number.parseFloat(task.data) || 0,
          error: task.status === "Failed" ? task.data : undefined,
          downloadedBytes: task.downloaded_bytes || 0,
          totalBytes: task.total_bytes || 0,
          speedBytesPerSec: task.speed_bytes_per_sec || 0,
          canceled: task.status === "Failed" && task.data === "Download canceled",
          paused: get().tasks[normalizeName(task.name)]?.paused,
          attemptId: attemptId + index,
        }));
        const byName = new Map(mapped.map((task) => [normalizeName(task.name), task]));
        const aggregated = mapped.map((task) =>
          task.requested
            ? { ...task, progress: aggregateProgress(task, byName) }
            : task,
        );
        set((store) => ({ tasks: replaceTasks(store.tasks, aggregated) }));
        const progress = aggregated.length
          ? aggregated.filter((task) => task.requested).reduce((sum, task) => sum + task.progress, 0) /
            Math.max(1, aggregated.filter((task) => task.requested).length)
          : 0;
        onProgress?.(aggregated, progress);
        if (state === "finished") {
          void reloadInstalledMods()
            .then(() => reloadBlacklistState(appState.gamePath))
            .finally(() => {
              onFinished?.(aggregated);
              resolve(aggregated);
            });
        } else if (state === "failed") {
          const message = aggregated.find((task) => task.error)?.error || "Download failed";
          onFailed?.(aggregated, message);
          reject(new Error(message));
        }
      };
      void callRemote(
        "download_mod_batch",
        JSON.stringify(roots),
        `${appState.gamePath}/Mods/`,
        JSON.stringify({
          ...appState.downloadTypeDefaults,
          __default: deferProfileUpdate
            ? true
            : autoDisableNewMods === undefined
              ? appState.downloadDefaultEnabled
              : !autoDisableNewMods,
        }),
        deferProfileUpdate ? false : appState.profileEnabled,
        deferProfileUpdate ? "" : appState.currentProfileName,
        JSON.stringify(appState.alwaysOnMods),
        onDownloadEvent,
        false,
        appState.useMultiThread,
      ).catch((error) => {
        onFailed?.(initial, String(error));
        reject(error);
      });
    });
  },

  downloadMod(name, gbFileIdOrUrl, options = {}) {
    const {
      force = false,
      autoDisableNewMods,
      ownerId,
      onProgress,
      onFinished,
      onFailed,
      deferProfileUpdate = false,
    } = options;
    const appState = useAppStore.getState();
    const source = gbFileIdOrUrl;
    const url = source.startsWith("http")
      ? source
      : appState.mirror === "wegfan"
        ? `https://celeste.weg.fan/api/v2/download/gamebanana-files/${source}`
        : appState.mirror === "0x0ade"
          ? `https://celestemodupdater.0x0a.de/banana-mirror/${source}.zip`
          : `https://gamebanana.com/dl/${source}`;
    const key = normalizeName(name);
    const existingTask = get().tasks[key];
    const replacingInstalledMod = appState.installedMods.find(
      (mod) => normalizeName(mod.name) === key,
    );

    if (replacingInstalledMod && !force) {
      const failedTask: Download.TaskInfo = {
        name,
        requested: true,
        dependencies: [],
        cancelKey: name,
        source,
        ownerId: ownerId ?? existingTask?.ownerId,
        mod: { name },
        state: "failed",
        error: "Mod already installed",
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        canceled: false,
        attemptId: nextAttemptId++,
      };
      set((state) => ({ tasks: replaceTasks(state.tasks, [failedTask]) }));
      onFailed?.(failedTask, failedTask.error!);
      return failedTask;
    }

    if (existingTask && !force && existingTask.state === "pending") return existingTask;

    const attemptId = nextAttemptId++;
    const initialTask: Download.TaskInfo = {
      name,
      requested: true,
      dependencies: [],
      cancelKey: name,
      source,
      ownerId: ownerId ?? existingTask?.ownerId,
      mod: { name },
      state: "pending",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      canceled: false,
      attemptId,
    };
    set((state) => ({ tasks: replaceTasks(state.tasks, [initialTask]) }));

    const onDownloadEvent = (
      rawTasks: string,
      state: "pending" | "failed" | "finished",
    ) => {
      const current = get().tasks[key];
      if (!current || current.attemptId !== attemptId) return;

      let backendTasks: BackendModTaskInfo[];
      try {
        const parsed = JSON.parse(rawTasks) as unknown;
        if (!Array.isArray(parsed)) throw new Error("Expected an array");
        backendTasks = parsed as BackendModTaskInfo[];
      } catch (error) {
        const message = `Invalid download status for ${name}: ${String(error)}`;
        const failedTask = { ...current, state: "failed" as const, error: message };
        set((store) => ({ tasks: replaceTasks(store.tasks, [failedTask]) }));
        onFailed?.(failedTask, message);
        return;
      }

      const mapped = backendTasks.map((task) => {
        const taskKey = normalizeName(task.name);
        const previous = get().tasks[taskKey];
        const taskState =
          task.status === "Finished"
            ? "finished"
            : task.status === "Failed"
              ? "failed"
              : "pending";
        return {
          name: task.name,
          requested: Boolean(task.requested),
          dependencies: task.dependencies ?? [],
          cancelKey: task.cancel_key,
          source: task.url,
          ownerId: previous?.ownerId ?? (taskKey === key ? ownerId : undefined),
          mod: { name: task.name },
          state: taskState as Download.TaskInfo["state"],
          progress:
            task.status === "Finished"
              ? 100
              : Number.parseFloat(task.data) || 0,
          error: task.status === "Failed" ? task.data : undefined,
          downloadedBytes: task.downloaded_bytes || 0,
          totalBytes: task.total_bytes || 0,
          speedBytesPerSec: task.speed_bytes_per_sec || 0,
          canceled: task.status === "Failed" && task.data === "Download canceled",
          paused: previous?.paused,
          attemptId: previous?.attemptId ?? attemptId,
        } satisfies Download.TaskInfo;
      });
      const byName = new Map(mapped.map((task) => [normalizeName(task.name), task]));
      const aggregated = mapped.map((task) =>
        task.requested
          ? { ...task, progress: aggregateProgress(task, byName) }
          : task,
      );
      set((store) => ({ tasks: replaceTasks(store.tasks, aggregated) }));

      const currentRoot =
        aggregated.find((task) => normalizeName(task.name) === key) ?? current;
      const overallProgress = currentRoot.progress;
      const rootTask = {
        ...currentRoot,
        state,
        progress: state === "finished" ? 100 : overallProgress,
      } as Download.TaskInfo;

      if (state === "finished") {
        void reloadInstalledMods()
          .then(() => reloadBlacklistState(appState.gamePath))
          .catch((error) => console.error("Failed to refresh installed Mods", error))
          .finally(() => onFinished?.(rootTask));
      } else if (state === "failed") {
        onFailed?.(rootTask, rootTask.error || "Download failed");
      } else {
        onProgress?.(rootTask, overallProgress);
      }
    };

    void callRemote(
      "download_mod_batch",
      JSON.stringify([[name, url]]),
      `${appState.gamePath}/Mods/`,
      JSON.stringify({
        ...appState.downloadTypeDefaults,
        __default: deferProfileUpdate
          ? true
          : autoDisableNewMods === undefined
            ? appState.downloadDefaultEnabled
            : !autoDisableNewMods,
      }),
      deferProfileUpdate ? false : appState.profileEnabled,
      deferProfileUpdate ? "" : appState.currentProfileName,
      JSON.stringify(appState.alwaysOnMods),
      onDownloadEvent,
      false,
      appState.useMultiThread,
    ).catch((error) => {
      const current = get().tasks[key];
      if (!current || current.attemptId !== attemptId) return;
      const failedTask = { ...current, state: "failed" as const, error: String(error) };
      set((store) => ({ tasks: replaceTasks(store.tasks, [failedTask]) }));
      onFailed?.(failedTask, failedTask.error!);
    });

    return initialTask;
  },
}));
