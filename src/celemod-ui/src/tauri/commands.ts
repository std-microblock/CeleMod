import { Channel, invoke } from '@tauri-apps/api/core';

type LegacyCallback = (...args: unknown[]) => void;

const parameterNames: Record<string, string[]> = {
  download_mod: ['name', 'url', 'modsDir', 'downloadTypeDefaults', 'onEvent', 'useCnProxy', 'multiThread'],
  cancel_download_mod: ['name'],
  cleanup_mod_download_temp_files: ['gamePath'],
  get_celeste_dirs: [],
  get_installed_mod_ids: ['modsFolderPath', 'onEvent'],
  get_installed_mods: ['modsFolderPath', 'onEvent'],
  get_invalid_zip_mod_files: ['modsFolderPath', 'onEvent'],
  check_all_mod_contents: ['modsFolderPath', 'onEvent'],
  get_installed_miaonet: ['modsFolderPath', 'onEvent'],
  start_game: ['path'],
  open_url: ['url'],
  get_blacklist_profiles: ['gamePath', 'onEvent'],
  apply_blacklist_profile: ['gamePath', 'profileName', 'alwaysOnMods'],
  switch_mod_blacklist_profile: ['gamePath', 'profileName', 'modNames', 'modFiles', 'enabled'],
  new_mod_blacklist_profile: ['gamePath', 'profileName'],
  get_current_profile: ['gamePath'],
  remove_mod_blacklist_profile: ['gamePath', 'profileName'],
  get_mod_update: ['name', 'onEvent'],
  rm_mod: ['modsFolderPath', 'modName'],
  delete_mods: ['gamePath', 'modNames', 'onEvent'],
  delete_mod_files: ['modsFolderPath', 'fileNames', 'onEvent'],
  get_everest_version: ['gamePath', 'onEvent'],
  download_and_install_everest: ['gamePath', 'url', 'onEvent'],
  install_local_packages: ['gamePath', 'packagePaths', 'autoDisableNewMods', 'onEvent'],
  celemod_version: [],
  celemod_hash: [],
  enable_window_controls: [],
  do_self_update: ['url', 'onEvent'],
  start_game_directly: ['path', 'origin'],
  verify_celeste_install: ['path'],
  normalize_game_path: ['path'],
  get_mod_latest_info: ['onEvent'],
  show_log_window: [],
  get_current_blacklist_content: ['gamePath'],
  import_blacklist_file_as_profile: ['gamePath', 'alwaysOnMods'],
  is_using_cache: [],
  configure_mod_cache: ['ttlSeconds'],
  get_mod_catalog: ['forceRefresh'],
  get_mod_cache_status: [],
  get_database_path: [],
  set_mod_options_order: ['gamePath', 'profileName', 'orderJson'],
};

const isTauriRuntime = () => '__TAURI_INTERNALS__' in window;

export async function callRemote<T = unknown>(name: string, ...legacyArgs: unknown[]): Promise<T> {
  const names = parameterNames[name];
  if (!names) throw new Error(`Unknown Tauri command: ${name}`);
  if (!isTauriRuntime()) {
    throw new Error(`Tauri command "${name}" is unavailable in a browser preview`);
  }

  const args: Record<string, unknown> = {};
  names.forEach((parameterName, index) => {
    const value = legacyArgs[index];
    if (parameterName === 'onEvent') {
      if (typeof value !== 'function') return;
      const callback = value as LegacyCallback;
      const channel = new Channel<unknown>();
      channel.onmessage = (payload) => {
        callback(...(Array.isArray(payload) ? payload : [payload]));
      };
      args.onEvent = channel;
      return;
    }
    args[parameterName] = value;
  });

  return invoke<T>(name, args);
}

export async function invokeCommand<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`Tauri command "${name}" is unavailable in a browser preview`);
  }
  return invoke<T>(name, args);
}
