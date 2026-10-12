import { compareVersion } from "./utils";

/**
 * A row of `get_mod_latest_info`: the newest file the catalog knows for a Mod.
 * `xxHash` holds the xxHash64 of that file, the same value Everest and Olympus
 * compare installed archives against.
 */
export type LatestModTuple = [
  name: string,
  version: string,
  gbFile: string,
  url: string,
  xxHash: string[],
];

export interface LatestModInfo {
  name: string;
  version: string;
  gbFile: string;
  current: string;
  url: string;
  xxHash: string[];
}

export interface InstalledModFile {
  name: string;
  version: string;
  file: string;
  isDirectory: boolean;
}

/**
 * Mods whose newest release can be installed.
 *
 * The catalog version is used first, but upstream archives sometimes keep an
 * old or wrong `everest.yaml` version (aonHelper 0.19.8 still declares 0.19.7),
 * which hides the update from a version comparison.  Everest and Olympus
 * therefore check the archive hash instead, and CeleMod does the same whenever
 * both the installed archive and the catalog provide one.
 */
export const collectModUpdates = (
  installed: readonly InstalledModFile[],
  hashByFile: Readonly<Record<string, string>>,
  latestRaw: readonly LatestModTuple[],
): LatestModInfo[] => {
  const latestByName = new Map(
    latestRaw.map((entry) => [entry[0], entry] as const),
  );
  return installed.flatMap((mod) => {
    const latest = latestByName.get(mod.name);
    if (!latest) return [];
    const [, version, gbFile, url, xxHash] = latest;
    const hash = hashByFile[mod.file];
    const newerVersion = compareVersion(version, mod.version) > 0;
    const replacedArchive =
      !mod.isDirectory &&
      Boolean(hash) &&
      xxHash.length > 0 &&
      !xxHash.includes(hash);
    if (!newerVersion && !replacedArchive) return [];
    return [
      { name: mod.name, version, gbFile, current: mod.version, url, xxHash },
    ];
  });
};
