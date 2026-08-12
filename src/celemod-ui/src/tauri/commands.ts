import { Channel, invoke } from "@tauri-apps/api/core";

type LegacyCallback = (...args: unknown[]) => void;

const parameterNames: Record<string, string[]> = {
  download_mod: [
    "name",
    "url",
    "modsDir",
    "downloadTypeDefaults",
    "profileEnabled",
    "currentProfileName",
    "alwaysOnMods",
    "onEvent",
    "useCnProxy",
    "multiThread",
  ],
  cancel_download_mod: ["name"],
  cleanup_mod_download_temp_files: ["gamePath"],
  get_celeste_dirs: [],
  take_pending_deep_links: [],
  get_installed_mod_ids: ["modsFolderPath", "onEvent"],
  get_installed_mods: ["modsFolderPath", "onEvent"],
  get_invalid_zip_mod_files: ["modsFolderPath", "onEvent"],
  check_all_mod_contents: ["modsFolderPath", "onEvent"],
  get_installed_miaonet: ["modsFolderPath", "onEvent"],
  start_game: ["path"],
  open_url: ["url"],
  get_blacklist_profiles: ["gamePath", "onEvent"],
  get_blacklist_profile_count: ["gamePath"],
  get_direct_blacklist_profile: ["gamePath", "onEvent"],
  switch_direct_blacklist: ["gamePath", "modFiles", "enabled"],
  update_blacklist_mod_file: [
    "gamePath",
    "modName",
    "oldFile",
    "newFile",
    "profileEnabled",
    "alwaysOnMods",
  ],
  apply_mod_profiles: ["gamePath", "profileNames", "alwaysOnMods"],
  get_active_profile_mods: ["gamePath", "alwaysOnMods"],
  switch_mod_profile_mods: ["gamePath", "profileName", "modNames", "enabled"],
  get_current_profiles: ["gamePath"],
  get_olympus_presets: ["gamePath"],
  preview_olympus_profiles: ["gamePath", "profileNames"],
  preview_mod_profiles: ["gamePath", "sourcePath"],
  preview_mod_profiles_json: ["gamePath", "contents"],
  commit_mod_profiles: ["gamePath", "profiles"],
  write_text_file: ["path", "contents"],
  export_mod_profile: [
    "gamePath",
    "profileName",
    "destination",
    "enabledMods",
    "autoDeps",
  ],
  expand_mod_profile_dependencies: ["gamePath", "profileName"],
  new_mod_blacklist_profile: ["gamePath", "profileName"],
  get_current_profile: ["gamePath"],
  remove_mod_blacklist_profile: ["gamePath", "profileName"],
  get_mod_update: ["name", "onEvent"],
  rm_mod: ["modsFolderPath", "modName"],
  delete_mods: ["gamePath", "modNames", "onEvent"],
  delete_mod_files: ["modsFolderPath", "fileNames", "onEvent"],
  get_everest_version: ["gamePath", "onEvent"],
  has_new_keyboard_input_enabled: ["gamePath"],
  remove_new_keyboard_input: ["gamePath"],
  download_and_install_everest: ["gamePath", "url", "onEvent"],
  download_and_install_crash_mod_fix: [
    "gamePath",
    "modName",
    "affectedVersions",
    "fixedVersion",
    "url",
    "sha256",
    "onEvent",
  ],
  runtime_platform: [],
  get_loenn_state: ["installRoot"],
  download_and_install_loenn: [
    "installRoot",
    "version",
    "url",
    "packageType",
    "fileName",
    "executable",
    "sha256",
    "onEvent",
  ],
  start_loenn: ["installRoot"],
  install_local_packages: [
    "gamePath",
    "packagePaths",
    "autoDisableNewMods",
    "profileEnabled",
    "currentProfileName",
    "alwaysOnMods",
    "onEvent",
  ],
  celemod_version: [],
  celemod_hash: [],
  enable_window_controls: [],
  do_self_update: ["url", "onEvent"],
  start_game_directly: ["path", "origin"],
  check_everest_crash: ["gamePath"],
  stop_game_for_restart: ["gamePath"],
  restart_game_with_loader: ["gamePath", "legacyLoader"],
  reveal_crash_report: ["path"],
  verify_celeste_install: ["path"],
  normalize_game_path: ["path"],
  get_mod_latest_info: ["onEvent"],
  show_log_window: [],
  is_using_cache: [],
  configure_mod_cache: ["ttlSeconds"],
  get_mod_catalog: ["forceRefresh"],
  get_mod_cache_status: [],
  get_database_path: [],
  start_miaonet_oauth: ["gamePath", "onEvent"],
  get_key_bindings: ["gamePath", "language"],
  update_key_binding: ["gamePath", "request"],
};

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

export async function callRemote<T = unknown>(
  name: string,
  ...legacyArgs: unknown[]
): Promise<T> {
  const names = parameterNames[name];
  if (!names) throw new Error(`Unknown Tauri command: ${name}`);
  if (!isTauriRuntime()) {
    throw new Error(
      `Tauri command "${name}" is unavailable in a browser preview`,
    );
  }

  const args: Record<string, unknown> = {};
  names.forEach((parameterName, index) => {
    const value = legacyArgs[index];
    if (parameterName === "onEvent") {
      if (typeof value !== "function") return;
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

export async function invokeCommand<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(
      `Tauri command "${name}" is unavailable in a browser preview`,
    );
  }
  return invoke<T>(name, args);
}
