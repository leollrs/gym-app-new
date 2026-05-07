import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Eagerly bundled namespaces — small (~70 KB raw across both languages
// combined) and needed before first paint for nav, auth, and onboarding.
import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';
import enAuth from './locales/en/auth.json';
import esAuth from './locales/es/auth.json';
import enOnboarding from './locales/en/onboarding.json';
import esOnboarding from './locales/es/onboarding.json';

// pages.json is the giant — 376 KB EN + 404 KB ES = ~780 KB raw / ~120-160 KB
// gzipped of strings. Eager-loading both locales doubled the i18n payload for
// every user. We detect the target language at boot, init i18next synchronously
// with the small namespaces, then hydrate `pages` for the detected locale via
// dynamic import. main.jsx awaits `i18nPrimaryReady` before rendering so the
// first paint already has localized strings.
const earlyLng = (() => {
  try {
    const stored = localStorage.getItem('i18nextLng');
    if (stored === 'es' || stored === 'en') return stored;
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('es') ? 'es' : 'en';
  } catch {
    return 'en';
  }
})();

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon, auth: enAuth, onboarding: enOnboarding },
      es: { common: esCommon, auth: esAuth, onboarding: esOnboarding },
    },
    lng: earlyLng,
    compatibilityJSON: 'v3',
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    defaultNS: 'common',
    ns: ['common', 'auth', 'onboarding', 'pages'],
    partialBundledLanguages: true,
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
  });

// Load primary locale's pages.json — main.jsx awaits this before rendering so
// no UI text flashes the raw key during the first frame.
const loadPrimaryPages = earlyLng === 'es'
  ? () => import('./locales/es/pages.json')
  : () => import('./locales/en/pages.json');

export const i18nPrimaryReady = loadPrimaryPages()
  .then((mod) => {
    i18n.addResourceBundle(earlyLng, 'pages', mod.default, true, true);
  })
  .catch(() => { /* fall through — t() will use defaultValue / key */ });

// Background-load the opposite locale's pages so language switching is fast.
// Fire-and-forget; explicit branches let Rollup analyze targets statically.
const loadSecondaryPages = earlyLng === 'es'
  ? () => import('./locales/en/pages.json').then((m) => ({ lng: 'en', mod: m }))
  : () => import('./locales/es/pages.json').then((m) => ({ lng: 'es', mod: m }));
loadSecondaryPages()
  .then(({ lng, mod }) => {
    i18n.addResourceBundle(lng, 'pages', mod.default, true, true);
  })
  .catch(() => {});

export default i18n;
