import { callRemote } from "../utils";
import { useInstalledMods, useGamePath, useMirror as useMirror, useStorage, initUseMultiThread, useUseMultiThread } from "../states";
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

export const createDownloadContext = () => {
    const { installedMods } = useInstalledMods();
    const [gamePath] = useGamePath();

    initUseMultiThread();
    const [useMultiThread, setUseMultiThread] = useUseMultiThread();

    const downloadTasks = useRef<{
        [id: string]: Download.TaskInfo;
    }>({});

    const eventBus = useMemo(() => new EventTarget(), []);

    const [downloadMirror, setDownloadMirror] = useMirror();

    const ctx = {
        eventBus,
        downloadTasks,
        downloadMod: (name: string, gb_fileid_or_url: string, {
            force = false,
            autoDisableNewMods = false,
            onProgress = (task: Download.TaskInfo, progress: number) => { },
            onFinished = (task: Download.TaskInfo) => { },
            onFailed = (task: Download.TaskInfo, error: string) => { }
        }) => {

            let url;
            if (gb_fileid_or_url.startsWith("http")) url = gb_fileid_or_url;
            else {
                const gb_fileid = gb_fileid_or_url
                if (downloadMirror === 'wegfan') url = `https://celeste.weg.fan/api/v2/download/gamebanana-files/${gb_fileid}`;
                else if (downloadMirror === '0x0ade') url = `https://celestemodupdater.0x0a.de/banana-mirror/${gb_fileid}.zip`
                else url = `https://gamebanana.com/dl/${gb_fileid}`
            }

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

                callRemote("download_mod", name, url, gamePath + "/Mods/", autoDisableNewMods, (_subtasks: string, state: "pending" | "failed" | "finished") => {
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
                }, false, useMultiThread);
            }
            return downloadTasks.current[name];
        }
    }

    return ctx
}