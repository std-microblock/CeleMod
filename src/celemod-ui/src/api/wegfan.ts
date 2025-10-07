import { URLSearchParams, celemodUA } from "../utils";

export interface WegfanSubmissionSearchResult {
    content: Content[];
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalElements: number;
    isFirstPage: boolean;
    isLastPage: boolean;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

export interface Content {
    id: string;
    createTime: Date;
    updateTime: Date;
    deleteTime: null;
    name: string;
    submissionType: SubmissionType;
    submitter: string;
    pageUrl: string;
    gameBananaSection: GameBananaSection;
    gameBananaId: number;
    categoryId: number;
    categoryName: CategoryName;
    subCategoryId: number | null;
    subCategoryName: SubCategoryName | null;
    subtitle: string;
    description: string;
    views: number;
    likes: number;
    downloads: number;
    screenshots: Screenshot[];
    credits: Credit[];
    latestUpdateAddedTime: Date;
    files: File[];
}

export enum CategoryName {
    Assets = "Assets",
    Dialog = "Dialog",
    Helpers = "Helpers",
    LönnPlugin = "Lönn Plugin",
    Map = "Map",
    Maps = "Maps",
    Mechanics = "Mechanics",
    OtherMisc = "Other/Misc",
    Skins = "Skins",
    UI = "UI",
}

export interface Credit {
    groupName: string;
    authors: Author[];
}

export interface Author {
    name: string;
    role: string;
    url: string;
}

export interface File {
    id: string;
    createTime: Date;
    updateTime: Date;
    deleteTime: null;
    url: string;
    description: string;
    downloads: number;
    size: number;
    gameBananaId: number;
    mods: Mod[];
}

export interface Mod {
    id: string;
    createTime: Date;
    updateTime: Date;
    deleteTime: null;
    name: string;
    version: string;
    xxHash: string[];
}

export enum GameBananaSection {
    Mod = "Mod",
    Tool = "Tool",
    Wip = "Wip",
}

export interface Screenshot {
    id: string;
    createTime: Date;
    updateTime: Date;
    deleteTime: null;
    url: string;
    caption: null | string;
}

export enum SubCategoryName {
    Audio = "Audio",
    Campaign = "Campaign",
    CollabContest = "Collab/Contest",
    Collectibles = "Collectibles",
    Graphics = "Graphics",
    Multiplayer = "Multiplayer",
    OtherMisc = "Other/Misc",
    Player = "Player",
    Standalone = "Standalone",
    Translations = "Translations",
}

export enum SubmissionType {
    GameBananaMod = "GAME_BANANA_MOD",
}

export interface WegfanSearchSubmissionParams {
    page?: number;
    size?: number;
    categoryId?: number;
    section?: string;
    search?: string;
    sort?: "new" | "updateAdded" | "updated" | "views" | "likes";
    includeExclusiveSubmissions?: boolean;
}

export const searchSubmission = async ({
    page,
    size,
    categoryId,
    section,
    search,
    sort,
    includeExclusiveSubmissions
}: WegfanSearchSubmissionParams): Promise<WegfanSubmissionSearchResult> => {
    const params = new URLSearchParams();
    if (page) params.set("page", page.toString());
    if (size) params.set("size", size.toString());
    if (categoryId) params.set("categoryId", categoryId.toString());
    if (section) params.set("section", section);
    if (search) params.set("search", search);
    if (sort) params.set("sort", sort);
    if (includeExclusiveSubmissions) params.set("includeExclusiveSubmissions", includeExclusiveSubmissions.toString());
    const url = `https://celeste.weg.fan/api/v2/submission/search?${params.toString()}`;
    console.log('Search URL:', url);
    return fetch(url, {
        headers: {
            'User-Agent': celemodUA
        }
    }).then((v) => v.json()).then(v=>v.data);
}