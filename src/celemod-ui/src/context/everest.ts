import { callRemote } from "../utils";
import { useInstalledMods, useGamePath, useCurrentEverestVersion } from "../states";
import { useEffect } from "preact/hooks";
import { create } from "zustand";

export interface EverestInstallState {
    status: string,
    progress: number
}

export const useEverestInstallState =
    create<{
        everestInstallState: EverestInstallState,
        setEverestInstallState: (everestInstallState: EverestInstallState) => void
    }>((set) => ({
        everestInstallState: {
            status: "",
            progress: 0
        },
        setEverestInstallState: (everestInstallState: EverestInstallState) => set({ everestInstallState })
    }));

let lastGamePath
export const useEverestCtx = () => {
    const { currentEverestVersion, setCurrentEverestVersion } = useCurrentEverestVersion();
    const [gamePath] = useGamePath();
    const { everestInstallState, setEverestInstallState } = useEverestInstallState();

    const ctx = {
        updateEverestVersion() {
            callRemote("get_everest_version", gamePath, (ver: string) => {
                console.log("Everest version", ver);
                setCurrentEverestVersion(ver);
            });
        },
        downloadAndInstallEverest(url: string) {
            if (everestInstallState.status !== "") return;

            setEverestInstallState({ status: "Downloading Everest", progress: 0 });
            callRemote("download_and_install_everest", gamePath, url, (status: string, progress: number) => {
                setEverestInstallState({ status, progress });
            });
        }
    }

    if (lastGamePath !== gamePath) {
        lastGamePath = gamePath;

        if (gamePath) {
            ctx.updateEverestVersion();
        }
    }

    return ctx;

}