import "./RecommendMods.scss"
import { h } from "preact";
import { useGamePath, useInstalledMods } from "../states";
import { Mod } from "../components/ModList";
import { Button } from "../components/Button";
import { useState, useEffect } from "react";
import { callRemote } from "../utils";
import { functionalMods, skinMods } from "../resources/RecommendModData";
import { useRef } from "preact/hooks";
import { useGlobalContext } from "../App";
import { enforceEverest } from "../components/EnforceEverestPage";

const modNameFromUrl = (url: string) => {
    return decodeURIComponent(url.split('/mods/').pop() || '');
}

const RMod = ({
    name, download_url, description, installed, startDownloadHandler, modsFolder
}: {
    name: string,
    download_url: string,
    description: string,
    installed?: boolean,
    startDownloadHandler?: any,
    modsFolder?: string
}) => {
    
    const [state, setState] = useState(installed ? "已安装" : "下载");
    const ctx = useGlobalContext();

    const startDownload = () => {
        if (state !== "下载") return;
        setState('准备下载')
        ctx.download.downloadMod(modNameFromUrl(download_url), download_url, {
            onProgress(task, progress) {
                setState(`${progress}% (${task.subtasks.filter(v => v.state === 'Finished').length}/${task.subtasks.length})`)
            },
            onFinished() {
                setState('已安装')
                ctx.modManage.reloadMods();
            },
            onFailed(task, error) {
                setState('下载失败')
            }
        });
    }

    startDownloadHandler.download = startDownload;

    return <div className="rmod">
        <div className="info">
            <div className="name">{name}</div>
            <div className="desc">{description}</div>
        </div>
        <div className="oper">
            <Button onClick={() => {
                if (installed) return;
                startDownloadHandler.download();
            }}>{state}</Button>
        </div>
    </div>
}

export const RecommendMods = () => {
    const noEverest = enforceEverest();
    if (noEverest) return noEverest;

    const { installedMods } = useInstalledMods();
    const modsPath = useGamePath(v => v.gamePath + '/Mods');
    const refDownloadHandlers = useRef([
        ...functionalMods,
        ...skinMods
    ].reduce((prev, mod) => {
        // @ts-ignore
        prev[mod.name] = {};
        return prev;
    }, {}))

    return <div>
        <h1>推荐的模组</h1>
        <p>这里将会列出一些推荐安装的模组及其简介，请按需安装</p>

        <div className="mods">
            <div className="part">
                <h2>功能性模组 <Button onClick={() => {
                    for (const mod of functionalMods) {
                        // @ts-ignore
                        refDownloadHandlers.current[mod.name].download();
                    }
                }}>
                    下载所有
                </Button></h2>
                <div className="list">
                    {
                        functionalMods.map(mod => (
                            <RMod name={mod.name}
                                startDownloadHandler={
                                    // @ts-ignore
                                    refDownloadHandlers.current[mod.name]
                                }
                                download_url={mod.download_url}
                                description={mod.description}
                                modsFolder={modsPath}
                                installed={installedMods.some(m => m.name === modNameFromUrl(mod.download_url))} />
                        ))
                    }
                </div>
            </div>
            <div className="part">
                <h2>皮肤模组</h2>
                <div className="list">
                    {
                        skinMods.map(mod => (
                            <RMod name={mod.name}
                                download_url={mod.download_url}
                                description={mod.description}
                                modsFolder={modsPath}
                                startDownloadHandler={
                                    // @ts-ignore
                                    refDownloadHandlers.current[mod.name]
                                }
                                installed={installedMods.some(m => m.name === modNameFromUrl(mod.download_url))} />
                        ))
                    }
                </div>
            </div>

        </div>
    </div>
}