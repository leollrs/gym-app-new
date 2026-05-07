/**
 * Gendered translation helper.
 *
 * Usage:
 *   import { tg } from '../lib/genderText';
 *   tg(t, 'achievements.streak_7.label')
 *   // → looks up 'achievements.streak_7.label_female' if user is female,
 *   //   falls back to 'achievements.streak_7.label' if no female variant exists
 *
 * Sex is cached in localStorage during onboarding.
 * For users who onboarded before this feature, defaults to the base (male) key.
 */

let cachedSex = null;

function getUserSex() {
  if (cachedSex) return cachedSex;
  try {
    cachedSex = localStorage.getItem('tugympr_user_sex') || 'male';
  } catch {
    cachedSex = 'male';
  }
  return cachedSex;
}

/** Clear cached sex (call if user changes it in settings) */
export function resetSexCache() {
  cachedSex = null;
}

/**
 * Return a gendered translation. If the user is female, tries key + '_female' first.
 * Falls back to the base key if no female variant exists.
 */
export function tg(t, key, options) {
  const sex = getUserSex();
  if (sex === 'female') {
    const femaleKey = `${key}_female`;
    const result = t(femaleKey, { ...options, defaultValue: '__MISS__' });
    if (result !== '__MISS__') return result;
  }
  return t(key, options);
}
