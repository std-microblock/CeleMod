import _i18n from 'src/i18n';
import { callRemote } from '../utils';
import {
    useInstalledMods,
    useGamePath,
    initGamePath,
    initModComments,
} from '../states';
import { useEffect, useContext } from 'react';
import { createPopup, PopupContext } from 'src/components/Popup';
import { ProgressIndicator } from 'src/components/Progress';

export const createModManageContext = () => {
    initModComments();

    const { setInstalledMods } = useInstalledMods();

    const [gamePath] = useGamePath();

    initGamePath();

    const ctx = {
        reloadMods: () => {
            return new Promise((rs, rj) => {
                if (!gamePath) {
                    console.warn('game path not set');
                    rj('game path not set');
                    return;
                }
                void callRemote('get_installed_mods', gamePath + '/Mods', (data: string) => {
                    try {
                        console.log('mod reload finished');
                        const da = JSON.parse(data);
                        rs(da);
                        setInstalledMods(da);
                    } catch (error) {
                        rj(error);
                    }
                }).catch(rj);
            });
        },
        checkInvalidZipMods: () => {
            if (!gamePath) return;
            callRemote('get_invalid_zip_mod_files', gamePath + '/Mods', (data: string) => {
                const invalidFiles = JSON.parse(data) as string[];
                if (invalidFiles.length === 0) return;

                createPopup(() => {
                    const { hide } = useContext(PopupContext);

                    return (
                        <div className="popup-content">
                            <div className="title">{_i18n.t('发现无效 Mod 压缩包')}</div>
                            <div className="content">
                                <p>{_i18n.t('以下文件不是有效的 zip，继续保留可能导致游戏崩溃：')}</p>
                                <p>{invalidFiles.join(', ')}</p>
                            </div>
                            <div className="buttons">
                                <button onClick={hide}>{_i18n.t('暂不处理')}</button>
                                <button onClick={() => {
                                    callRemote('delete_mod_files', gamePath + '/Mods', JSON.stringify(invalidFiles), () => {
                                        ctx.reloadMods();
                                        hide();
                                    });
                                }}>{_i18n.t('删除这些文件')}</button>
                            </div>
                        </div>
                    );
                });
            });
        },
        gamePath,
        modsPath: gamePath + '/Mods',
    };

    useEffect(() => {
        if (!gamePath) return;

        let cancelled = false;
        let popup: ReturnType<typeof createPopup> | undefined;
        const timer = window.setTimeout(() => {
            if (cancelled) return;
            popup = createPopup(
                () => (
                    <div className="loading-popup">
                        <ProgressIndicator infinite />
                        <span>{_i18n.t('正在加载 Mod 列表，请稍等')}</span>
                    </div>
                ),
                { cancelable: false },
            );
            ctx.reloadMods()
                .then(() => {
                    popup?.hide();
                    if (!cancelled) ctx.checkInvalidZipMods();
                })
                .catch((error) => {
                    popup?.hide();
                    if (cancelled) return;
                    const errorPopup = createPopup(() => (
                        <div className="popup-content">
                            <div className="title">{_i18n.t('加载 Mod 列表失败')}</div>
                            <div className="content">
                                <p>{_i18n.t('请检查游戏路径是否正确，或网络连接是否正常')}</p>
                                <p>{_i18n.t('部分功能将不可用')}</p>
                                <p>{String(error)}</p>
                            </div>
                            <div className="buttons">
                                <button onClick={() => errorPopup.hide()}>{_i18n.t('确定')}</button>
                            </div>
                        </div>
                    ));
                });
        }, 10);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            popup?.hide();
        };
    }, [gamePath]);

    return ctx;
};
