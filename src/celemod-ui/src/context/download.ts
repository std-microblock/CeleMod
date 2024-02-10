import { callRemote } from "../utils";
import { useInstalledMods, useGamePath } from "../states";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { EventTarget } from "../utils";

export namespace Download {
    interface Preparing {
        state: "Preparing";
    }

    interface Downloading {
        state: "Downloading";
        progress: number;
    }

    interface Downloaded {
        state: "Downloaded";
    }

    interface Failed {
        state: "Failed";
        reason: string;
    }

    export interface SubtaskInfo {
        name: string;
        progress: number;
        from: string;
        to: string;
        state: "Downloading" | "Finished" | "Failed" | "Waiting";
        error?: string;
    }

    export type State = Preparing | Downloading | Downloaded | Failed;

    export interface TaskInfo {
        name: string;
        subtasks: SubtaskInfo[];
        mod: {
            name: string;
            id?: string;
        },
        state: "finished" | "failed" | "pending";
        error?: string;
        progress: number;
    }
}

interface BackendDownloadInfo {
    name: string;
    url: string;
    dest: string;
    status: "Waiting" | "Downloading" | "Finished" | "Failed";
    data: string;
}

const makePathName = (name: string) => {
    return name.replace(/[^a-zA-Z0-9]/g, "_");
}

export const useDownloadContext = () => {
    const { installedMods } = useInstalledMods();
    const gamePath = useGamePath(v => v.gamePath);

    const downloadTasks = useRef<{
        [id: string]: Download.TaskInfo;
    }>({});

    const eventBus = useMemo(() => new EventTarget(), []);

    const ctx = {
        eventBus,
        downloadTasks,
        downloadMod: (name: string, url: string, {
            force = false,
            onProgress = (task: Download.TaskInfo, progress: number) => { },
            onFinished = (task: Download.TaskInfo) => { },
            onFailed = (task: Download.TaskInfo, error: string) => { }
        }) => {
            if (installedMods.find(m => m.name === name)) {
                if (force) {
                    callRemote("rm_mod", gamePath + "/Mods/", name)
                } else {
                    const task = {
                        name,
                        subtasks: [],
                        mod: {
                            name
                        },
                        state: "failed",
                        error: "Mod already installed",
                        progress: 0
                    } as Download.TaskInfo;
                    onFailed(task, "Mod already installed");
                    return task
                }
            }

            if (!downloadTasks.current[name] || force) {
                downloadTasks.current[name] = {
                    name,
                    subtasks: [],
                    mod: {
                        name
                    },
                    state: "pending",
                    progress: 0
                }

                eventBus.dispatchEvent('taskListChanged')

                callRemote("download_mod", name, url, gamePath + "/Mods/", (_subtasks: string, state: "pending" | "failed" | "finished") => {
                    console.log(_subtasks, state)
                    const subtasks = JSON.parse(_subtasks) as BackendDownloadInfo[];
                    const task = downloadTasks.current[name];
                    task.subtasks = subtasks.map(s => ({
                        name: s.name,
                        progress: s.status === "Downloading" ? parseFloat(s.data) :
                            s.status === "Finished" ? 100 : 0,
                        from: s.url,
                        to: s.dest,
                        error: s.status === "Failed" ? s.data : undefined,
                        state: s.status
                    }));

                    task.state = state;
                    if (state === "finished") {
                        onFinished(task);
                    } else if (state === "failed") {
                        task.error = subtasks.find(s => s.status === "Failed")?.data;
                        onFailed(task, "Download failed");
                    } else {
                        task.progress = parseFloat(subtasks.find(s => s.status === "Downloading")?.data || "0");
                        onProgress(task, task.progress);
                    }

                    eventBus.dispatchEvent('taskListChanged')
                }, false);
            }
            return downloadTasks.current[name];
        }
    }

    return ctx
}