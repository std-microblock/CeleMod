import { create } from "zustand";
import { FIXTURE_GAME_PATH, fixtureAnalysis } from "./fixture";

// Offline stand-ins for everything the crash assistant pulls in: no Tauri IPC,
// no network and no game files are touched by this fixture.
export const useAppStore = create<any>((set) => ({
  currentLang: "zh-CN",
  setCurrentLang: (currentLang: string) => set({ currentLang }),
}));

export const useCurrentLang = () => ({
  currentLang: "zh-CN",
  setCurrentLang: () => {},
});

export const useMirror = () => ["", () => {}];

export const useGamePath = () => [FIXTURE_GAME_PATH];

export const useGlobalContext = () => ({
  blacklist: { setModsEnabled: async () => {} },
});

export const useDownloadStore = create<any>(() => ({ downloadMod: () => {} }));

export const getLatestUpdateInfo = async () => ({
  crash_mod_fixes: [],
  everest_ultra: { versions: [] },
});

export const findCrashModFix = () => null;

export const fetch = async () => {
  throw new Error("crash assistant fixture has no network access");
};

export const callRemote = async (command: string, ...args: unknown[]) => {
  if (command === "check_everest_crash") return fixtureAnalysis;
  if (command === "get_mod_latest_info") {
    const callback = args.find(
      (item): item is (data: string) => void => typeof item === "function",
    );
    callback?.("[]");
    return undefined;
  }
  return undefined;
};
