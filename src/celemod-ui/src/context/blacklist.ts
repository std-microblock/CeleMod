import { initAlwaysOnMods, useAlwaysOnMods, useAppStore, useCurrentBlacklistProfile, useGamePath } from "src/states";
import { callRemote } from "src/utils";

export const createBlacklistContext = () => {
    const {
        profiles,
        setProfiles,
        currentProfileName,
        setCurrentProfileName,
        currentProfile,
        setCurrentProfile,
    } = useCurrentBlacklistProfile();

    initAlwaysOnMods();
    const [alwaysOnMods, setAlwaysOnMods] = useAlwaysOnMods();
    const [gamePath] = useGamePath();

    const ctx = {
        switchProfile: (name: string) => {
            console.log('switch to profile', name);
            callRemote('apply_blacklist_profile', gamePath, name, JSON.stringify(alwaysOnMods));
            setCurrentProfileName(name);
            setCurrentProfile(profiles.find(p => p.name === name) || profiles[0]);
        },
        setModsEnabled: async (mods: { name: string; file: string }[], enabled: boolean) => {
            if (mods.length === 0) return;
            const state = useAppStore.getState();
            const targetGamePath = state.gamePath || gamePath;
            const targetAlwaysOnMods = state.alwaysOnMods;
            let targetProfileName = state.currentProfileName;
            if (!targetProfileName) {
                targetProfileName = await callRemote<string>('get_current_profile', targetGamePath);
            }
            let targetProfiles = state.profiles;
            let targetProfile = targetProfiles.find((profile) => profile.name === targetProfileName) || null;
            if (!targetProfile) {
                targetProfiles = await new Promise<typeof state.profiles>((resolve, reject) => {
                    callRemote('get_blacklist_profiles', targetGamePath, (data: string) => {
                        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
                    }).catch(reject);
                });
                targetProfile = targetProfiles.find((profile) => profile.name === targetProfileName)
                    || targetProfiles[0]
                    || null;
            }
            if (!targetProfile) throw new Error('No CeleMod Profile is available');

            const effectiveMods = enabled
                ? mods
                : mods.filter((mod) => !targetAlwaysOnMods.includes(mod.name));
            if (effectiveMods.length === 0) return;

            const result = await callRemote<string>(
                'switch_mod_blacklist_profile',
                targetGamePath,
                targetProfile.name,
                JSON.stringify(effectiveMods.map((mod) => mod.name)),
                JSON.stringify(effectiveMods.map((mod) => mod.file)),
                enabled,
            );
            if (result !== 'Success') throw new Error(result);

            const applyResult = await callRemote<string>(
                'apply_blacklist_profile',
                targetGamePath,
                targetProfile.name,
                JSON.stringify(targetAlwaysOnMods),
            );
            if (applyResult !== 'Success') throw new Error(applyResult);

            let nextMods = targetProfile.mods;
            if (enabled) {
                const names = new Set(effectiveMods.map((mod) => mod.name));
                nextMods = nextMods.filter((mod) => !names.has(mod.name));
            } else {
                const additions = effectiveMods.filter(
                    (mod) => !nextMods.some((current) => current.name === mod.name),
                );
                nextMods = [...nextMods, ...additions];
            }
            const nextProfile = { ...targetProfile, mods: nextMods };
            setCurrentProfileName(targetProfile.name);
            setCurrentProfile(nextProfile);
            setProfiles(targetProfiles.map(
                (profile) => profile.name === targetProfile.name ? nextProfile : profile,
            ));
        },
    }

    return ctx;
}
