import { create } from 'zustand'
import { ModBlacklistProfile } from './ipc/blacklist';

export const useGamePath = create<{
    gamePath: string,
    setGamePath: (gamePath: string) => void
}>((set) => ({
    gamePath: "",
    setGamePath: (gamePath: string) => set({ gamePath })
}));

export const useDownloadSettings = create<{
    useCNMirror: boolean,
    setUseCNMirror: (useCNMirror: boolean) => void
}>((set) => ({
    useCNMirror: true,
    setUseCNMirror: (useCNMirror: boolean) => set({ useCNMirror })
}));

export const useCurrentBlacklistProfile = create<{
    currentProfileName: string,
    setCurrentProfileName: (currentProfileName: string) => void,
    profiles: ModBlacklistProfile[],
    setProfiles: (profiles: ModBlacklistProfile[]) => void,
    setProfilesCallback: (setter: (profiles: ModBlacklistProfile[]) => ModBlacklistProfile[]) => void,
    currentProfile: ModBlacklistProfile | null,
    setCurrentProfile: (currentProfile: ModBlacklistProfile | null) => void
}>((set) => ({
    currentProfileName: "",
    setCurrentProfileName: (currentProfileName: string) => set({ currentProfileName }),
    profiles: [],
    setProfiles: (profiles: ModBlacklistProfile[]) => set({ profiles }),
    currentProfile: null,
    setCurrentProfile: (currentProfile: ModBlacklistProfile | null) => set({ currentProfile }),
    setProfilesCallback: (setter: (profiles: ModBlacklistProfile[]) => ModBlacklistProfile[]) => set(states => {
        const newProfiles = setter(states.profiles);
        return { profiles: newProfiles }
    })
}));

export const useStorage = create<{
    storage: any,
    _setStorage: (storage: any) => void,
    _setSaveHandler: (handler: () => void) => void,
    save: () => void
}>((set) => ({
    storage: null,
    _setStorage: (storage: any) => set({ storage }),
    _setSaveHandler: (handler: () => void) => set({ save: handler }),
    save: () => { }
}));

export interface BackendDep {
    name: string,
    version: string,
    optional: boolean,
}

export interface BackendModInfo {
    game_banana_id: string,
    name: string,
    deps: BackendDep[],
    version: string,
    file: string,
}

export const useInstalledMods = create<{
    installedMods: BackendModInfo[],
    setInstalledMods: (installedMods: BackendModInfo[]) => void
}>((set) => ({
    installedMods: [],
    setInstalledMods: (installedMods: BackendModInfo[]) => set({ installedMods })
}));

export const useCurrentEverestVersion = create<{
    currentEverestVersion: string,
    setCurrentEverestVersion: (currentEverestVersion: string) => void
}>((set) => ({
    currentEverestVersion: "",
    setCurrentEverestVersion: (currentEverestVersion: string) => set({ currentEverestVersion })
}));

export const useCurrentLang = create<{
    currentLang: string,
    setCurrentLang: (currentLang: string) => void
}>((set) => ({
    currentLang: "",
    setCurrentLang: (currentLang: string) => set({ currentLang })
}));