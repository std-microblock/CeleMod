module.exports = {
  entry: ['src'],
  exclude: [],
  output: ['src'],
  disableAutoTranslate: false,
  extractOnly: false,
  translator: null,
  ignoreComponents: [],
  ignoreMethods: [],
  primaryLocale: 'zh-CN',
  supportedLocales: ['zh-CN', 'en-US', 'pt-BR'
  // , 'de-DE', 'fr-FR', 'ru-RU'
  ],
  importCode: "import _i18n, { useI18N } from 'src/i18n';",
  i18nObject: '_i18n',
  i18nMethod: 't',
  prettier: { singleQuote: true, trailingComma: 'es5', endOfLine: 'lf' },
  localeConf: { type: 'file', folder: 'locales' },
};
