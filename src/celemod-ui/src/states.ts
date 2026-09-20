import { useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ModBlacklistProfile } from "./ipc/blacklist";
import { selectAdoptableModNames } from "./modAdoption";
import { callRemote } from "./utils";
import {
  DEFAULT_THEME_ID,
  THEME_REGISTRY,
  type ThemeId,
} from "./themes/registry";

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
  modified_at: number;
  is_directory: boolean;
}

type SearchSort = "new" | "updateAdded" | "updated" | "views" | "likes";
export type FontScale = number;
export type ModPageSource = "wegfan" | "gamebanana";

export const MOD_TYPE_OPTIONS = [
  "Maps",
  "Skins",
  "Helpers",
  "Other/Misc",
  "Assets",
  "UI",
  "Mechanics",
  "Dialog",
  "Lönn Plugin",
  "Effects",
  "Ahorn Plugin",
  "Twitch Integration",
  "Mod Installer",
] as const;

export type ModTypeName = (typeof MOD_TYPE_OPTIONS)[number];

export const DEFAULT_ORPHAN_ACTION_TYPES: readonly ModTypeName[] = [
  "Helpers",
  "Assets",
  "Maps",
  "UI",
  "Dialog",
  "Effects",
];

const normalizeModTypes = (
  value: unknown,
  fallback: readonly ModTypeName[] = [],
): string[] => {
  const selected = Array.isArray(value) ? value : fallback;
  return MOD_TYPE_OPTIONS.filter((type) => selected.includes(type));
};

const createDownloadTypeDefaults = (
  enabled: boolean,
): Record<string, boolean> =>
  Object.fromEntries(MOD_TYPE_OPTIONS.map((type) => [type, enabled]));

// The downloader probes Range support at runtime.  Keep the user's setting
// intact for every mirror; WEGFan's CDN is normalized to a Range-capable host
// by the backend before a download starts.
export const resolveMultiThreadSetting = (
  _mirror: string,
  requested: boolean,
) => requested;
const normalizeFontScale = (value: unknown): FontScale => {
  const scale = Number(value);
  return Number.isFinite(scale)
    ? Math.min(200, Math.max(50, Math.round(scale)))
    : 100;
};
const normalizeTheme = (value: unknown): ThemeId =>
  typeof value === "string" &&
  THEME_REGISTRY.some((theme) => theme.id === value)
    ? (value as ThemeId)
    : DEFAULT_THEME_ID;

interface AppState {
  currentProfileName: string;
  activeProfileNames: string[];
  profiles: ModBlacklistProfile[];
  currentProfile: ModBlacklistProfile | null;
  installedMods: BackendModInfo[];
  installedModsLoaded: boolean;
  /**
   * Lowercase Mod names CeleMod already saw, per game path.  Mods that are not
   * listed yet appeared inside the Mods folder without CeleMod installing
   * them, so the install defaults decide whether they stay enabled.
   */
  knownMods: Record<string, string[]>;
  currentEverestVersion: string;
  currentEverestIsUltra: boolean;
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
  autoUseSubmissionNameAsComment: boolean;
  autoToggleDependencies: boolean;
  autoToggleOptionalDependencies: boolean;
  deleteOrphansByDefault: boolean;
  orphanActionTypes: string[];
  hiddenModTypes: string[];
  modCacheTtlHours: number;
  modComments: Record<string, string>;
  enableAcrylic: boolean;
  profileEnabled: boolean;
  profileModeInitialized: boolean;
  profileModeUserConfigured: boolean;
  enablePageTransitions: boolean;
  fontScale: FontScale;
  manageFontScale: FontScale;
  keyBindingsFontScale: FontScale;
  theme: ThemeId;
  modPageSource: ModPageSource;
  page: string;
  setCurrentProfileName: (value: string) => void;
  setActiveProfileNames: (value: string[]) => void;
  setProfiles: (value: ModBlacklistProfile[]) => void;
  setProfilesCallback: (
    setter: (profiles: ModBlacklistProfile[]) => ModBlacklistProfile[],
  ) => void;
  setCurrentProfile: (value: ModBlacklistProfile | null) => void;
  setInstalledMods: (value: BackendModInfo[]) => void;
  setKnownMods: (gamePath: string, names: string[]) => void;
  setCurrentEverestVersion: (value: string) => void;
  setCurrentEverestIsUltra: (value: boolean) => void;
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
  setAutoUseSubmissionNameAsComment: (value: boolean) => void;
  setAutoToggleDependencies: (value: boolean) => void;
  setAutoToggleOptionalDependencies: (value: boolean) => void;
  setDeleteOrphansByDefault: (value: boolean) => void;
  setOrphanActionTypes: (value: string[]) => void;
  setHiddenModTypes: (value: string[]) => void;
  setModCacheTtlHours: (value: number) => void;
  setModComments: (value: Record<string, string>) => void;
  setEnableAcrylic: (value: boolean) => void;
  setProfileEnabled: (value: boolean) => void;
  initializeProfileMode: (value: boolean) => void;
  setEnablePageTransitions: (value: boolean) => void;
  setFontScale: (value: FontScale) => void;
  setManageFontScale: (value: FontScale) => void;
  setKeyBindingsFontScale: (value: FontScale) => void;
  setTheme: (value: ThemeId) => void;
  setModPageSource: (value: ModPageSource) => void;
  setPage: (value: string) => void;
}

const AUTO_DISABLE_NEW_MODS_STORAGE_KEY = "celemod-auto-disable-new-mods";

const loadAutoDisableNewMods = () => {
  try {
    return localStorage.getItem(AUTO_DISABLE_NEW_MODS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const saveAutoDisableNewMods = (value: boolean) => {
  try {
    localStorage.setItem(AUTO_DISABLE_NEW_MODS_STORAGE_KEY, String(value));
  } catch (error) {
    console.error("Failed to persist auto-disable preference", error);
  }
};

const setters = {
  setCurrentProfileName: "currentProfileName",
  setActiveProfileNames: "activeProfileNames",
  setProfiles: "profiles",
  setCurrentProfile: "currentProfile",
  setInstalledMods: "installedMods",
  setCurrentEverestVersion: "currentEverestVersion",
  setCurrentEverestIsUltra: "currentEverestIsUltra",
  setCurrentLang: "currentLang",
  setMirror: "mirror",
  setGamePath: "gamePath",
  setUseMultiThread: "useMultiThread",
  setAlwaysOnMods: "alwaysOnMods",
  setSearchSort: "searchSort",
  setCheckOptionalDep: "checkOptionalDep",
  setExcludeDependents: "excludeDependents",
  setFullTree: "fullTree",
  setShowUpdate: "showUpdate",
  setShowDetailed: "showDetailed",
  setAutoUseSubmissionNameAsComment: "autoUseSubmissionNameAsComment",
  setAutoToggleDependencies: "autoToggleDependencies",
  setAutoToggleOptionalDependencies: "autoToggleOptionalDependencies",
  setDeleteOrphansByDefault: "deleteOrphansByDefault",
  setOrphanActionTypes: "orphanActionTypes",
  setHiddenModTypes: "hiddenModTypes",
  setModCacheTtlHours: "modCacheTtlHours",
  setModComments: "modComments",
  setEnableAcrylic: "enableAcrylic",
  setEnablePageTransitions: "enablePageTransitions",
  setFontScale: "fontScale",
  setManageFontScale: "manageFontScale",
  setKeyBindingsFontScale: "keyBindingsFontScale",
  setTheme: "theme",
  setModPageSource: "modPageSource",
  setPage: "page",
} as const;

export const useAppStore = create<AppState>()(
  persist(
    immer((set) => {
      const actions = Object.fromEntries(
        Object.entries(setters).map(([action, key]) => [
          action,
          (value: unknown) =>
            set((state) => {
              (state as unknown as Record<string, unknown>)[key] = value;
            }),
        ]),
      ) as unknown as Pick<AppState, keyof typeof setters>;
      return {
        currentProfileName: "",
        activeProfileNames: [],
        profiles: [],
        currentProfile: null,
        installedMods: [],
        installedModsLoaded: false,
        knownMods: {},
        currentEverestVersion: "",
        currentEverestIsUltra: false,
        currentLang: "",
        mirror: "wegfan",
        gamePath: "",
        useMultiThread: false,
        alwaysOnMods: [],
        searchSort: "likes",
        autoDisableNewMods: loadAutoDisableNewMods(),
        downloadDefaultEnabled: !loadAutoDisableNewMods(),
        downloadTypeDefaults: createDownloadTypeDefaults(
          !loadAutoDisableNewMods(),
        ),
        checkOptionalDep: false,
        excludeDependents: true,
        fullTree: false,
        showUpdate: true,
        showDetailed: false,
        autoUseSubmissionNameAsComment: true,
        modComments: {},
        autoToggleDependencies: true,
        autoToggleOptionalDependencies: false,
        deleteOrphansByDefault: true,
        orphanActionTypes: [...DEFAULT_ORPHAN_ACTION_TYPES],
        hiddenModTypes: [],
        modCacheTtlHours: 1,
        enableAcrylic: true,
        profileEnabled: true,
        profileModeInitialized: false,
        profileModeUserConfigured: false,
        enablePageTransitions: true,
        fontScale: 100,
        manageFontScale: 100,
        keyBindingsFontScale: 100,
        theme: DEFAULT_THEME_ID,
        modPageSource: "wegfan",
        page: "Home",
        ...actions,
        setProfileEnabled: (value) =>
          set((state) => {
            state.profileEnabled = value;
            state.profileModeInitialized = true;
            state.profileModeUserConfigured = true;
          }),
        initializeProfileMode: (value) =>
          set((state) => {
            if (state.profileModeInitialized) return;
            state.profileEnabled = value;
            state.profileModeInitialized = true;
          }),
        setMirror: (value) =>
          set((state) => {
            state.mirror = value;
            state.useMultiThread = resolveMultiThreadSetting(
              value,
              state.useMultiThread,
            );
          }),
        setGamePath: (value) =>
          set((state) => {
            if (state.gamePath === value) return;
            state.gamePath = value;
            state.installedMods = [];
            state.installedModsLoaded = false;
          }),
        setKnownMods: (gamePath, names) =>
          set((state) => {
            state.knownMods[gamePath] = names.map((name) =>
              name.trim().toLowerCase(),
            );
          }),
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
        setDownloadTypeDefault: (type, enabled) =>
          set((state) => {
            state.downloadTypeDefaults[type] = enabled;
          }),
        setProfilesCallback: (setter) =>
          set((state) => {
            state.profiles = setter(state.profiles);
          }),
      };
    }),
    {
      name: "celemod-preferences",
      storage: createJSONStorage(() => localStorage),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<AppState> & {
          checkBlacklistSync?: unknown;
          autoDisableOrphanTypes?: unknown;
          deleteOrphanTypes?: unknown;
        };
        const {
          checkBlacklistSync: _obsolete,
          autoDisableOrphanTypes: obsoleteAutoDisableTypes,
          deleteOrphanTypes: obsoleteDeleteTypes,
          ...cleanPersisted
        } = persisted;
        const merged = {
          ...currentState,
          ...cleanPersisted,
          fontScale: normalizeFontScale(persisted.fontScale),
          manageFontScale: normalizeFontScale(persisted.manageFontScale),
          keyBindingsFontScale: normalizeFontScale(
            persisted.keyBindingsFontScale,
          ),
          theme: normalizeTheme(persisted.theme),
          orphanActionTypes: normalizeModTypes(
            persisted.orphanActionTypes ??
              obsoleteAutoDisableTypes ??
              obsoleteDeleteTypes,
            DEFAULT_ORPHAN_ACTION_TYPES,
          ),
        };
        merged.useMultiThread = resolveMultiThreadSetting(
          merged.mirror,
          merged.useMultiThread,
        );
        // Profile mode stays on by default until the user picks a value in
        // Settings. Older builds auto-initialized it from the profile count, so
        // only an explicit choice counts as a persisted preference.
        if (persisted.profileModeUserConfigured === true) {
          merged.profileModeUserConfigured = true;
        } else {
          merged.profileEnabled = true;
          merged.profileModeInitialized = false;
          merged.profileModeUserConfigured = false;
        }
        return merged;
      },
      partialize: ({
        mirror,
        gamePath,
        useMultiThread,
        alwaysOnMods,
        searchSort,
        autoDisableNewMods,
        downloadDefaultEnabled,
        downloadTypeDefaults,
        checkOptionalDep,
        excludeDependents,
        fullTree,
        showUpdate,
        showDetailed,
        autoUseSubmissionNameAsComment,
        autoToggleDependencies,
        autoToggleOptionalDependencies,
        deleteOrphansByDefault,
        orphanActionTypes,
        hiddenModTypes,
        modCacheTtlHours,
        modComments,
        enableAcrylic,
        profileEnabled,
        profileModeInitialized,
        profileModeUserConfigured,
        knownMods,
        enablePageTransitions,
        fontScale,
        manageFontScale,
        keyBindingsFontScale,
        theme,
        modPageSource,
        currentLang,
      }) => ({
        mirror,
        gamePath,
        useMultiThread,
        alwaysOnMods,
        searchSort,
        autoDisableNewMods,
        downloadDefaultEnabled,
        downloadTypeDefaults,
        checkOptionalDep,
        excludeDependents,
        fullTree,
        showUpdate,
        showDetailed,
        autoUseSubmissionNameAsComment,
        autoToggleDependencies,
        autoToggleOptionalDependencies,
        deleteOrphansByDefault,
        orphanActionTypes,
        hiddenModTypes,
        modCacheTtlHours,
        modComments,
        enableAcrylic,
        profileEnabled,
        profileModeInitialized,
        profileModeUserConfigured,
        knownMods,
        enablePageTransitions,
        fontScale,
        manageFontScale,
        keyBindingsFontScale,
        theme,
        modPageSource,
        currentLang,
      }),
    },
  ),
);

let blacklistLoadRequest = 0;

const loadProfiles = (gamePath: string) =>
  new Promise<ModBlacklistProfile[]>((resolve, reject) => {
    void callRemote("get_blacklist_profiles", gamePath, (data: string) => {
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    }).catch(reject);
  });

const loadDirectBlacklist = (gamePath: string) =>
  new Promise<ModBlacklistProfile>((resolve, reject) => {
    void callRemote(
      "get_direct_blacklist_profile",
      gamePath,
      (data: string) => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      },
    ).catch(reject);
  });

/**
 * Mods that are copied into the Mods folder by hand are unknown to every
 * profile, so applying the profiles used to blacklist them no matter what the
 * install defaults said.  Adopt those Mods into the profiles that are about to
 * be applied when the default is "enable", and remember the installed Mods so
 * later reloads and profile switches can tell new arrivals from known ones.
 */
export const adoptUntrackedMods = async (
  gamePath: string,
  profiles: ModBlacklistProfile[],
  selectedNames: string[],
): Promise<ModBlacklistProfile[]> => {
  const selected = new Set(selectedNames.map((name) => name.toLowerCase()));
  const selectedProfiles = profiles.filter((profile) =>
    selected.has(profile.name.toLowerCase()),
  );
  // The profiles are still loading: leave the Mods alone instead of adopting
  // everything into a profile that is not known yet.
  if (selectedProfiles.length === 0) return profiles;
  const state = useAppStore.getState();
  const installed = await reloadInstalledMods(gamePath);
  const direct = await loadDirectBlacklist(gamePath);
  const adoptable = selectAdoptableModNames({
    installed,
    profileEnabledNames: selectedProfiles.flatMap(
      (profile) => profile.enabled_mods,
    ),
    blacklistEnabledNames: direct.enabled_mods,
    knownNames: state.knownMods[gamePath] ?? [],
    alwaysOnNames: state.alwaysOnMods,
    enableNewMods: state.downloadDefaultEnabled,
  });
  if (adoptable.length > 0) {
    for (const profileName of selectedNames) {
      const result = await callRemote<string>(
        "switch_mod_profile_mods",
        gamePath,
        profileName,
        JSON.stringify(adoptable),
        true,
      );
      if (result !== "Success") throw new Error(result);
    }
  }
  state.setKnownMods(
    gamePath,
    installed.map((mod) => mod.name),
  );
  return adoptable.length > 0 ? loadProfiles(gamePath) : profiles;
};

// Profile mode needs at least one profile. Seed a Default profile from the
// direct blacklist so switching to profile mode keeps the current Mod selection
// and Mod toggles keep working.
let ensureDefaultProfileTask: {
  gamePath: string;
  promise: Promise<ModBlacklistProfile[]>;
} | null = null;
const ensureDefaultProfile = (gamePath: string) => {
  if (ensureDefaultProfileTask?.gamePath === gamePath) {
    return ensureDefaultProfileTask.promise;
  }
  const promise = (async () => {
    try {
      const profiles = await loadProfiles(gamePath);
      if (profiles.length > 0) return profiles;
      const direct = await loadDirectBlacklist(gamePath);
      const created = await callRemote<string>(
        "new_mod_blacklist_profile",
        gamePath,
        "Default",
      );
      if (created !== "Success") throw new Error(created);
      if (direct.enabled_mods.length > 0) {
        const switched = await callRemote<string>(
          "switch_mod_profile_mods",
          gamePath,
          "Default",
          JSON.stringify(direct.enabled_mods),
          true,
        );
        if (switched !== "Success") throw new Error(switched);
      }
      return loadProfiles(gamePath);
    } finally {
      if (ensureDefaultProfileTask?.promise === promise) {
        ensureDefaultProfileTask = null;
      }
    }
  })();
  ensureDefaultProfileTask = { gamePath, promise };
  return promise;
};

export const reloadBlacklistState = async (gamePath: string) => {
  if (!gamePath) throw new Error("game path not set");
  const request = ++blacklistLoadRequest;
  let state = useAppStore.getState();
  if (!state.profileModeInitialized) {
    // Reading profiles converts legacy v1 files before choosing the default mode.
    await loadProfiles(gamePath);
    state.initializeProfileMode(true);
    state = useAppStore.getState();
  }

  if (state.profileEnabled) {
    let profiles = await loadProfiles(gamePath);
    if (request !== blacklistLoadRequest) return;
    if (profiles.length === 0) {
      profiles = await ensureDefaultProfile(gamePath);
      if (request !== blacklistLoadRequest) return;
    }
    if (profiles.length === 0) {
      state.setProfiles([]);
      state.setActiveProfileNames([]);
      state.setCurrentProfileName("");
      state.setCurrentProfile(null);
      return;
    }
    const requestedNames = JSON.parse(
      await callRemote<string>("get_current_profiles", gamePath),
    ) as string[];
    const activeProfileNames = requestedNames.filter((name) =>
      profiles.some((profile) => profile.name === name),
    );
    const selectedNames =
      activeProfileNames.length > 0 ? activeProfileNames : [profiles[0].name];
    profiles = await adoptUntrackedMods(gamePath, profiles, selectedNames);
    if (request !== blacklistLoadRequest) return;
    const result = await callRemote<string>(
      "apply_mod_profiles",
      gamePath,
      JSON.stringify(selectedNames),
      JSON.stringify(state.alwaysOnMods),
    );
    if (result !== "Success") throw new Error(result);
    if (request !== blacklistLoadRequest) return;
    const currentProfileName = selectedNames[0];
    const currentProfile =
      profiles.find((profile) => profile.name === currentProfileName) ?? null;
    state.setProfiles(profiles);
    state.setActiveProfileNames(selectedNames);
    state.setCurrentProfileName(currentProfile?.name ?? "");
    state.setCurrentProfile(currentProfile);
    return;
  }

  const direct = await loadDirectBlacklist(gamePath);
  if (request !== blacklistLoadRequest) return;
  state.setProfiles([direct]);
  state.setActiveProfileNames([direct.name]);
  state.setCurrentProfileName(direct.name);
  state.setCurrentProfile(direct);
};

let installedModsReloadRequest = 0;
let installedModsAppliedRequest = 0;

export const reloadInstalledMods = async (
  gamePath = useAppStore.getState().gamePath,
): Promise<BackendModInfo[]> => {
  if (!gamePath) throw new Error("game path not set");
  const request = ++installedModsReloadRequest;
  const installedMods = await new Promise<BackendModInfo[]>(
    (resolve, reject) => {
      void callRemote(
        "get_installed_mods",
        `${gamePath}/Mods`,
        (data: string) => {
          try {
            resolve(JSON.parse(data) as BackendModInfo[]);
          } catch (error) {
            reject(error);
          }
        },
      ).catch(reject);
    },
  );
  if (
    request > installedModsAppliedRequest &&
    useAppStore.getState().gamePath === gamePath
  ) {
    installedModsAppliedRequest = request;
    useAppStore.setState({ installedMods, installedModsLoaded: true });
  }
  return installedMods;
};

let initialized = false;
export async function initializeAppStore() {
  if (initialized) return;
  initialized = true;
  const state = useAppStore.getState();
  try {
    await callRemote(
      "configure_mod_cache",
      Math.max(0, state.modCacheTtlHours) * 60 * 60,
    );
    let gamePath = state.gamePath;
    if (state.gamePath) {
      gamePath = await callRemote<string>(
        "normalize_game_path",
        state.gamePath,
      );
      state.setGamePath(gamePath);
    } else {
      const paths = (await callRemote<string>("get_celeste_dirs"))
        .split("\n")
        .filter(Boolean);
      if (paths[0]) {
        gamePath = paths[0];
        state.setGamePath(gamePath);
      }
    }
    if (gamePath) {
      // Loading Profile files performs the on-disk v1 → v2 migration before
      // any profile-mode decision or blacklist application.
      await loadProfiles(gamePath);
    }
    if (gamePath) {
      await callRemote("cleanup_mod_download_temp_files", gamePath);
    }
  } catch (error) {
    console.error("Failed to initialize application state", error);
  }
}

const objectHook =
  <K extends keyof AppState>(keys: readonly K[]) =>
  () =>
    useAppStore(
      useShallow(
        (state) =>
          Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<
            AppState,
            K
          >,
      ),
    );

export const useCurrentBlacklistProfile = objectHook([
  "activeProfileNames",
  "setActiveProfileNames",

  "currentProfileName",
  "setCurrentProfileName",
  "profiles",
  "setProfiles",
  "setProfilesCallback",
  "currentProfile",
  "setCurrentProfile",
] as const);
export const useInstalledMods = objectHook([
  "installedMods",
  "setInstalledMods",
] as const);
export const useCurrentEverestVersion = objectHook([
  "currentEverestVersion",
  "setCurrentEverestVersion",
] as const);
export const useCurrentEverestUltra = objectHook([
  "currentEverestIsUltra",
  "setCurrentEverestIsUltra",
] as const);
export const useCurrentLang = objectHook([
  "currentLang",
  "setCurrentLang",
] as const);
export const useEnableAcrylic = objectHook([
  "enableAcrylic",
  "setEnableAcrylic",
] as const);

function tupleHook<K extends keyof AppState, S extends keyof AppState>(
  value: K,
  setter: S,
) {
  return () =>
    useAppStore(
      useShallow(
        (state) => [state[value], state[setter]] as [AppState[K], AppState[S]],
      ),
    );
}

export const useMirror = tupleHook("mirror", "setMirror") as () => [
  string,
  (value: string) => void,
];
export const useGamePath = tupleHook("gamePath", "setGamePath") as () => [
  string,
  (value: string) => void,
];
export const useUseMultiThread = tupleHook(
  "useMultiThread",
  "setUseMultiThread",
) as () => [boolean, (value: boolean) => void];
export const useAlwaysOnMods = tupleHook(
  "alwaysOnMods",
  "setAlwaysOnMods",
) as () => [string[], (value: string[]) => void];
export const useSearchSort = tupleHook("searchSort", "setSearchSort") as () => [
  SearchSort,
  (value: SearchSort) => void,
];
export const useAutoDisableNewMods = tupleHook(
  "autoDisableNewMods",
  "setAutoDisableNewMods",
) as () => [boolean, (value: boolean) => void];
export const useCheckOptionalDep = tupleHook(
  "checkOptionalDep",
  "setCheckOptionalDep",
) as () => [boolean, (value: boolean) => void];
export const useExcludeDependents = tupleHook(
  "excludeDependents",
  "setExcludeDependents",
) as () => [boolean, (value: boolean) => void];
export const useFullTree = tupleHook("fullTree", "setFullTree") as () => [
  boolean,
  (value: boolean) => void,
];
export const useShowUpdate = tupleHook("showUpdate", "setShowUpdate") as () => [
  boolean,
  (value: boolean) => void,
];
export const useShowDetailed = tupleHook(
  "showDetailed",
  "setShowDetailed",
) as () => [boolean, (value: boolean) => void];
export const useModComments = tupleHook(
  "modComments",
  "setModComments",
) as () => [Record<string, string>, (value: Record<string, string>) => void];

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
  useEffect(() => {
    void initializeAppStore();
  }, []);
}
