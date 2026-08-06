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
  checkOptionalDep: boolean;
  excludeDependents: boolean;
  fullTree: boolean;
  showUpdate: boolean;
  showDetailed: boolean;
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
  setCheckOptionalDep: (value: boolean) => void;
  setExcludeDependents: (value: boolean) => void;
  setFullTree: (value: boolean) => void;
  setShowUpdate: (value: boolean) => void;
  setShowDetailed: (value: boolean) => void;
  setModComments: (value: Record<string, string>) => void;
  setEnableAcrylic: (value: boolean) => void;
  setLastUseMap: (value: Record<string, number>) => void;
  setPage: (value: string) => void;
  setDownloadMenuOpen: (value: boolean) => void;
}

const setters = {
  setCurrentProfileName: 'currentProfileName', setProfiles: 'profiles',
  setCurrentProfile: 'currentProfile', setInstalledMods: 'installedMods',
  setCurrentEverestVersion: 'currentEverestVersion', setCurrentLang: 'currentLang',
  setMirror: 'mirror', setGamePath: 'gamePath', setUseMultiThread: 'useMultiThread',
  setAlwaysOnMods: 'alwaysOnMods', setSearchSort: 'searchSort',
  setAutoDisableNewMods: 'autoDisableNewMods', setCheckOptionalDep: 'checkOptionalDep',
  setExcludeDependents: 'excludeDependents', setFullTree: 'fullTree',
  setShowUpdate: 'showUpdate', setShowDetailed: 'showDetailed',
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
        autoDisableNewMods: false, checkOptionalDep: false, excludeDependents: true,
        fullTree: false, showUpdate: true, showDetailed: false, modComments: {},
        enableAcrylic: true, lastUseMap: {}, page: 'Home', downloadMenuOpen: false,
        ...actions,
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
        autoDisableNewMods, checkOptionalDep, excludeDependents, fullTree,
        showUpdate, showDetailed, modComments, enableAcrylic, currentLang, lastUseMap,
      }) => ({
        mirror, gamePath, useMultiThread, alwaysOnMods, searchSort,
        autoDisableNewMods, checkOptionalDep, excludeDependents, fullTree,
        showUpdate, showDetailed, modComments, enableAcrylic, currentLang, lastUseMap,
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
