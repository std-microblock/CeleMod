import { callRemote } from "../utils";
import { useInstalledMods, useGamePath, useStorage, initGamePath } from "../states";
import { useEffect, useMemo } from "preact/hooks";

export const createModManageContext = () => {
    const { setInstalledMods } = useInstalledMods();
    const [ gamePath, setGamePath ] = useGamePath();

    const { storage, save } = useStorage();


    initGamePath()

    useEffect(() => {
        if (!gamePath) return;
        if (!storage) return;

        storage.root ??= {};
        storage.root.lastGamePath = gamePath;
        console.log('saving game path', gamePath)
        save();
    }, [gamePath, storage]);

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