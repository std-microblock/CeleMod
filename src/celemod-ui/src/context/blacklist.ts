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
  const {
    setProfiles,
    setCurrentProfileName,
    setCurrentProfile,
    setActiveProfileNames,
  } = useCurrentBlacklistProfile();

  initAlwaysOnMods();
  const [alwaysOnMods] = useAlwaysOnMods();
  const [gamePath] = useGamePath();

  const ctx = {
    switchProfile: async (name: string) => {
      const result = await callRemote<string>(
        "apply_mod_profiles",
        gamePath,
        JSON.stringify([name]),
        JSON.stringify(alwaysOnMods)
      );
      if (result !== "Success") throw new Error(result);
      await reloadBlacklistState(gamePath);
    },
    setActiveProfiles: async (names: string[]) => {
      const result = await callRemote<string>(
        "apply_mod_profiles",
        gamePath,
        JSON.stringify(names),
        JSON.stringify(alwaysOnMods)
      );
      if (result !== "Success") throw new Error(result);
      setActiveProfileNames(names);
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
          enabled_mods: [],
        };
        const names = new Set(effectiveMods.map((mod) => mod.name));
        const nextProfile = {
          ...directProfile,
          enabled_mods: enabled
            ? [...new Set([...directProfile.enabled_mods, ...names])]
            : directProfile.enabled_mods.filter((name) => !names.has(name)),
        };
        setCurrentProfileName(nextProfile.name);
        setCurrentProfile(nextProfile);
        setProfiles([nextProfile]);
        return;
      }

      const targetProfile =
        state.profiles.find(
          (profile) => profile.name === state.currentProfileName
        ) ?? state.profiles[0];
      if (!targetProfile) throw new Error("No CeleMod Profile is available");
      const result = await callRemote<string>(
        "switch_mod_profile_mods",
        targetGamePath,
        targetProfile.name,
        JSON.stringify(effectiveMods.map((mod) => mod.name)),
        enabled
      );
      if (result !== "Success") throw new Error(result);

      const activeNames = state.activeProfileNames.length
        ? state.activeProfileNames
        : [targetProfile.name];
      const applyResult = await callRemote<string>(
        "apply_mod_profiles",
        targetGamePath,
        JSON.stringify(activeNames),
        JSON.stringify(targetAlwaysOnMods)
      );
      if (applyResult !== "Success") throw new Error(applyResult);
      await reloadBlacklistState(targetGamePath);
    },
  };

  return ctx;
}
