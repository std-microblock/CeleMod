import _i18n, { useI18N } from 'src/i18n';
import { callRemote } from '../utils';
import {
    useInstalledMods,
    useGamePath,
    useStorage,
    initGamePath,
    useCurrentEverestVersion,
} from '../states';
import { useEffect, useMemo } from 'preact/hooks';
import { createPopup } from 'src/components/Popup';
import { Fragment, h } from 'preact';
import { ProgressIndicator } from 'src/components/Progress';

let lastGamePath = '';
export const createModManageContext = () => {
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
                            .then(() => popup.hide())
                            .catch((e) => {
                                popup.hide();
                                createPopup(() => {
                                    return (
                                        <div className="loading-popup">
                                            <h1>{_i18n.t('加载 Mod 列表失败')}</h1>
                                            <p>{_i18n.t('请检查游戏路径是否正确，或网络连接是否正常')}</p>
                                            <p>{_i18n.t('部分功能将不可用')}</p>
                                            <p>{e}</p>
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
