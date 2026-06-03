// Structured member-name helpers shared by the invite / add-member modals.
//
// We collect names in parts (first · middle · last · second last — the PR/Latin
// convention of two apellidos) for cleaner data entry, then compose a single
// `full_name` for storage (profiles uses one `full_name` column).
//
// Validation: a name part may only contain letters (any script, including
// accented characters via combining marks), spaces, hyphens and apostrophes.
// Digits, emoji, and other symbols are rejected.

// Must start with a letter, then letters/marks/space/hyphen/apostrophe.
const NAME_PART_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s'’-]*$/u;

/**
 * @param {string} s
 * @param {{ required?: boolean }} [opts]
 * @returns {boolean} true if valid (empty optional parts pass)
 */
export function isValidNamePart(s, { required = false } = {}) {
  const v = (s || '').trim();
  if (!v) return !required;
  return NAME_PART_RE.test(v);
}

/**
 * Compose the four parts into a single display/full name.
 * @param {{ first?: string, middle?: string, last?: string, second?: string }} parts
 * @returns {string}
 */
export function composeFullName({ first = '', middle = '', last = '', second = '' } = {}) {
  return [first, middle, last, second]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Best-effort split of a stored `full_name` back into parts for structured
 * editing of existing members. Token order is preserved across the four
 * buckets, so re-composing an untouched split reproduces the original string
 * exactly (no data loss if the admin doesn't edit). PR/Latin convention is
 * assumed for 3 tokens (given name + two apellidos); the admin can correct any
 * mis-bucketing before saving.
 * @param {string} full
 * @returns {{ first: string, middle: string, last: string, second: string }}
 */
export function splitFullName(full) {
  const tokens = (full || '').trim().split(/\s+/).filter(Boolean);
  const n = tokens.length;
  if (n === 0) return { first: '', middle: '', last: '', second: '' };
  if (n === 1) return { first: tokens[0], middle: '', last: '', second: '' };
  if (n === 2) return { first: tokens[0], middle: '', last: tokens[1], second: '' };
  if (n === 3) return { first: tokens[0], middle: '', last: tokens[1], second: tokens[2] };
  return {
    first: tokens[0],
    middle: tokens.slice(1, n - 2).join(' '),
    last: tokens[n - 2],
    second: tokens[n - 1],
  };
}

/**
 * Whether the parts are valid for submission: first + last are required and
 * valid; middle + second last are optional but must be valid when present.
 */
export function areNamePartsValid(parts = {}) {
  return (
    isValidNamePart(parts.first, { required: true }) &&
    isValidNamePart(parts.last, { required: true }) &&
    isValidNamePart(parts.middle) &&
    isValidNamePart(parts.second)
  );
}
