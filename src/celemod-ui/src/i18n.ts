import zhCN from 'locales/zh-CN.json';
import enUS from 'locales/en-US.json';
import { createContext } from 'preact';
import { useContext, useReducer } from 'preact/hooks';
import { useCurrentLang, useStorage } from './states';
import { useEffect, useMemo } from 'react';

const locales = {
    'zh-CN': zhCN,
    'en-US': enUS,
};

let locale = 'zh-CN';

export default {
    t(key: string, slots = {}) {
        console.log(locale, key, slots)
        let translated = locales[locale]?.[key] ?? key;
        for (const k in slots) {
            translated = translated.replaceAll(`{${k}}`, slots[k]);
        }
        return translated;
    }
}

export const I18NContext = createContext<
    ReturnType<typeof createI18NContext>
>({} as any)

export const useI18N = () => {
    useCurrentLang();
    return useContext(I18NContext);
}

export const createI18NContext = () => {
    const { currentLang, setCurrentLang } = useCurrentLang();
    const { storage, save } = useStorage();

    const ctx = useMemo(() => ({
        setLang(lang: string) {
            console.log('set lang', lang)
            locale = lang;
            storage.root ??= {};
            storage.root.lang = lang;
            save()
            setCurrentLang(lang);
        },
        currentLang
    }), [currentLang, storage])

    useEffect(() => {
        if (storage?.root?.lang)
            ctx.setLang(storage.root.lang);
    }, [storage]);

    return ctx;
}