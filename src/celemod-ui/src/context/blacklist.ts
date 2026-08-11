import {
  initAlwaysOnMods,
  reloadBlacklistState,
  useAlwaysOnMods,
  useAppStore,
  useCurrentBlacklistProfile,
  useGamePath,
} from "src/states";
import { callRemote } from "src/utils";

export const createBlacklistContext = () => {
  const { setProfiles, setCurrentProfileName, setCurrentProfile } =
    useCurrentBlacklistProfile();

  initAlwaysOnMods();
  const [alwaysOnMods] = useAlwaysOnMods();
  const [gamePath] = useGamePath();

  const ctx = {
    switchProfile: async (name: string) => {
      console.log("switch to profile", name);
      const result = await callRemote<string>(
        "apply_blacklist_profile",
        gamePath,
        name,
        JSON.stringify(alwaysOnMods)
      );
      if (result !== "Success") throw new Error(result);
      await reloadBlacklistState(gamePath);
    },
    setModsEnabled: async (
      mods: { name: string; file: string }[],
      enabled: boolean
    ) => {
      if (mods.length === 0) return;
      const state = useAppStore.getState();
      const targetGamePath = state.gamePath || gamePath;
      const targetAlwaysOnMods = state.alwaysOnMods;
      const effectiveMods = enabled
        ? mods
        : mods.filter((mod) => !targetAlwaysOnMods.includes(mod.name));
      if (effectiveMods.length === 0) return;

      if (!state.profileEnabled) {
        const result = await callRemote<string>(
          "switch_direct_blacklist",
          targetGamePath,
          JSON.stringify(effectiveMods.map((mod) => mod.file)),
          enabled
        );
        if (result !== "Success") throw new Error(result);
        const directProfile = state.currentProfile ?? {
          name: "blacklist.txt",
          mods: [],
          mod_options_order: [],
        };
        const files = new Set(effectiveMods.map((mod) => mod.file));
        const names = new Set(effectiveMods.map((mod) => mod.name));
        const nextMods = enabled
          ? directProfile.mods.filter(
              (mod) => !files.has(mod.file) && !names.has(mod.name)
            )
          : [
              ...directProfile.mods,
              ...effectiveMods.filter(
                (mod) =>
                  !directProfile.mods.some(
                    (current) =>
                      current.file === mod.file || current.name === mod.name
                  )
              ),
            ];
        const nextProfile = { ...directProfile, mods: nextMods };
        setCurrentProfileName(nextProfile.name);
        setCurrentProfile(nextProfile);
        setProfiles([nextProfile]);
        return;
      }

      let targetProfileName = state.currentProfileName;
      if (!targetProfileName) {
        targetProfileName = await callRemote<string>(
          "get_current_profile",
          targetGamePath
        );
      }
      let targetProfiles = state.profiles;
      let targetProfile =
        targetProfiles.find((profile) => profile.name === targetProfileName) ||
        null;
      if (!targetProfile) {
        targetProfiles = await new Promise<typeof state.profiles>(
          (resolve, reject) => {
            callRemote(
              "get_blacklist_profiles",
              targetGamePath,
              (data: string) => {
                try {
                  resolve(JSON.parse(data));
                } catch (error) {
                  reject(error);
                }
              }
            ).catch(reject);
          }
        );
        targetProfile =
          targetProfiles.find(
            (profile) => profile.name === targetProfileName
          ) ||
          targetProfiles[0] ||
          null;
      }
      if (!targetProfile) throw new Error("No CeleMod Profile is available");


      const result = await callRemote<string>(
        "switch_mod_blacklist_profile",
        targetGamePath,
        targetProfile.name,
        JSON.stringify(effectiveMods.map((mod) => mod.name)),
        JSON.stringify(effectiveMods.map((mod) => mod.file)),
        enabled
      );
      if (result !== "Success") throw new Error(result);

      const applyResult = await callRemote<string>(
        "apply_blacklist_profile",
        targetGamePath,
        targetProfile.name,
        JSON.stringify(targetAlwaysOnMods)
      );
      if (applyResult !== "Success") throw new Error(applyResult);

      await reloadBlacklistState(targetGamePath);
    },
  };

  return ctx;
};
