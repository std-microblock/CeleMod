/**
 * Mods can end up inside the Celeste `Mods` folder without going through
 * CeleMod: copied in by hand, extracted by another tool or installed by the
 * game itself.  Such a Mod is unknown to every profile, and applying a profile
 * rewrites `blacklist.txt` as a whitelist, so those Mods used to be disabled
 * no matter what the install/download defaults asked for.
 *
 * This helper picks the Mods that should be adopted by the profiles that are
 * about to be applied, so the user's default decides their state instead of
 * the whitelist silently dropping them.
 */

export interface InstalledModLike {
  name: string;
  file: string;
}

export interface ModAdoptionInput {
  installed: readonly InstalledModLike[];
  /** Mod names the profiles that are about to be applied enable. */
  profileEnabledNames: readonly string[];
  /**
   * Mod names the current `blacklist.txt` still loads.  Every other installed
   * Mod was disabled by CeleMod on purpose and must stay disabled.
   */
  blacklistEnabledNames: readonly string[];
  /**
   * Mod names CeleMod already saw.  They are not newly added, so they keep the
   * state the profiles and the blacklist gave them.
   */
  knownNames: readonly string[];
  alwaysOnNames: readonly string[];
  /** The "Mod 下载后默认行为" setting: enable new Mods after they are added. */
  enableNewMods: boolean;
}

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * Names of the installed Mods that CeleMod should adopt into the applied
 * profiles.  Returns an empty list when the default is "disable" - applying
 * the profiles then disables those Mods, which is exactly that setting.
 */
export const selectAdoptableModNames = ({
  installed,
  profileEnabledNames,
  blacklistEnabledNames,
  knownNames,
  alwaysOnNames,
  enableNewMods,
}: ModAdoptionInput): string[] => {
  if (!enableNewMods) return [];
  const profileEnabled = new Set(profileEnabledNames.map(normalize));
  const blacklistEnabled = new Set(blacklistEnabledNames.map(normalize));
  const known = new Set(knownNames.map(normalize));
  const alwaysOn = new Set(alwaysOnNames.map(normalize));

  const adopted: string[] = [];
  const handled = new Set<string>();
  for (const mod of installed) {
    const key = normalize(mod.name);
    if (!key || handled.has(key)) continue;
    handled.add(key);
    if (profileEnabled.has(key)) continue;
    if (!blacklistEnabled.has(key)) continue;
    if (known.has(key) || alwaysOn.has(key)) continue;
    adopted.push(mod.name);
  }
  return adopted;
};
