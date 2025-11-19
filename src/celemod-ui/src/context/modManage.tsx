import _i18n, { useI18N } from 'src/i18n';
import { callRemote } from '../utils';
import {
    useInstalledMods,
    useGamePath,
    useStorage,
    initGamePath,
    useCurrentEverestVersion,
    initModComments,
} from '../states';
import { useEffect, useMemo, useContext } from 'preact/hooks';
import { createPopup, PopupContext } from 'src/components/Popup';
import { Fragment, h } from 'preact';
import { ProgressIndicator } from 'src/components/Progress';

let lastGamePath = '';
export const createModManageContext = () => {
    initModComments();

    const { setInstalledMods } = useInstalledMods();

    const [gamePath] = useGamePath();

    const { storage, save } = useStorage();

    useEffect(() => {
        if (!gamePath) return;
        if (!storage) return;

        storage.root ??= {};
        storage.root.lastGamePath = gamePath;
        console.log('saving game path', gamePath);
        save();
    }, [gamePath, storage]);

    initGamePath();

    const ctx = {
        reloadMods: () => {
            return new Promise((rs, rj) => {
                if (!gamePath) {
                    console.warn('game path not set');
                    rj('game path not set');
                    return;
                }
                callRemote('get_installed_mods', gamePath + '/Mods', (data: string) => {
                    console.log('mod reload finished');
                    const da = JSON.parse(data);
                    rs(da);
                    setInstalledMods(da);
                });
            });
        },
        gamePath,
        modsPath: gamePath + '/Mods',
    };

    // WHY THE FUCK useEffect doesn't trigger here
    if (lastGamePath !== gamePath) {
        lastGamePath = gamePath;

        if (gamePath) {

            callRemote("get_everest_version", gamePath, (ver: string) => {
                console.log("[modManage] Everest version", ver)
                if (ver && ver.length > 2) {
                    setTimeout(() => {
                        const popup = createPopup(
                            () => {
                                return (
                                    <div className="loading-popup">
                                        <ProgressIndicator infinite />
                                        <span>{_i18n.t('正在加载 Mod 列表，请稍等')}</span>
                                    </div>
                                );
                            },
                            {
                                cancelable: false,
                            }
                        );
                        ctx
                            .reloadMods()
                            .then((mods) => {
                                popup.hide();
                                const is_using_cache = callRemote('is_using_cache');
                                if (is_using_cache)
                                    createPopup(() => {
                                        const { hide } = useContext(PopupContext);
                                        return (
                                            <div className="popup-content">
                                                <div className="title">{_i18n.t('离线模式')}</div>
                                                <div className="content">{_i18n.t('正在使用缓存的 Mod 数据，可能已过期或不完整')}</div>
                                                <div className="buttons">
                                                    <button onClick={hide}>{_i18n.t('确定')}</button>
                                                </div>
                                            </div>
                                        );
                                    });
                            })
                            .catch((e) => {
                                popup.hide();
                                const p = createPopup(() => {
                                    return (
                                        <div className="popup-content">
                                            <div className="title">{_i18n.t('加载 Mod 列表失败')}</div> <div className="content">
                                                <p>{_i18n.t('请检查游戏路径是否正确，或网络连接是否正常')}</p>
                                                <p>{_i18n.t('部分功能将不可用')}</p>
                                                <p>{e}</p></div><div className="buttons">
                                                <button onClick={() => {
                                                    p.hide()
                                                }}>{_i18n.t('确定')}</button>
                                            </div>
                                        </div>
                                    );
                                });
                            });
                    }, 10);
                }
            });
        }
    }

    return ctx;
};
