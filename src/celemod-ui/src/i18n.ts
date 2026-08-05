import { useEffect, useMemo } from 'react';
import { useAppStore, useCurrentLang, useMirror } from './states';

import zhCN from 'locales/zh-CN.json';
import enUS from 'locales/en-US.json';
import ruRU from 'locales/ru-RU.json';
import frFR from 'locales/fr-FR.json';
import deDE from 'locales/de-DE.json';
import ptBR from 'locales/pt-BR.json';

const locales: Record<string, Record<string, string>> = {
  'zh-CN': zhCN, 'en-US': enUS, 'de-DE': deDE,
  'ru-RU': ruRU, 'fr-FR': frFR, 'pt-BR': ptBR,
};

let locale = 'zh-CN';

const i18n = {
  t(key: string, slots: Record<string, string | number> = {}) {
    const activeLocale = useAppStore.getState().currentLang || locale;
    let translated = locales[activeLocale]?.[key] ?? key;
    if (translated === '&&') translated = key;
    for (const [slot, value] of Object.entries(slots)) {
      translated = translated.replaceAll(`{${slot}}`, String(value));
    }
    return translated;
  },
  get currentLang() { return useAppStore.getState().currentLang || locale; },
};

export default i18n;

export const createI18NContext = () => {
  const { currentLang, setCurrentLang } = useCurrentLang();
  const [, setMirror] = useMirror();

  const api = useMemo(() => ({
    setLang(lang: string) {
      document.documentElement.lang = lang;
      locale = lang;
      setCurrentLang(lang);
    },
    currentLang,
  }), [currentLang, setCurrentLang]);

  useEffect(() => {
    if (currentLang) {
      api.setLang(currentLang);
      return;
    }
    const isChinese = navigator.language.toLowerCase().startsWith('zh');
    api.setLang(isChinese ? 'zh-CN' : 'en-US');
    setMirror(isChinese ? 'wegfan' : '0x0ade');
  }, []);

  return api;
};

export const useI18N = createI18NContext;
