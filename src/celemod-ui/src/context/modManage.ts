import { callRemote } from "../utils";
import { useInstalledMods, useGamePath } from "../states";
import { useEffect, useMemo } from "preact/hooks";

export const useModManageContext = () => {
    const { setInstalledMods } = useInstalledMods();
    const { gamePath, setGamePath } = useGamePath();
    useEffect(() => {
        const paths = callRemote("get_celeste_dirs").split("\n").filter((v: string | null) => v);
        if (paths.length > 0)
            setGamePath(paths[0]);
    }, []);

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