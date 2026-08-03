/**
 * nameCase.js — title-case a person's name without mangling it.
 *
 * `test` → `Test`. That is the easy half. The half that matters for this
 * market is not flattening Puerto Rican and Spanish names on the way:
 *
 *   maria de los angeles rivera del valle  →  María is not ours to add, but
 *                                             "de los" and "del" must stay
 *                                             lowercase, not become "De Los".
 *   o'brien        → O'Brien      (not O'brien)
 *   mcdonald       → McDonald
 *   jean-luc       → Jean-Luc
 *   JOSÉ           → José         (all-caps input is the common paste case)
 *
 * Deliberately NOT normalised: accents (they are part of the name), and any
 * word the member typed with an internal capital already — `DeLeon`, `MacKay`,
 * `van der Berg` as `Van` — because a member who capitalised it themselves
 * meant it. We only ever fix a word that is entirely one case.
 */

// Spanish/Portuguese connectives. Lowercase when they sit INSIDE the name;
// a name that begins with one (rare, but "Del Valle" as a first surname does
// happen) still gets its capital because position wins.
const PARTICLES = new Set([
  'de', 'del', 'la', 'las', 'lo', 'los', 'y', 'e', 'da', 'das', 'do', 'dos',
  'van', 'von', 'der', 'den', 'di', 'du', 'el',
]);

/** Capitalise the first letter, lowercase the rest. Unicode-aware. */
const cap = (w) => w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase();

/** True when the word is all-upper or all-lower — i.e. the member did not case it. */
const isUncased = (w) => w === w.toLocaleLowerCase() || w === w.toLocaleUpperCase();

function caseWord(word, index) {
  if (!word) return word;
  // Leave anything the member cased themselves exactly as typed.
  if (!isUncased(word)) return word;

  const lower = word.toLocaleLowerCase();
  if (index > 0 && PARTICLES.has(lower)) return lower;

  // Split on the separators that carry their own capital, and case each part.
  // The separators are kept so `jean-luc` → `Jean-Luc` and `o'brien` → `O'Brien`.
  let out = lower.split(/([-'’])/).map((part) => {
    if (part === '-' || part === "'" || part === '’') return part;
    if (!part) return part;
    // A single letter before an apostrophe is a prefix (d'Angelo, O'Brien):
    // capitalise the part AFTER it too, which the map already does.
    return cap(part);
  }).join('');

  // Mc takes a second capital: mcdonald → McDonald.
  // There is deliberately NO Mac rule. It would turn `machado` → `MacHado` and
  // `macario` → `MacArio`, and in this market those names are far commoner than
  // MacKay. Someone who wants MacKay types the K, and the self-cased check at
  // the top of this function then leaves it alone.
  out = out.replace(/^(Mc)([a-zà-ÿ])/, (_, p, c) => p + c.toLocaleUpperCase());

  return out;
}

/**
 * Title-case one name field (a first name, a surname, a full name).
 * Collapses runs of whitespace; returns '' for empty/nullish input.
 *
 * @param {string} raw
 * @returns {string}
 */
export function titleCaseName(raw) {
  if (raw === null || raw === undefined) return '';
  const words = String(raw).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.map(caseWord).join(' ');
}

export default titleCaseName;
