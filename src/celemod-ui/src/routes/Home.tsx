import _i18n from 'src/i18n';
import { useI18N } from 'src/i18n';
import { h } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { GameSelector } from '../components/GameSelector';
import { Icon } from '../components/Icon';
import {
    callRemote,
    selectGamePath,
    useBlockingMask
} from '../utils';
// @ts-ignore
import strawberry from '../resources/Celemod.png';
import {
    useCurrentBlacklistProfile,
    useCurrentLang,
    useGamePath,
    useMirror,
    useStorage,
} from '../states';
import { ModBlacklistProfile } from '../ipc/blacklist';
import { useEffect } from 'react';
import { Button } from '../components/Button';
import './Home.scss';
import { createPopup } from '../components/Popup';
import { useEnableAcrylic } from 'src/context/theme';

export const Home = () => {
    useI18N();
    const [gamePath, setGamePath] = useGamePath();
    const gamePaths = useMemo(() => {
        const paths = callRemote('get_celeste_dirs')
            .split('\n')
            .filter((v: string | null) => v);
        if (!gamePath && paths.length > 0) {
            // setGamePath(paths[0]);
        }
        return paths;
    }, [gamePath]);
    const [counter, setCounter] = useState(0);

    const [lastUseMap, setLastUseMap] = useState<{
        [profile: string]: number;
    }>({});

    const {
        profiles,
        setProfiles,
        currentProfileName,
        setCurrentProfileName,
        currentProfile,
        setCurrentProfile,
    } = useCurrentBlacklistProfile();

    const { storage, save } = useStorage();

    useEffect(() => {
        if (storage) {
            storage.root ??= {};
            storage.root.lastUseMap ??= {};
            setLastUseMap(storage.root.lastUseMap);
        }
    }, [storage]);

    const mask = useBlockingMask();

    useEffect(() => {
        if (!gamePath) return;
        setCurrentProfileName(callRemote('get_current_profile', gamePath));
        callRemote('get_blacklist_profiles', gamePath, (data: string) => {
            setProfiles(JSON.parse(data));
        });
    }, [gamePath]);

    useEffect(() => {
        setCurrentProfile(
            profiles.find((v) => v.name === currentProfileName) || null
        );
    }, [currentProfileName, profiles]);

    const formatTime = (time: number) => {
        if (time === 0) return _i18n.t('未知');
        const now = Date.now();
        const diff = now - time;
        if (diff < 1000 * 60) return _i18n.t('刚刚');
        if (diff < 1000 * 60 * 60)
            return _i18n.t('{slot0}分钟前', { slot0: Math.floor(diff / 1000 / 60) });
        if (diff < 1000 * 60 * 60 * 24)
            return _i18n.t('{slot0}小时前', {
                slot0: Math.floor(diff / 1000 / 60 / 60),
            });
        if (diff < 1000 * 60 * 60 * 24 * 30)
            return _i18n.t('{slot0}天前', {
                slot0: Math.floor(diff / 1000 / 60 / 60 / 24),
            });
        if (diff < 1000 * 60 * 60 * 24 * 30 * 12)
            return _i18n.t('{slot0}月前', {
                slot0: Math.floor(diff / 1000 / 60 / 60 / 24 / 30),
            });
        return _i18n.t('很久以前');
    };

    const i18nCtx = useI18N();

    const { enableAcrylic, setEnableAcrylic } = useEnableAcrylic();

    const [downloadMirror, setDownloadMirror] = useMirror();

    return (
        <div class="home">
            <div className="info">
                <span className="part">
                    <img src={strawberry} alt="" srcset="" />
                </span>
                <span className="part">
                    <div className="title">CeleMod</div>
                    <div className="subtitle">An alternative mod manager for Celeste</div>
                </span>
            </div>
            <br />

            {gamePath ? (
                <div className="config">
                    <GameSelector
                        paths={gamePaths}
                        onSelect={(e: InputEvent) => {
                            // @ts-ignore
                            const value = e.target.value;
                            if (value === '__other__') {
                                // @ts-ignore
                                e.target.value = gamePath;
                                selectGamePath(setGamePath);
                            } else setGamePath(value);
                        }}
                        launchGame={(v) => {
                            lastUseMap[currentProfileName] = Date.now();
                            setLastUseMap(lastUseMap);
                            save();
                            mask.setMaskEnabled(true);
                            mask.setMaskText(_i18n.t('正在启动'));
                            callRemote(
                                'start_game_directly',
                                gamePath || gamePaths[0],
                                v === 'origin'
                            );
                            setTimeout(() => {
                                mask.setMaskEnabled(false);
                            }, 20000);
                        }}
                    />
                </div>
            ) : (
                <div className="config">
                    {_i18n.t(
                        '未找到游戏！请先安装 Steam 商店或Epic 商店版的 Celeste，或'
                    )}
                    <span
                        onClick={() => {
                            selectGamePath(setGamePath);
                        }}
                        style={{
                            color: '#a77fdb',
                        }}
                    >
                        {_i18n.t('点此手动选择')}
                    </span>
                </div>
            )}

            <div className="config">
                <Icon name="download" />
                &nbsp;
                <span>{_i18n.t('下载设置')}</span>
            </div>

            <div className="config-block">
                <input
                    type="checkbox"
                    checked={downloadMirror === 'wegfan'}
                    name="usecnmirror"
                    onChange={(e) => {
                        //@ts-ignore
                        const checked = e.target.checked;
                        setDownloadMirror(checked ? 'wegfan' : 'gamebanana')
                    }}
                />

                <label for="usecnmirror">{_i18n.t('使用中国镜像 ( @WEGFan )')}</label>
            </div>

            <div className="config-block">
                <input type="checkbox" checked={true} disabled />
                <label>{_i18n.t('使用 16 线程下载')}</label>
            </div>

            <div className="config">
                <Icon name="file" />
                &nbsp;
                <span>{_i18n.t('Profile 选择')}</span>
            </div>

            <div className="config-block profiles">
                {profiles.map((v) => (
                    <div
                        class={`profile ${v.name === currentProfileName && 'selected'}`}
                        onClick={() => {
                            setCurrentProfileName(v.name);
                        }}
                    >
                        <div className="name">{v.name}</div>
                        <div className="info">
                            <span className="tips">{_i18n.t('上次启动')}</span>
                            <span className="inf">{formatTime(lastUseMap[v.name] || 0)}</span>
                        </div>

                        <div className="info">
                            <span className="tips">{_i18n.t('禁用的 Mod 数')}</span>
                            <span className="inf">{v.mods.length}</span>
                        </div>

                        <Button
                            onClick={
                                // @ts-ignore
                                (e) => {
                                    e.stopPropagation();
                                    setCurrentProfileName(v.name);
                                    lastUseMap[v.name] = Date.now();
                                    save();
                                    setLastUseMap(lastUseMap);
                                    mask.setMaskEnabled(true);
                                    mask.setMaskText(_i18n.t('正在启动'));
                                    setTimeout(() => {
                                        callRemote(
                                            'start_game_directly',
                                            gamePath || gamePaths[0],
                                            false
                                        );
                                    }, 300);

                                    setTimeout(() => {
                                        mask.setMaskEnabled(false);
                                    }, 20000);
                                }
                            }
                        >
                            {_i18n.t('启动')}
                        </Button>
                    </div>
                ))}
            </div>

            <div className="config theme">
                <Icon name="edit" />
                &nbsp;
                <span>{_i18n.t('界面设置')}</span>
            </div>

            <div className="config-block">
                <label>
                    <input
                        type="checkbox"
                        checked={enableAcrylic}
                        onClick={() => {
                            setEnableAcrylic(!enableAcrylic);
                        }}
                    />

                    <span>{_i18n.t('启用亚克力效果')}</span>
                </label>

                <div class="languageSelect">
                    <span>{_i18n.t('语言')}</span>&nbsp;
                    <select
                        onChange={(e: any) => {
                            i18nCtx.setLang(e.target.value);
                        }}
                        value={i18nCtx.currentLang}
                    >
                        <option value="zh-CN">{_i18n.t('简体中文')}</option>
                        <option value="en-US">English</option>
                        {/* <option value="ru-RU">русский</option>
                        <option value="de-DE">Deutsch</option>
                        <option value="fr-FR">Français</option> */}
                    </select>
                </div>
            </div>
        </div>
    );
};
