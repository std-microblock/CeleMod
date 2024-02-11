import zhCN from 'locales/zh-CN.json';
import enUS from 'locales/en-US.json';

const locales = {
    'zh-CN': zhCN,
    'en-US': enUS,
};

export default {
    t(key: string, slots = {}) {
        let translated = enUS[key] ?? key;
        for (const k in slots) {
            translated = translated.replaceAll(`{${k}}`, slots[k]);
        }
        return translated;
    }
}