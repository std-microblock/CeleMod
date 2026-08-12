import { create } from "zustand";
import { findInstalledCrashModFix } from "../api/crashModFix";
import type { CrashModFix } from "../api/updateInfo";
import {
  reloadInstalledMods,
  useCurrentEverestUltra,
  useCurrentEverestVersion,
  useGamePath,
} from "../states";
import { callRemote } from "../utils";

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
    (state) => state.setEverestInstallState,
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
        },
      );
    },
    downloadAndInstallEverest(
      url: string,
      postInstallFixes: CrashModFix[] = [],
    ) {
      if (useEverestInstallState.getState().everestInstallState.installingUrl)
        return;

      setEverestInstallState({
        installingUrl: url,
        status: "[1/3] Download Everest",
        progress: null,
        failedReason: null,
      });
      let applyingPostInstallFix = false;
      callRemote(
        "download_and_install_everest",
        gamePath,
        url,
        (status: string, data: unknown) => {
          if (
            status === "Success" &&
            postInstallFixes.length > 0 &&
            !applyingPostInstallFix
          ) {
            applyingPostInstallFix = true;
            void (async () => {
              const installedMods = await reloadInstalledMods(gamePath);
              const fix = findInstalledCrashModFix(
                postInstallFixes,
                installedMods,
              );

              if (fix) {
                setEverestInstallState({
                  installingUrl: url,
                  status: `[4/4] download ${fix.mod_name} fix`,
                  progress: null,
                  failedReason: null,
                });
                await new Promise<void>((resolve, reject) => {
                  callRemote(
                    "download_and_install_crash_mod_fix",
                    gamePath,
                    fix.mod_name,
                    JSON.stringify(fix.affected_versions),
                    fix.fixed_version,
                    fix.url,
                    fix.sha256,
                    (fixStatus: string, fixData: unknown) => {
                      if (fixStatus === "Failed") {
                        reject(new Error(String(fixData)));
                        return;
                      }
                      if (fixStatus === "Success") {
                        resolve();
                        return;
                      }
                      setEverestInstallState({
                        installingUrl: url,
                        status: `[4/4] ${fixStatus} ${fix.mod_name} fix`,
                        progress: typeof fixData === "number" ? fixData : null,
                        failedReason: null,
                      });
                    },
                  ).catch(reject);
                });
                try {
                  await reloadInstalledMods(gamePath);
                } catch (error) {
                  console.error("Failed to refresh Mods after repair", error);
                }
              }

              setEverestInstallState({
                installingUrl: url,
                status: "Success",
                progress: 100,
                failedReason: null,
              });
              ctx.updateEverestVersion();
            })().catch((error) => {
              setEverestInstallState({
                installingUrl: url,
                status: "Failed",
                progress: null,
                failedReason: String(error),
              });
            });
            return;
          }

          const current = useEverestInstallState.getState().everestInstallState;
          setEverestInstallState({
            ...current,
            status,
            progress: typeof data === "number" ? data : current.progress,
            failedReason: status === "Failed" ? String(data) : null,
          });
          if (status === "Success") ctx.updateEverestVersion();
        },
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
