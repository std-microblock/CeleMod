import { initAlwaysOnMods, useAlwaysOnMods, useCurrentBlacklistProfile, useGamePath } from "src/states";
import { callRemote } from "src/utils";

export const createBlacklistContext = () => {
    const {
        profiles,
        setProfilesCallback,
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
    }

    return ctx;
}