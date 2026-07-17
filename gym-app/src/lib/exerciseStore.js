// In-memory exercise store — the single read-path for the whole app.
//
// Seeded from the bundled static library (the SAFE FLOOR — generation can never
// see an empty list, works offline/pre-fetch, identical to today's behavior),
// then optionally refreshed from the DB (the live source of truth, incl. admin
// edits) via hydrateExercisesFromDb() at app boot. Consumers call getExercises()
// / getExerciseById() so they transparently follow DB updates once hydrated.
//
// This is the "DB-source now, keep safe seed" step: the static array in
// data/exercises.js stays bundled as the seed; deleting it (the real weight win)
// is a post-cruise follow-up once DB hydration is proven in production.

import { exercises as STATIC_EXERCISES } from '../data/exercises';
import { cachedHydrate } from './libraryCache';

let _list = STATIC_EXERCISES;
let _byId = new Map(STATIC_EXERCISES.map((e) => [e.id, e]));
let _hydrated = false;
const _subs = new Set();

/** Current exercise library (DB copy once hydrated, else the static seed). */
export function getExercises() { return _list; }

/**
 * Subscribe to library replacements (i.e. DB hydration). Returns an unsubscribe.
 * Powers useExercises() so counts/lists re-render the moment the DB copy lands —
 * this is what makes "edit the DB → the app's numbers change" work without an
 * app rebuild (on the next cold start the seed is swapped for the live table).
 */
export function subscribeExercises(cb) { _subs.add(cb); return () => _subs.delete(cb); }
function _notifyExercises() { for (const cb of _subs) { try { cb(_list); } catch { /* isolate */ } } }

/** Lookup by id across the current library. */
export function getExerciseById(id) { return id ? (_byId.get(id) || null) : null; }

/** True once the DB copy has replaced the seed. */
export function exercisesHydrated() { return _hydrated; }

/**
 * Replace the store with a fresh set. DEFENSIVE: ignores an empty, too-small, or
 * malformed payload, so a failed/partial DB fetch can never clobber the static
 * floor — the app keeps working on the seed.
 */
export function setExercises(list) {
  if (!Array.isArray(list) || list.length < 50) return false;
  if (!list.every((e) => e && e.id && e.muscle && e.equipment)) return false;
  _list = list;
  _byId = new Map(list.map((e) => [e.id, e]));
  _hydrated = true;
  _notifyExercises();
  return true;
}

/** Map a DB `exercises` row → the in-app exercise shape the generators expect. */
export function mapDbExercise(row) {
  return {
    id: row.id,
    name: row.name,
    name_es: row.name_es,
    muscle: row.muscle_group,
    equipment: row.equipment,
    category: row.category,
    defaultSets: row.default_sets,
    defaultReps: row.default_reps,
    restSeconds: row.rest_seconds,
    instructions: row.instructions,
    instructions_es: row.instructions_es,
    primaryRegions: row.primary_regions || [],
    secondaryRegions: row.secondary_regions || [],
    muscleScores: row.muscle_scores || {},
    movementPattern: row.movement_pattern,
    videoUrl: row.video_url || undefined,
    station: row.station || undefined,
  };
}

/**
 * Fetch the global exercise library from the DB and refresh the store. Best-effort:
 * any error or thin result leaves the static seed intact. Call once at app boot
 * (post-auth). Takes the supabase client to avoid a hard import dependency here.
 */
export async function hydrateExercisesFromDb(supabase) {
  return cachedHydrate({
    supabase,
    cacheKey: 'tugympr.lib.exercises.v1',
    version: 1,
    table: 'exercises',
    columns: 'id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, instructions_es, primary_regions, secondary_regions, video_url, muscle_scores, movement_pattern, station',
    applyFilter: (q) => q.is('gym_id', null).eq('is_active', true),
    map: (rows) => rows.map(mapDbExercise),
    commit: (list) => setExercises(list),
  });
}
