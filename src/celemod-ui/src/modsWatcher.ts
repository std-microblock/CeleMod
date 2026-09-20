import { listen } from "@tauri-apps/api/event";
import { callRemote } from "./tauri/commands";
import {
  reloadBlacklistState,
  reloadInstalledMods,
  useAppStore,
} from "./states";

export const MODS_CHANGED_EVENT = "celemod://mods-changed";

type ModsChangedPayload = {
  gamePath: string;
  added: string[];
  removed: string[];
  changed: string[];
};

const normalizePath = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();

const describeChange = (payload: ModsChangedPayload) =>
  [
    payload.added.length ? `新增 ${payload.added.join(", ")}` : "",
    payload.removed.length ? `移除 ${payload.removed.join(", ")}` : "",
    payload.changed.length ? `更新 ${payload.changed.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("；");

let watchedPath = "";
let syncRequest = 0;
let listening: Promise<() => void> | undefined;
let reloadQueue: Promise<void> = Promise.resolve();

const matchesWatchedPath = (path: string) => {
  const normalized = normalizePath(path);
  if (watchedPath !== "" && normalizePath(watchedPath) === normalized)
    return true;
  // The watcher can report before the freshly configured path round-trips,
  // so fall back to the currently selected game.
  const current = useAppStore.getState().gamePath;
  return current !== "" && normalizePath(current) === normalized;
};

const reloadMods = (payload: ModsChangedPayload) => {
  if (!matchesWatchedPath(payload.gamePath)) return;
  const summary = describeChange(payload);
  reloadQueue = reloadQueue
    .then(async () => {
      if (!matchesWatchedPath(payload.gamePath)) return;
      console.log(
        `Mods 文件夹发生变化（${summary || "内容变更"}），正在重新加载 Mod 列表`,
      );
      await reloadInstalledMods(useAppStore.getState().gamePath);
      await reloadBlacklistState(useAppStore.getState().gamePath);
    })
    .catch((error) => {
      console.error("重新加载 Mod 列表失败", error);
    });
};

const ensureListener = () => {
  if (listening) return listening;
  listening = listen<ModsChangedPayload>(MODS_CHANGED_EVENT, (event) => {
    reloadMods(event.payload);
  });
  return listening;
};

/// Points the backend file watcher at the selected game and makes sure the
/// frontend reacts to the changes it reports.
export const syncModsWatcher = async (gamePath: string) => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const request = ++syncRequest;
  await ensureListener();
  const watched = await callRemote<string>(
    "configure_mods_watcher",
    gamePath ?? "",
  );
  if (request === syncRequest) watchedPath = watched ?? "";
};
