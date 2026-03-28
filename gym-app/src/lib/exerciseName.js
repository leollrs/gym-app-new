import i18n from 'i18next';

/**
 * Returns the localized exercise name.
 * Uses `name_es` when the app language is Spanish and the field exists,
 * otherwise falls back to the default `name`.
 */
export const exName = (ex) =>
  i18n.language === 'es' && ex?.name_es ? ex.name_es : ex?.name;

export const exInstructions = (ex) =>
  i18n.language === 'es' && ex?.instructions_es ? ex.instructions_es : ex?.instructions;
