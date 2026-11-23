import { useCallback, useEffect, useMemo, useState } from "react";
import { fetch as tauriHttpFetch } from "../lib/http";
import type { ManageNode } from "../stores/manage";
import { type CrashModFix, type UpdateInfo, useUpdateInfo } from "./updateInfo";

export interface OfficialEverestVersion {
  version: number;
  branch: string;
  date: string;
  mainDownload: string;
  mainFileSize?: number;
  commit?: string;
}

export interface EverestUpdateTarget {
  version: string;
  build: number;
  url: string;
  isUltra: boolean;
  postInstallFixes: CrashModFix[];
}

export interface RequiredEverestVersion {
  build: number;
  version: string;
  requiredBy: string[];
}

const OFFICIAL_EVEREST_VERSIONS_URL =
  "https://maddie480.ovh/celeste/everest-versions?supportsNativeBuilds=true";

const EVEREST_DEPENDENCY_NAMES = new Set(["Everest", "EverestCore"]);

export const extractEverestBuild = (
  version: string | number | null | undefined,
): number => {
  if (version === null || version === undefined) return 0;
  if (typeof version === "number") {
    return Number.isFinite(version) && version > 0 ? Math.floor(version) : 0;
  }

  const trimmed = String(version).trim();
  if (!trimmed) return 0;

  const semverMatch = trimmed.match(/^v?1\.(\d+)/i);
  if (semverMatch) {
    const build = Number(semverMatch[1]);
    return Number.isFinite(build) && build > 0 ? build : 0;
  }

  const digitRuns = trimmed.match(/\d+/g);
  if (!digitRuns || digitRuns.length === 0) return 0;

  let maxBuild = 0;
  for (const run of digitRuns) {
    const value = Number(run);
    if (Number.isFinite(value) && value > maxBuild) {
      maxBuild = value;
    }
  }
  return maxBuild;
};

export const findRequiredEverestVersion = (
  nodes: Record<string, ManageNode>,
): RequiredEverestVersion | null => {
  let highestBuild = 0;
  let highestVersion = "";
  let requiredBy: string[] = [];

  for (const node of Object.values(nodes)) {
    if (!node.enabled) continue;
    for (const dep of node.dependencies) {
      if (dep.optional || !EVEREST_DEPENDENCY_NAMES.has(dep.name)) continue;
      const build = extractEverestBuild(dep.version);
      if (build <= 0) continue;

      if (build > highestBuild) {
        highestBuild = build;
        highestVersion = dep.version;
        requiredBy = [node.name];
      } else if (build === highestBuild && !requiredBy.includes(node.name)) {
        requiredBy.push(node.name);
      }
    }
  }

  if (highestBuild <= 0) return null;
  return {
    build: highestBuild,
    version: highestVersion,
    requiredBy,
  };
};

let cachedOfficialStable: Promise<OfficialEverestVersion | null> | null = null;
let cachedOfficialStableRequestId = 0;
type OfficialStableListener = (value: OfficialEverestVersion | null) => void;
const officialStableListeners = new Set<OfficialStableListener>();

const notifyOfficialStable = (value: OfficialEverestVersion | null) => {
  for (const listener of officialStableListeners) {
    try {
      listener(value);
    } catch (error) {
      console.error("Failed to notify Everest update listener", error);
    }
  }
};

const subscribeOfficialStable = (listener: OfficialStableListener) => {
  officialStableListeners.add(listener);
  return () => {
    officialStableListeners.delete(listener);
  };
};

const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const requestOfficialEverestVersions = (url: string) =>
  isTauriRuntime() ? tauriHttpFetch(url) : globalThis.fetch(url);

export const fetchLatestOfficialEverestStable = (
  forceRefresh = false,
): Promise<OfficialEverestVersion | null> => {
  if (!cachedOfficialStable || forceRefresh) {
    const requestId = ++cachedOfficialStableRequestId;
    const request = requestOfficialEverestVersions(
      OFFICIAL_EVEREST_VERSIONS_URL,
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load Everest versions: HTTP ${response.status}`,
          );
        }
        return response.json() as Promise<OfficialEverestVersion[]>;
      })
      .then((versions) => {
        if (!Array.isArray(versions)) return null;
        let latest: OfficialEverestVersion | null = null;
        let latestBuild = 0;
        for (const item of versions) {
          if (!item || item.branch?.toLowerCase() !== "stable") continue;
          const build = extractEverestBuild(item.version);
          if (build > latestBuild) {
            latestBuild = build;
            latest = item;
          }
        }
        return latest;
      });

    cachedOfficialStable = request;
    void request.then(
      (value) => {
        if (
          cachedOfficialStable === request &&
          cachedOfficialStableRequestId === requestId
        ) {
          notifyOfficialStable(value);
        }
      },
      () => {
        if (
          cachedOfficialStable === request &&
          cachedOfficialStableRequestId === requestId
        ) {
          cachedOfficialStable = null;
        }
      },
    );
  }
  return cachedOfficialStable;
};

export const resolveEverestUpdateTarget = (input: {
  currentEverestVersion: string;
  currentEverestIsUltra: boolean;
  updateInfo: UpdateInfo | null;
  mirror: string;
  officialStable: OfficialEverestVersion | null;
}): {
  installedBuild: number;
  target: EverestUpdateTarget | null;
  hasUpdate: boolean;
} => {
  const installedBuild = extractEverestBuild(input.currentEverestVersion);
  let target: EverestUpdateTarget | null = null;

  if (input.currentEverestIsUltra) {
    const ultraVersions = input.updateInfo?.everest_ultra?.versions ?? [];
    let latestUltra: { version: string; build: number; url: string } | null =
      null;
    for (const item of ultraVersions) {
      if (item.channel && item.channel.toLowerCase() !== "stable") continue;
      if (!item.url) continue;
      const build = extractEverestBuild(item.version);
      if (build <= 0) continue;
      if (!latestUltra || build > latestUltra.build) {
        latestUltra = {
          version: item.version,
          build,
          url: item.url,
        };
      }
    }
    if (latestUltra) {
      const postInstallFixes = (input.updateInfo?.crash_mod_fixes ?? []).filter(
        (fix) => fix.mod_name.toLocaleLowerCase() === "rushhelper",
      );
      target = {
        version: latestUltra.version,
        build: latestUltra.build,
        url: latestUltra.url,
        isUltra: true,
        postInstallFixes,
      };
    }
  } else if (input.officialStable) {
    const build = extractEverestBuild(input.officialStable.version);
    const url =
      input.mirror === "wegfan"
        ? `https://celeste.weg.fan/api/v2/download/everest/${input.officialStable.version}`
        : input.officialStable.mainDownload;
    if (build > 0 && url) {
      target = {
        version: String(input.officialStable.version),
        build,
        url,
        isUltra: false,
        postInstallFixes: [],
      };
    }
  }

  const hasUpdate =
    installedBuild > 0 && Boolean(target && target.build > installedBuild);

  return { installedBuild, target, hasUpdate };
};

// Load ../states lazily inside the hook so pure helpers remain runnable in Node
// unit tests without importing Vite PNG asset modules referenced by states.ts.
let cachedStatesModule: typeof import("../states") | null = null;
let statesModulePromise: Promise<typeof import("../states")> | null = null;

const loadStatesModule = () => {
  if (!statesModulePromise) {
    statesModulePromise = import("../states").then((mod) => {
      cachedStatesModule = mod;
      return mod;
    });
  }
  return statesModulePromise;
};

interface EverestAppSlice {
  currentEverestVersion: string;
  currentEverestIsUltra: boolean;
  mirror: string;
  gamePath: string;
}

const readAppSlice = (
  mod: typeof import("../states") | null,
): EverestAppSlice => {
  if (!mod) {
    return {
      currentEverestVersion: "",
      currentEverestIsUltra: false,
      mirror: "wegfan",
      gamePath: "",
    };
  }
  const state = mod.useAppStore.getState();
  return {
    currentEverestVersion: state.currentEverestVersion,
    currentEverestIsUltra: state.currentEverestIsUltra,
    mirror: state.mirror,
    gamePath: state.gamePath,
  };
};

export const useEverestUpdate = () => {
  const [appSlice, setAppSlice] = useState<EverestAppSlice>(() =>
    readAppSlice(cachedStatesModule),
  );
  const { data: updateInfo } = useUpdateInfo();
  const [officialStable, setOfficialStable] =
    useState<OfficialEverestVersion | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const attach = (mod: typeof import("../states")) => {
      if (!active) return;
      const sync = () => {
        const next = readAppSlice(mod);
        setAppSlice((prev) =>
          prev.currentEverestVersion === next.currentEverestVersion &&
          prev.currentEverestIsUltra === next.currentEverestIsUltra &&
          prev.mirror === next.mirror &&
          prev.gamePath === next.gamePath
            ? prev
            : next,
        );
      };
      sync();
      unsubscribe = mod.useAppStore.subscribe(sync);
    };

    if (cachedStatesModule) {
      attach(cachedStatesModule);
    } else {
      void loadStatesModule().then(attach);
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const { currentEverestVersion, currentEverestIsUltra, mirror, gamePath } =
    appSlice;

  useEffect(() => {
    const unsubscribe = subscribeOfficialStable(setOfficialStable);
    if (!gamePath || !currentEverestVersion || currentEverestIsUltra) {
      return unsubscribe;
    }

    let active = true;
    setChecking(true);
    void fetchLatestOfficialEverestStable()
      .then((latest) => {
        if (active) setOfficialStable(latest);
      })
      .catch((error) => {
        console.error("Failed to check official Everest updates", error);
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentEverestIsUltra, currentEverestVersion, gamePath]);

  const refresh = useCallback(async () => {
    if (currentEverestIsUltra) return null;
    setChecking(true);
    try {
      const latest = await fetchLatestOfficialEverestStable(true);
      setOfficialStable(latest);
      return latest;
    } finally {
      setChecking(false);
    }
  }, [currentEverestIsUltra]);

  const resolved = useMemo(
    () =>
      resolveEverestUpdateTarget({
        currentEverestVersion,
        currentEverestIsUltra,
        updateInfo,
        mirror,
        officialStable,
      }),
    [
      currentEverestIsUltra,
      currentEverestVersion,
      mirror,
      officialStable,
      updateInfo,
    ],
  );

  return {
    ...resolved,
    checking,
    refresh,
  };
};
