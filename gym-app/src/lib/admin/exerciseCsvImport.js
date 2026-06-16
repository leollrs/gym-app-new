/**
 * CSV parsing + row validation for the platform-level GLOBAL exercise bulk
 * import (Platform Settings → Content tab). Reuses the generic parseCSV from
 * csvImport.js (UTF-8/BOM, quoted fields, CRLF) and layers exercise-specific
 * column rules + enum validation on top.
 *
 * WHY validate enums client-side: muscle_group / equipment / category are
 * Postgres enum columns (0001 + 0044 + 0247). A single bad value would raise
 * 22P02 (invalid_input_value) and abort the WHOLE batch insert — so a typo in
 * row 50 silently loses rows 1–49. We bucket bad rows out up front and only
 * insert the clean ones, surfacing per-row reasons in the preview.
 *
 * The enum arrays below are DUPLICATED from PlatformSettings.jsx (MUSCLE_GROUPS
 * ~L40, EQUIPMENT ~L47, EXERCISE_CATEGORIES ~L1368) on purpose: importing them
 * from the page component would create a circular import (the page imports this
 * lib). Keep them in sync if the page's enums ever change.
 */

import { parseCSV } from './csvImport';

// Canonical exercise_category enum (0001). Optional column → defaults to
// 'Strength' when blank.
export const EXERCISE_CATEGORIES = ['Strength', 'Hypertrophy', 'Power', 'Endurance', 'Mobility'];

// Canonical muscle_group enum (0001 + 0044 Forearms/Traps + 0247 Warm-Up).
const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Traps',
  'Legs', 'Glutes', 'Core', 'Calves', 'Full Body', 'Warm-Up',
];

// Canonical equipment_type enum (0001 + 0044 EZ Bar).
const EQUIPMENT = [
  'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight',
  'Kettlebell', 'Resistance Band', 'Smith Machine', 'EZ Bar',
];

// Canonical CSV column set. Order doesn't matter — parseCSV keys rows by
// lower-cased header name.
export const EXERCISE_CSV_COLUMNS = [
  'name',
  'muscle_group',
  'equipment',
  'category',
  'default_sets',
  'default_reps',
  'instructions',
];

// Header columns that MUST be present. (parseCSV checks csvImport's own
// REQUIRED_COLUMNS, which are for the member import — so we don't rely on its
// header check here; we validate required VALUES per row in validateExerciseRow
// and required HEADERS via missingRequiredColumns below.)
export const REQUIRED = ['name', 'muscle_group', 'equipment'];

/**
 * Case-insensitive match of a raw cell against an enum list, returning the
 * canonical value (correct casing) or null if it isn't a member. Also tolerates
 * stray internal whitespace so "full  body" → "Full Body". REJECTS unknowns —
 * a bad enum would 22P02 the whole batch.
 */
function canonicalize(raw, allowed) {
  const norm = String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!norm) return null;
  return allowed.find((v) => v.toLowerCase() === norm) || null;
}

/**
 * Given the parsed headers, return any REQUIRED columns missing from the
 * header row (so the modal can warn about a malformed file before showing a
 * per-row table that would mark every row invalid).
 */
export function missingRequiredColumns(headers) {
  const present = (headers || []).map((h) => String(h).trim().toLowerCase());
  return REQUIRED.filter((c) => !present.includes(c));
}

/**
 * Validate + normalize a single parsed row. Returns either
 *   { ok: true, value: <insert-ready partial> }  — canonical enum values
 * or
 *   { ok: false, reason: <string> }              — human-readable skip reason
 *
 * The returned `value` is the column subset this lib owns (name, enums, the
 * numeric/text defaults, instructions). The caller stamps id/gym_id/is_active.
 */
export function validateExerciseRow(row) {
  const name = String(row.name || '').trim();
  if (!name) return { ok: false, reason: 'Missing name' };

  const muscle_group = canonicalize(row.muscle_group, MUSCLE_GROUPS);
  if (!muscle_group) {
    return { ok: false, reason: `Invalid muscle_group: "${String(row.muscle_group || '').trim() || '(empty)'}"` };
  }

  const equipment = canonicalize(row.equipment, EQUIPMENT);
  if (!equipment) {
    return { ok: false, reason: `Invalid equipment: "${String(row.equipment || '').trim() || '(empty)'}"` };
  }

  // category is optional → defaults to 'Strength'. If provided it must be a
  // valid enum member (a bad value would 22P02 the batch).
  const rawCategory = String(row.category || '').trim();
  let category = 'Strength';
  if (rawCategory) {
    const matched = canonicalize(rawCategory, EXERCISE_CATEGORIES);
    if (!matched) return { ok: false, reason: `Invalid category: "${rawCategory}"` };
    category = matched;
  }

  // default_sets optional → 3. Must be a positive integer if present.
  const rawSets = String(row.default_sets || '').trim();
  let default_sets = 3;
  if (rawSets) {
    const n = Number(rawSets);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, reason: `Invalid default_sets: "${rawSets}"` };
    }
    default_sets = Math.round(n);
  }

  // default_reps optional → '10'. Kept as TEXT (column supports "5", "8-10",
  // "60s", "12 each") so we don't coerce to a number.
  const default_reps = String(row.default_reps || '').trim() || '10';

  const instructions = String(row.instructions || '').trim() || null;

  return {
    ok: true,
    value: { name, muscle_group, equipment, category, default_sets, default_reps, instructions },
  };
}

/**
 * Bucket parsed rows into import-ready vs skipped.
 *   - ready:   array of validated `value` objects (caller stamps id/gym_id…)
 *   - skipped: array of { row, reason } with the ORIGINAL row for the preview
 *
 * `line` (1-based, +1 header) is attached so the preview can say "Row N".
 */
export function bucketExerciseRows(rows) {
  const ready = [];
  const skipped = [];
  (rows || []).forEach((row, i) => {
    const result = validateExerciseRow(row);
    if (result.ok) {
      ready.push(result.value);
    } else {
      skipped.push({ row, line: i + 2, reason: result.reason });
    }
  });
  return { ready, skipped };
}

// Re-export parseCSV so callers can do a single import from this module.
export { parseCSV };
