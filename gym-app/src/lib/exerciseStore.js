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
//
// ── WHY THE SEED IMPORT BELOW IS STILL STATIC (measured 2026-07-26) ──────────
// It costs every user 191 KB raw / ~33 KB gz inside the EAGER entry chunk
// (js/index-*.js, 1085 KB raw), on first paint, even if they never open the
// library — and App.jsx:1459 swaps it for the DB copy seconds later. Three
// eager modules pull this store into that chunk:
//     lib/readinessEngine.js:50   (via pages/Dashboard.jsx:42)
//     lib/untrainedSuggestions.js:16 (via components/ReadinessModal.jsx:46)
//     lib/volumeLandmarks.js:24   (via components/WeeklyVolumeSection.jsx:12)
//
// Turning this into `await import('../data/exercises')` DOES NOT WORK TODAY.
// 19 modules call getExercises() at MODULE SCOPE and keep the returned array
// forever, so an async seed hands them a permanently-empty list — not a race,
// a hard break. The two eager ones fail silently and permanently: the Recovery
// modal's "Bring these up" picks and the weekly MEV/MAV/MRV volume assessment
// would both report nothing, with no error. The other 17:
//   pages/QuickStart.jsx:11, pages/Workouts.jsx:25, pages/ActiveSession.jsx:30,
//   pages/Equipment.jsx:6, pages/WorkoutBuilder.jsx:12,
//   pages/active-session/ExerciseCard.jsx:7, pages/trainer/TrainerClientDetail.jsx:29,
//   pages/trainer/components/ClientProgramEditor.jsx:24,
//   components/GenerateWorkoutModal.jsx:13, components/MemberProgramBuilder.jsx:8,
//   lib/workoutGenerator.js:8, lib/programGenerator.js:7, lib/wodGenerator.js:13,
//   lib/adaptiveWorkout.js:13, lib/personalProgramService.js:15,
//   lib/sessionExerciseSuggestions.js:18, lib/readinessEngine.js:51
//
// ORDER OF WORK for whoever picks this up: (1) convert all 19 module-scope
// snapshots to call-time reads (`getExercises()` inside the function, or
// useExercises() in components — hooks/useContentStores.js already wires
// subscribeExercises for that), (2) THEN make this a dynamic import. Doing (2)
// first ships a silent data-loss bug. There is no partial version of this that
// helps: leaving even one eager importer keeps data/exercises.js in the entry
// chunk, which is why cutting readinessEngine's edge alone was not attempted.
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
 *
 * NOTE: there is deliberately NO Supabase realtime subscription on `exercises`,
 * and `subscribeExercises` above is a purely in-memory pub/sub, not a DB
 * channel. The table is not a member of the `supabase_realtime` publication
 * (verified in production: challenge_prizes, earned_rewards, notifications,
 * reward_redemptions, session_cues, session_drafts), so a `postgres_changes`
 * binding here would never fire — and publishing tables broadly is a deliberate
 * cost decision (an estimated ~17.3M realtime messages/month from one
 * 2,000-member gym against a 5M/month plan allowance). This library changes on
 * the order of once per release, so boot hydration (App.jsx calls
 * hydrateExercisesFromDb once, post-auth) is the correct and only refresh path.
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
