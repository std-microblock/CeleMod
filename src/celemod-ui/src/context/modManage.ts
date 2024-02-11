import { callRemote } from "../utils";
import { useInstalledMods, useGamePath, useStorage } from "../states";
import { useEffect, useMemo } from "preact/hooks";

export const useModManageContext = () => {
    const { setInstalledMods } = useInstalledMods();
    const { gamePath, setGamePath } = useGamePath();

    const { storage, save } = useStorage();


    useEffect(() => {
        if (!gamePath) return;
        if (!storage) return;

        storage.root ??= {};
        storage.root.lastGamePath = gamePath;
        console.log('saving game path', gamePath)
        save();
    }, [gamePath, storage]);

    useEffect(() => {
        if (storage?.root?.lastGamePath && callRemote('verify_celeste_install', storage.root.lastGamePath))
            setGamePath(storage.root.lastGamePath);
        else {
            const paths = callRemote("get_celeste_dirs").split("\n").filter((v: string | null) => v);
            if (paths.length > 0)
                setGamePath(paths[0]);
        }
    }, [storage]);

    const ctx = {
        reloadMods: () => {
            callRemote('get_installed_mods', gamePath + '/Mods', (data: string) => {
                setInstalledMods(JSON.parse(data));
            });
        },
        gamePath,
        modsPath: gamePath + '/Mods'
    };

    useEffect(() => {
        ctx.reloadMods();
    }, [gamePath])
    return ctx
}