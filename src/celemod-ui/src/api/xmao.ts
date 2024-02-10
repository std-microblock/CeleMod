import { URLSearchParams } from "../utils";

export interface SearchModResp {
    code: number;
    message: string;
    data: Data;
}

export interface Data {
    Mods: Mod[];
    Mods_Count: number;
    TotalCount: number;
    Pages: string;
}

export interface Mod {
    mod_id: number;
    mod_name: string;
    mod_submitter: string;
    mod_type: string;
    mod_image: string;
}


export const getMods = (page: number, filters: {
    category?: string,
    search?: string,
    sort?: 'desc' | 'asc',
}) => {
    const params = new URLSearchParams()
    params.set('modPages', page.toString())
    params.set('modPageSize', '25')
    if (filters.category)
        params.set('modType', filters.category.toString())
    if (filters.search)
        params.set('modName', filters.search)

    params.set('modSort', filters.sort ?? 'desc')
    return fetch(`https://celesteback.centralteam.cn/everest/searchMod?${params.toString()}`)
        .then(v => v.json())
        .then(v => v as SearchModResp)
}

export const getModFileId = (id: number) => {
    return fetch(`https://celesteback.centralteam.cn/everest/getModFileID?modID=${id}`)
        .then(v => v.json())
        .then(v => v.data as number)
}

