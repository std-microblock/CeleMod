import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { immer } from 'zustand/middleware/immer';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ModBlacklistProfile } from './ipc/blacklist';
import { callRemote } from './utils';

export interface BackendDep {
  name: string;
  version: string;
  optional: boolean;
}

export interface BackendModInfo {
  game_banana_id: number;
  name: string;
  deps: BackendDep[];
  version: string;
  file: string;
  size: number;
}

type SearchSort = 'new' | 'updateAdded' | 'updated' | 'views' | 'likes';

export const MOD_TYPE_OPTIONS = [
  'Maps', 'Skins', 'Helpers', 'Other/Misc', 'Assets', 'UI', 'Mechanics',
  'Dialog', 'Lönn Plugin', 'Effects', 'Ahorn Plugin', 'Twitch Integration',
  'Mod Installer',
] as const;

export type ModTypeName = typeof MOD_TYPE_OPTIONS[number];

const createDownloadTypeDefaults = (enabled: boolean): Record<string, boolean> =>
  Object.fromEntries(MOD_TYPE_OPTIONS.map((type) => [type, enabled]));

interface AppState {
  currentProfileName: string;
  profiles: ModBlacklistProfile[];
  currentProfile: ModBlacklistProfile | null;
  installedMods: BackendModInfo[];
  currentEverestVersion: string;
  currentLang: string;
  mirror: string;
  gamePath: string;
  useMultiThread: boolean;
  alwaysOnMods: string[];
  searchSort: SearchSort;
  autoDisableNewMods: boolean;
  downloadDefaultEnabled: boolean;
  downloadTypeDefaults: Record<string, boolean>;
  checkOptionalDep: boolean;
  excludeDependents: boolean;
  fullTree: boolean;
  showUpdate: boolean;
  showDetailed: boolean;
  autoToggleDependencies: boolean;
  autoToggleOptionalDependencies: boolean;
  deleteOrphansByDefault: boolean;
  hiddenModTypes: string[];
  modCacheTtlHours: number;
  modComments: Record<string, string>;
  enableAcrylic: boolean;
  lastUseMap: Record<string, number>;
  page: string;
  downloadMenuOpen: boolean;
  setCurrentProfileName: (value: string) => void;
  setProfiles: (value: ModBlacklistProfile[]) => void;
  setProfilesCallback: (setter: (profiles: ModBlacklistProfile[]) => ModBlacklistProfile[]) => void;
  setCurrentProfile: (value: ModBlacklistProfile | null) => void;
  setInstalledMods: (value: BackendModInfo[]) => void;
  setCurrentEverestVersion: (value: string) => void;
  setCurrentLang: (value: string) => void;
  setMirror: (value: string) => void;
  setGamePath: (value: string) => void;
  setUseMultiThread: (value: boolean) => void;
  setAlwaysOnMods: (value: string[]) => void;
  setSearchSort: (value: SearchSort) => void;
  setAutoDisableNewMods: (value: boolean) => void;
  setDownloadDefaultsAll: (enabled: boolean) => void;
  setDownloadTypeDefault: (type: string, enabled: boolean) => void;
  setCheckOptionalDep: (value: boolean) => void;
  setExcludeDependents: (value: boolean) => void;
  setFullTree: (value: boolean) => void;
  setShowUpdate: (value: boolean) => void;
  setShowDetailed: (value: boolean) => void;
  setAutoToggleDependencies: (value: boolean) => void;
  setAutoToggleOptionalDependencies: (value: boolean) => void;
  setDeleteOrphansByDefault: (value: boolean) => void;
  setHiddenModTypes: (value: string[]) => void;
  setModCacheTtlHours: (value: number) => void;
  setModComments: (value: Record<string, string>) => void;
  setEnableAcrylic: (value: boolean) => void;
  setLastUseMap: (value: Record<string, number>) => void;
  setPage: (value: string) => void;
  setDownloadMenuOpen: (value: boolean) => void;
}

const AUTO_DISABLE_NEW_MODS_STORAGE_KEY = 'celemod-auto-disable-new-mods';

const loadAutoDisableNewMods = () => {
  try {
    return localStorage.getItem(AUTO_DISABLE_NEW_MODS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const saveAutoDisableNewMods = (value: boolean) => {
  try {
    localStorage.setItem(AUTO_DISABLE_NEW_MODS_STORAGE_KEY, String(value));
  } catch (error) {
    console.error('Failed to persist auto-disable preference', error);
  }
};

const setters = {
  setCurrentProfileName: 'currentProfileName', setProfiles: 'profiles',
  setCurrentProfile: 'currentProfile', setInstalledMods: 'installedMods',
  setCurrentEverestVersion: 'currentEverestVersion', setCurrentLang: 'currentLang',
  setMirror: 'mirror', setGamePath: 'gamePath', setUseMultiThread: 'useMultiThread',
  setAlwaysOnMods: 'alwaysOnMods', setSearchSort: 'searchSort',
  setCheckOptionalDep: 'checkOptionalDep',
  setExcludeDependents: 'excludeDependents', setFullTree: 'fullTree',
  setShowUpdate: 'showUpdate', setShowDetailed: 'showDetailed',
  setAutoToggleDependencies: 'autoToggleDependencies',
  setAutoToggleOptionalDependencies: 'autoToggleOptionalDependencies',
  setDeleteOrphansByDefault: 'deleteOrphansByDefault',
  setHiddenModTypes: 'hiddenModTypes', setModCacheTtlHours: 'modCacheTtlHours',
  setModComments: 'modComments', setEnableAcrylic: 'enableAcrylic',
  setLastUseMap: 'lastUseMap', setPage: 'page', setDownloadMenuOpen: 'downloadMenuOpen',
} as const;

export const useAppStore = create<AppState>()(
  persist(
    immer((set) => {
      const actions = Object.fromEntries(
        Object.entries(setters).map(([action, key]) => [action, (value: unknown) => set((state) => {
          (state as unknown as Record<string, unknown>)[key] = value;
        })]),
      ) as unknown as Pick<AppState, keyof typeof setters>;
      return {
        currentProfileName: '', profiles: [], currentProfile: null, installedMods: [],
        currentEverestVersion: '', currentLang: '', mirror: 'wegfan', gamePath: '',
        useMultiThread: false, alwaysOnMods: [], searchSort: 'likes',
        autoDisableNewMods: loadAutoDisableNewMods(),
        downloadDefaultEnabled: !loadAutoDisableNewMods(),
        downloadTypeDefaults: createDownloadTypeDefaults(!loadAutoDisableNewMods()),
        checkOptionalDep: false, excludeDependents: true,
        fullTree: false, showUpdate: true, showDetailed: false, modComments: {},
        autoToggleDependencies: true, autoToggleOptionalDependencies: false,
        deleteOrphansByDefault: true, hiddenModTypes: [], modCacheTtlHours: 24,
        enableAcrylic: true, lastUseMap: {}, page: 'Home', downloadMenuOpen: false,
        ...actions,
        setAutoDisableNewMods: (value) => {
          set((state) => {
            state.autoDisableNewMods = value;
            state.downloadDefaultEnabled = !value;
            state.downloadTypeDefaults = createDownloadTypeDefaults(!value);
          });
          saveAutoDisableNewMods(value);
        },
        setDownloadDefaultsAll: (enabled) => {
          set((state) => {
            state.autoDisableNewMods = !enabled;
            state.downloadDefaultEnabled = enabled;
            state.downloadTypeDefaults = createDownloadTypeDefaults(enabled);
          });
          saveAutoDisableNewMods(!enabled);
        },
        setDownloadTypeDefault: (type, enabled) => set((state) => {
          state.downloadTypeDefaults[type] = enabled;
        }),
        setProfilesCallback: (setter) => set((state) => {
          state.profiles = setter(state.profiles);
        }),
      };
    }),
    {
      name: 'celemod-preferences',
      storage: createJSONStorage(() => localStorage),
      partialize: ({
        mirror, gamePath, useMultiThread, alwaysOnMods, searchSort,
        autoDisableNewMods, downloadDefaultEnabled, downloadTypeDefaults,
        checkOptionalDep, excludeDependents, fullTree, showUpdate, showDetailed,
        autoToggleDependencies, autoToggleOptionalDependencies, deleteOrphansByDefault,
        hiddenModTypes, modCacheTtlHours, modComments, enableAcrylic, currentLang, lastUseMap,
      }) => ({
        mirror, gamePath, useMultiThread, alwaysOnMods, searchSort,
        autoDisableNewMods, downloadDefaultEnabled, downloadTypeDefaults,
        checkOptionalDep, excludeDependents, fullTree, showUpdate, showDetailed,
        autoToggleDependencies, autoToggleOptionalDependencies, deleteOrphansByDefault,
        hiddenModTypes, modCacheTtlHours, modComments, enableAcrylic, currentLang, lastUseMap,
      }),
    },
  ),
);

let initialized = false;
export async function initializeAppStore() {
  if (initialized) return;
  initialized = true;
  const state = useAppStore.getState();
  try {
    await callRemote('configure_mod_cache', Math.max(0, state.modCacheTtlHours) * 60 * 60);
    let gamePath = state.gamePath;
    if (state.gamePath) {
      gamePath = await callRemote<string>('normalize_game_path', state.gamePath);
      state.setGamePath(gamePath);
    } else {
      const paths = (await callRemote<string>('get_celeste_dirs')).split('\n').filter(Boolean);
      if (paths[0]) {
        gamePath = paths[0];
        state.setGamePath(gamePath);
      }
    }
    if (gamePath) {
      await callRemote('cleanup_mod_download_temp_files', gamePath);
    }
  } catch (error) {
    console.error('Failed to initialize application state', error);
  }
}

const objectHook = <K extends keyof AppState>(keys: readonly K[]) => () =>
  useAppStore(useShallow((state) => Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<AppState, K>));

export const useCurrentBlacklistProfile = objectHook([
  'currentProfileName', 'setCurrentProfileName', 'profiles', 'setProfiles',
  'setProfilesCallback', 'currentProfile', 'setCurrentProfile',
] as const);
export const useInstalledMods = objectHook(['installedMods', 'setInstalledMods'] as const);
export const useCurrentEverestVersion = objectHook(['currentEverestVersion', 'setCurrentEverestVersion'] as const);
export const useCurrentLang = objectHook(['currentLang', 'setCurrentLang'] as const);
export const useEnableAcrylic = objectHook(['enableAcrylic', 'setEnableAcrylic'] as const);

function tupleHook<K extends keyof AppState, S extends keyof AppState>(value: K, setter: S) {
  return () => useAppStore(useShallow((state) => [state[value], state[setter]] as [AppState[K], AppState[S]]));
}

export const useMirror = tupleHook('mirror', 'setMirror') as () => [string, (value: string) => void];
export const useGamePath = tupleHook('gamePath', 'setGamePath') as () => [string, (value: string) => void];
export const useUseMultiThread = tupleHook('useMultiThread', 'setUseMultiThread') as () => [boolean, (value: boolean) => void];
export const useAlwaysOnMods = tupleHook('alwaysOnMods', 'setAlwaysOnMods') as () => [string[], (value: string[]) => void];
export const useSearchSort = tupleHook('searchSort', 'setSearchSort') as () => [SearchSort, (value: SearchSort) => void];
export const useAutoDisableNewMods = tupleHook('autoDisableNewMods', 'setAutoDisableNewMods') as () => [boolean, (value: boolean) => void];
export const useCheckOptionalDep = tupleHook('checkOptionalDep', 'setCheckOptionalDep') as () => [boolean, (value: boolean) => void];
export const useExcludeDependents = tupleHook('excludeDependents', 'setExcludeDependents') as () => [boolean, (value: boolean) => void];
export const useFullTree = tupleHook('fullTree', 'setFullTree') as () => [boolean, (value: boolean) => void];
export const useShowUpdate = tupleHook('showUpdate', 'setShowUpdate') as () => [boolean, (value: boolean) => void];
export const useShowDetailed = tupleHook('showDetailed', 'setShowDetailed') as () => [boolean, (value: boolean) => void];
export const useModComments = tupleHook('modComments', 'setModComments') as () => [Record<string, string>, (value: Record<string, string>) => void];

export const currentMirror = () => useAppStore.getState().mirror;
export const initMirror = initializeAppStore;
export const initGamePath = initializeAppStore;
export const initUseMultiThread = () => undefined;
export const initAlwaysOnMods = () => undefined;
export const initSearchSort = () => undefined;
export const initAutoDisableNewMods = () => undefined;
export const initCheckOptionalDep = () => undefined;
export const initExcludeDependents = () => undefined;
export const initFullTree = () => undefined;
export const initShowUpdate = () => undefined;
export const initShowDetailed = () => undefined;
export const initModComments = () => undefined;

export function useInitializeAppStore() {
  useEffect(() => { void initializeAppStore(); }, []);
}
