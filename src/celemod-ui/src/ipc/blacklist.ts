export interface ModBlacklistProfile {
  name: string;
  enabled_mods: string[];
  /** Installed Mod files that stay disabled even while the Mod name is on. */
  disabled_files?: string[];
  auto_deps?: boolean;
}

export interface ProfileImportResult {
  profiles: ModBlacklistProfile[];
  missing_mods: string[];
  missing_files: string[];
}
