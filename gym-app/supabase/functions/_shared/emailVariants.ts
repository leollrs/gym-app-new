/**
 * COPIA GENERADA de src/lib/admin/emailVariants.js — NO EDITAR A MANO.
 *
 * El original es JS puro (sin DOM, sin dependencias, sin npm) precisamente para
 * que esta copia sea literal. Deno no puede importar desde `src/`, y la
 * alternativa —dos implementaciones escritas por separado— ya nos costó un dia
 * entero: la vista previa y el envio divergieron en la maqueta, en el
 * separador de seccion, en las vinetas, en los tokens y en el pie.
 *
 * SI TOCAS EL ORIGINAL:
 *   1. edita src/lib/admin/emailVariants.js
 *   2. `npm run sync:email-engine`  (scripts/sync-email-engine.mjs)
 *   3. `npx vitest run` — el test de contrato compara las dos copias byte a
 *      byte y falla si se separan.
 */
/* eslint-disable */
// @ts-nocheck

/**
 * Versiones en español e inglés de una misma plantilla de correo.
 *
 * El modelo es UNA plantilla con el texto en dos idiomas, no dos plantillas.
 * La maqueta, los colores, los enlaces, los interruptores, la foto de portada y
 * el código de recompensa son COMPARTIDOS a propósito: lo que se quiere es el
 * mismo correo en dos idiomas, no dos correos que se van separando. Duplicar la
 * plantilla entera habría dejado que la versión inglesa se quedara con la
 * maqueta vieja el día que alguien cambiara la española.
 *
 * Dónde vive: dentro de `template_data` (JSONB), sin columna nueva.
 *
 *   template_data = {
 *     …los campos de siempre  ← el idioma BASE
 *     lang: 'es',
 *     i18n: { en: { 'hero.headline': '…', 'body.text': '…' } }
 *   }
 *
 * Las plantillas que ya existen no se tocan: sin `lang` ni `i18n` son español
 * base sin traducir, que es exactamente lo que son hoy.
 *
 * Sin dependencias y sin DOM: el enviador (Deno) usa una copia literal de este
 * archivo, generada por `scripts/sync-email-engine.mjs`.
 */

export const LANGS = ['es', 'en'];

/**
 * Los campos que se traducen.
 *
 * Es una lista blanca, no «todo lo que sea texto». `cta.url`, `hero.imageUrl`,
 * `reward.code` y `colors.primary` también son cadenas y NO se traducen — tener
 * dos URLs o dos códigos por plantilla es una fuente de bugs, no una función.
 */
export const TEXT_PATHS = [
  'header.text',
  'hero.eyebrow',
  'hero.headline',
  'hero.subtitle',
  'body.text',
  'cta.text',
  'reward.label',
  'reward.title',
  'reward.description',
  'footer.text',
  'footer.unsubscribeText',
];

/** El idioma en el que están escritos los campos de siempre. */
export function baseLang(tpl) {
  return tpl && tpl.lang === 'en' ? 'en' : 'es';
}

export function otherLang(lang) {
  return lang === 'en' ? 'es' : 'en';
}

function readPath(obj, path) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length; i++) {
    if (o == null || typeof o !== 'object') return '';
    o = o[parts[i]];
  }
  return typeof o === 'string' ? o : '';
}

function writePath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[parts[parts.length - 1]] = value;
}

/** La ruta donde se guarda un campo cuando se edita en `lang`. */
export function pathFor(tpl, lang, path) {
  if (!TEXT_PATHS.includes(path)) return path;      // estructura: siempre al base
  if (lang === baseLang(tpl)) return path;
  return `i18n.${lang}.${path}`;
}

/**
 * La plantilla tal y como se lee en `lang`.
 *
 * Un campo vacío en la variante CAE al base. Media traducción tiene que salir
 * medio traducida y no medio en blanco: un titular vacío no es «pendiente de
 * traducir» para quien recibe el correo, es un correo roto.
 */
export function pickVariant(tpl, lang) {
  if (!tpl) return tpl;
  const want = lang === 'en' ? 'en' : 'es';
  if (want === baseLang(tpl)) return tpl;
  const over = (tpl.i18n && tpl.i18n[want]) || null;
  if (!over) return tpl;
  const out = JSON.parse(JSON.stringify(tpl));
  for (let i = 0; i < TEXT_PATHS.length; i++) {
    const p = TEXT_PATHS[i];
    const v = readPath(over, p);
    if (v && v.trim() !== '') writePath(out, p, v);
  }
  return out;
}

/**
 * Cuánto queda por traducir: cuántos de los campos CON TEXTO en el base tienen
 * ya su versión en `lang`. Los campos vacíos en el base no cuentan — no hay nada
 * que traducir ahí, y contarlos haría que una plantilla corta pareciera a medias
 * para siempre.
 */
export function variantProgress(tpl, lang) {
  const want = lang === 'en' ? 'en' : 'es';
  if (!tpl || want === baseLang(tpl)) return { filled: 0, total: 0, done: true };
  const over = (tpl.i18n && tpl.i18n[want]) || {};
  let total = 0;
  let filled = 0;
  for (let i = 0; i < TEXT_PATHS.length; i++) {
    const p = TEXT_PATHS[i];
    if (readPath(tpl, p).trim() === '') continue;
    total += 1;
    if (readPath(over, p).trim() !== '') filled += 1;
  }
  return { filled, total, done: total > 0 && filled === total };
}

/** Copia los textos del base a la variante, para empezar a traducir sobre algo. */
export function seedVariantFromBase(tpl, lang) {
  const want = lang === 'en' ? 'en' : 'es';
  if (!tpl || want === baseLang(tpl)) return tpl;
  const out = JSON.parse(JSON.stringify(tpl));
  if (!out.i18n || typeof out.i18n !== 'object') out.i18n = {};
  const over = out.i18n[want] && typeof out.i18n[want] === 'object' ? out.i18n[want] : {};
  for (let i = 0; i < TEXT_PATHS.length; i++) {
    const p = TEXT_PATHS[i];
    // Nunca pisa lo ya traducido.
    if (readPath(over, p).trim() !== '') continue;
    const v = readPath(tpl, p);
    if (v.trim() !== '') writePath(over, p, v);
  }
  out.i18n[want] = over;
  return out;
}
