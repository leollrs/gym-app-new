import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Eagerly bundled namespaces (common is needed immediately)
import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';
import enAuth from './locales/en/auth.json';
import esAuth from './locales/es/auth.json';
import enOnboarding from './locales/en/onboarding.json';
import esOnboarding from './locales/es/onboarding.json';
import enPages from './locales/en/pages.json';
import esPages from './locales/es/pages.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        onboarding: enOnboarding,
        pages: enPages,
      },
      es: {
        common: esCommon,
        auth: esAuth,
        onboarding: esOnboarding,
        pages: esPages,
      },
    },
    compatibilityJSON: 'v3',
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    defaultNS: 'common',
    ns: ['common', 'auth', 'onboarding', 'pages'],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
  });

export default i18n;
