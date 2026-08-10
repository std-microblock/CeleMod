import { callRemote } from "../utils";
import {
  useGamePath,
  useCurrentEverestUltra,
  useCurrentEverestVersion,
} from "../states";
import { useEffect } from "react";
import { create } from "zustand";

export interface EverestInstallState {
  installingUrl: string | null;
  status: string | null;
  progress: number | null;
  failedReason: string | null;
}

const initialEverestInstallState: EverestInstallState = {
  installingUrl: null,
  status: null,
  progress: null,
  failedReason: null,
};

export const useEverestInstallState = create<{
  everestInstallState: EverestInstallState;
  setEverestInstallState: (everestInstallState: EverestInstallState) => void;
}>((set) => ({
  everestInstallState: initialEverestInstallState,
  setEverestInstallState: (everestInstallState: EverestInstallState) =>
    set({ everestInstallState }),
}));

let lastGamePath = "";
export const useEverestCtx = () => {
  const { setCurrentEverestVersion } = useCurrentEverestVersion();
  const { setCurrentEverestIsUltra } = useCurrentEverestUltra();
  const [gamePath] = useGamePath();
  const setEverestInstallState = useEverestInstallState(
    (state) => state.setEverestInstallState
  );

  const ctx = {
    updateEverestVersion() {
      callRemote(
        "get_everest_version",
        gamePath,
        (ver: string, isUltra: boolean) => {
          console.log("Everest version", ver, isUltra ? "Ultra" : "Official");
          setCurrentEverestVersion(ver);
          setCurrentEverestIsUltra(isUltra);
        }
      );
    },
    downloadAndInstallEverest(url: string) {
      if (useEverestInstallState.getState().everestInstallState.installingUrl)
        return;

      setEverestInstallState({
        installingUrl: url,
        status: "[1/3] Download Everest",
        progress: null,
        failedReason: null,
      });
      callRemote(
        "download_and_install_everest",
        gamePath,
        url,
        (status: string, data: unknown) => {
          const current =
            useEverestInstallState.getState().everestInstallState;
          setEverestInstallState({
            ...current,
            status,
            progress:
              typeof data === "number" ? data : current.progress,
            failedReason: status === "Failed" ? String(data) : null,
          });
          if (status === "Success") ctx.updateEverestVersion();
        }
      ).catch((error) => {
        const current = useEverestInstallState.getState().everestInstallState;
        setEverestInstallState({
          ...current,
          status: "Failed",
          failedReason: String(error),
        });
      });
    },
    clearInstallState() {
      setEverestInstallState(initialEverestInstallState);
    },
  };

  if (lastGamePath !== gamePath) {
    lastGamePath = gamePath;

    if (gamePath) {
      ctx.updateEverestVersion();
    }
  }

  return ctx;
};
