export interface ModBlacklistProfile {
  name: string;
  enabled_mods: string[];
}

export interface ProfileImportResult {
  profiles: ModBlacklistProfile[];
  missing_mods: string[];
  missing_files: string[];
}
