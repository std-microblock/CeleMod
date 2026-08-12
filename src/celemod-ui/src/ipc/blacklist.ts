export interface ModBlacklistProfile {
  name: string;
  enabled_mods: string[];
  auto_deps?: boolean;
}

export interface ProfileImportResult {
  profiles: ModBlacklistProfile[];
  missing_mods: string[];
  missing_files: string[];
}
