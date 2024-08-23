import { create } from 'zustand'
import { ModBlacklistProfile } from './ipc/blacklist';
import { useEffect } from 'react';
import { callRemote } from './utils';

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

declare global {
    var configStorage: any;
    var storage: any;
    var env: any;
    var sys: any;
}

export const useStorage = () => {
    if (!window.configStorage) {
        let path = './cele-mod.db';
        const exists = (path)=>{
            try {
                sys.fs.statSync(path);
                return true;
            } catch (e) {
                return false;
            }
        }
        if (exists('../../cele-mod.db')) {
            path = '../../cele-mod.db';
        }

        console.log('useStorage', path)
        window.configStorage = storage.open(path);

        window.addEventListener('beforeunload', () => {
            configStorage.close();
        });
    }

    return { storage: configStorage, save: () => configStorage.commit() }
};

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
    currentLang: '',
    setCurrentLang: (currentLang: string) => set({ currentLang })
}));

interface _Storage {
    root: any
}

function createPersistedState<T>(initial: T, get: (storage: _Storage) => T, set: (storage: _Storage, data: T, save: () => void) => void) {
    const useTheState = create<{
        value: T,
        set: (value: T) => void
    }>(set => ({
        value: initial,
        set(value) {
            set({ value })
        },
    }));

    let refValue = initial;

    return [() => {
        const { value, set: setData } = useTheState();

        const { storage, save } = useStorage();

        useEffect(() => {
            if (!storage) return;
            const data = get(storage);
            refValue = data;
            if(data !== undefined && data !== null) {
                setData(data)
            }
        }, [storage])
    }, (() => {
        const { value, set: setData } = useTheState();
        const { storage, save } = useStorage();
        return [value, (data) => {
            refValue = data;
            setData(data)
            if (storage)
                set(storage, data, save)
            else setTimeout(() => {
                if (storage)
                    set(storage, data, save)
            }, 10)
        }]
    }), () => refValue] as [() => void, () => ([T, (data: T) => void]), () => T]
}

const createPersistedStateByKey = <T>(key: string, defaultValue: T) => createPersistedState<T>(defaultValue, storage => storage.root?.[key] ?? defaultValue, (storage, data, save) => {
    storage.root ??= {};
    storage.root[key] = data;
    save()
})

export const [initMirror, useMirror, currentMirror] = createPersistedStateByKey('mirror', 'wegfan')
export const [initGamePath, useGamePath] = createPersistedState<string>('', storage => {
    if (storage?.root?.lastGamePath)
        return storage.root.lastGamePath
    const paths = callRemote("get_celeste_dirs").split("\n").filter((v: string | null) => v);
    return paths[0]
}, (storage, data, save) => {
    storage.root.lastGamePath = data
    save()
})

export const [initUseMultiThread, useUseMultiThread] = createPersistedStateByKey('useMultiThread', false)

export const [initAlwaysOnMods, useAlwaysOnMods] = createPersistedStateByKey('alwaysOnMods', [])

export const [initSearchSort, useSearchSort] = createPersistedStateByKey<'new' | 'updateAdded' | 'updated' | 'views' | 'likes'>('searchSort', 'likes')