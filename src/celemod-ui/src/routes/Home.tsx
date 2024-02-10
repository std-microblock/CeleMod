import { h } from "preact";
import { useMemo, useState } from "preact/hooks";
import { GameSelector } from "../components/GameSelector";
import { Icon } from "../components/Icon";
import { callRemote, useBlockingMask, useSysModule } from "../utils";
import strawberry from "../resources/Strawberry.webp"
import { useCurrentBlacklistProfile, useDownloadSettings, useGamePath, useStorage } from "../states";
import { ModBlacklistProfile } from "../ipc/blacklist";
import { useEffect } from "react";
import { Button } from "../components/Button";
import "./Home.scss"
import { createPopup } from "../components/Popup";

export const Home = () => {
    const [gamePath, setGamePath] = useGamePath(v => [v.gamePath, v.setGamePath]);
    const gamePaths = useMemo(() => {
        const paths = callRemote("get_celeste_dirs").split("\n").filter((v: string | null) => v);
        if (!gamePath && paths.length > 0) {
            setGamePath(paths[0]);
        }
        return paths;
    }, [gamePath]);
    const [useChinaMirror, setUseChinaMirror] = useDownloadSettings(v => [v.useCNMirror, v.setUseCNMirror]);
    const [counter, setCounter] = useState(0);

    const [lastUseMap, setLastUseMap] = useState<{
        [profile: string]: number
    }>({});
    const Storage = useSysModule("storage");

    const [enableAcrylic, setEnableAcrylic] = useState(true);

    const { profiles, setProfiles,
        currentProfileName, setCurrentProfileName,
        currentProfile, setCurrentProfile } = useCurrentBlacklistProfile()

    const {
        storage, _setStorage, _setSaveHandler, save
    } = useStorage();

    useEffect(() => {
        if (Storage) {
            const storageLU = Storage.open("./cele-mod.db");

            console.log('Storage', storageLU)
            // @ts-ignore
            window.configStorage = storageLU;
            _setStorage(storageLU)
            _setSaveHandler(() => {
                storageLU.commit();
            })

            window.addEventListener('beforeunload', ()=>{
                storageLU.close();
            })
        }
    }, [Storage]);

    useEffect(() => {
        if (storage) {
            storage.root ??= {};
            storage.root.lastUseMap ??= {};
            setLastUseMap(storage.root.lastUseMap);
        }
    }, [storage])

    const mask = useBlockingMask();

    useEffect(() => {
        if (!gamePath) return;
        setCurrentProfileName(callRemote('get_current_profile', gamePath))
        callRemote('get_blacklist_profiles', gamePath, (data: string) => {
            setProfiles(JSON.parse(data));
        });
    }, [gamePath])

    useEffect(() => {
        setCurrentProfile(profiles.find(v => v.name === currentProfileName) || null);
    }, [currentProfileName, profiles])

    const formatTime = (time: number) => {
        if (time === 0) return '未知'
        const now = Date.now();
        const diff = now - time;
        if (diff < 1000 * 60) return "刚刚";
        if (diff < 1000 * 60 * 60) return `${Math.floor(diff / 1000 / 60)}分钟前`;
        if (diff < 1000 * 60 * 60 * 24) return `${Math.floor(diff / 1000 / 60 / 60)}小时前`;
        if (diff < 1000 * 60 * 60 * 24 * 30) return `${Math.floor(diff / 1000 / 60 / 60 / 24)}天前`;
        if (diff < 1000 * 60 * 60 * 24 * 30 * 12) return `${Math.floor(diff / 1000 / 60 / 60 / 24 / 30)}月前`;
        return "很久以前";
    }

    return <div class="home">

        <div className="info">
            <span className="part">
                <img src={strawberry} alt="" srcset="" />
            </span>
            <span className="part">
                <div className="title">
                    CeleMod
                </div>
                <div className="subtitle">
                    An alternative mod manager for Celeste
                </div>
            </span>
        </div>
        <br />
        <br />

        {
            gamePath ? <div className="config">
            <GameSelector paths={gamePaths} onSelect={(e: InputEvent) => {
                // @ts-ignore
                setGamePath(e.target.value);
            }} launchGame={() => {
                lastUseMap[currentProfileName] = Date.now();
                setLastUseMap(lastUseMap);
                save();
                mask.setMaskEnabled(true);
                mask.setMaskText("正在启动");
                callRemote("start_game", gamePath || gamePaths[0]);
                setTimeout(() => {
                    mask.setMaskEnabled(false);
                }, 20000);
            }} />
        </div> : <div className="config">
            未找到游戏！请先安装 Steam 商店或Epic 商店版的 Celeste，或 <span onClick={()=>{
                // @ts-ignore
                const res = Window.this.selectFile({mode: 'open', filter:'celeste.exe|celeste.exe'});
                if(res !== null) {
                    // strip file:// and Celeste.exe
                    const before = "file://".length
                    const after = "celeste.exe".length
                    const path = res.slice(before, res.length - after)
                    console.log("Selected", path)
                    setGamePath(path);
                }
            }} style={{
                color: '#a77fdb'
            }}>点此手动选择</span>
        </div>
        }


        <div className="config">
            <Icon name="download" />
            &nbsp;
            <span>下载设置</span>
        </div>

        <div className="config-block">
            <input type="checkbox" checked={useChinaMirror} disabled name="usecnmirror" onChange={e => {
                //@ts-ignore
                const checked = e.target.checked;
                setUseChinaMirror(checked);
            }} />
            <label for="usecnmirror"> 使用中国镜像 ( @WEGFan ) </label>
        </div>

        <div className="config-block">
            <input type="checkbox" checked={true} disabled />
            <label> 使用 16 线程下载 </label>
        </div>

        <div className="config">
            <Icon name="file" />
            &nbsp;
            <span>Profile 选择</span>
        </div>

        <div className="config-block profiles">
            {
                profiles.map(v => <div class={`profile ${v.name === currentProfileName && 'selected'}`} onClick={() => {
                    setCurrentProfileName(v.name);
                }}>
                    <div className="name">{v.name}</div>
                    <div className="info">
                        <span className="tips">上次启动</span>
                        <span className="inf">{
                            formatTime(lastUseMap[v.name] || 0)
                        }</span>
                    </div>

                    <div className="info">
                        <span className="tips">禁用的 Mod 数</span>
                        <span className="inf">{v.mods.length}</span>
                    </div>

                    <Button onClick={
                        // @ts-ignore
                        (e) => {
                        e.stopPropagation();
                        setCurrentProfileName(v.name);
                        lastUseMap[v.name] = Date.now();
                        save(

                        )
                        setLastUseMap(lastUseMap);
                        mask.setMaskEnabled(true);
                        mask.setMaskText("正在启动");
                        setTimeout(() => {
                            callRemote("start_game", gamePath || gamePaths[0]);
                        }, 300);

                        setTimeout(() => {
                            mask.setMaskEnabled(false);
                        }, 20000);
                    }}>
                        启动
                    </Button>
                </div>)
            }
        </div>
    </div>;
};
