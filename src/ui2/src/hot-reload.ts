import { sleep } from "../../ui/src/utils";

export const startHotReload = async (checkPaths = ['', '/../index.js']) => {
    const fetchUrls = async () => {
        const arr = [];
        for (const path of checkPaths)
            arr.push(fetch(location.href + path).then(v => v.text()))

        return await Promise.all(arr);
    }
    const resources = await fetchUrls();
    while(1){
        await sleep(300);
        const newResources = await fetchUrls();
        if (newResources.some((v, i) => v !== resources[i])) {
            location.reload();
            break;
        }
    }
}