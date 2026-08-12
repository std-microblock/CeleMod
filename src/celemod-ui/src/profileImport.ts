import { loadModCatalog } from "./api/modCatalog";
import type { ProfileImportResult } from "./ipc/blacklist";
import { useDownloadStore } from "./stores/download";
import { reloadBlacklistState } from "./states";
import { callRemote } from "./utils";

/** Queues downloads for missing Mods after a profile import is persisted. */
const downloadMissingMods = async (result: ProfileImportResult) => {
  const missingNames = new Set(
    result.missing_mods.map((name) => name.toLocaleLowerCase())
  );
  const missingFileKeys = new Set(
    result.missing_files.map((file) =>
      file
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9]/gi, "")
        .toLocaleLowerCase()
    )
  );
  if (missingNames.size === 0 && missingFileKeys.size === 0) return;

  const catalog = await loadModCatalog();
  const downloadMod = useDownloadStore.getState().downloadMod;
  for (const mod of catalog) {
    const catalogKey = mod.name
      .replace(/[^a-z0-9]/gi, "")
      .toLocaleLowerCase();
    if (
      !missingNames.has(mod.name.toLocaleLowerCase()) &&
      !missingFileKeys.has(catalogKey)
    )
      continue;
    const file = mod.submissionFile;
    const source =
      file.gameBananaId && file.gameBananaId > 0
        ? String(file.gameBananaId)
        : file.url;
    if (!source) continue;
    downloadMod(mod.name, source, { autoDisableNewMods: false });
  }
};

/** Imports a CeleMod JSON file and queues downloads for known missing Mods. */
export const importProfileFile = async (gamePath: string, sourcePath: string) => {
  const raw = await callRemote<string>(
    "import_mod_profiles",
    gamePath,
    sourcePath
  );
  let result: ProfileImportResult;
  try {
    result = JSON.parse(raw) as ProfileImportResult;
  } catch {
    throw new Error(raw);
  }
  await downloadMissingMods(result);
  await reloadBlacklistState(gamePath);
  return result;
};

export const importOlympusProfiles = async (
  gamePath: string,
  profileNames: string[]
) => {
  const raw = await callRemote<string>(
    "import_olympus_presets",
    gamePath,
    JSON.stringify(profileNames)
  );
  let result: ProfileImportResult;
  try {
    result = JSON.parse(raw) as ProfileImportResult;
  } catch {
    throw new Error(raw);
  }
  await downloadMissingMods(result);
  await reloadBlacklistState(gamePath);
  return result;
};
