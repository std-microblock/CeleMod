export interface ModBlacklist {
    name: string,
    file: string,
}

export interface ModBlacklistProfile {
    name: string,
    mods: ModBlacklist[],
}