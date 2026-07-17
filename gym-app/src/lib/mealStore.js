// In-memory meal/recipe store — the read-path for the meal planner + Nutrition.
// Seeded from the bundled static library (the SAFE FLOOR), refreshed from the DB
// (`meals` table, migration 0623) at app boot. Mirrors exerciseStore.js. The
// static array in data/meals.js stays bundled as the seed; deleting it (the real
// weight win) is a post-cruise follow-up once DB hydration is proven in prod.

import { MEALS as STATIC_MEALS } from '../data/meals';
import { cachedHydrate } from './libraryCache';

let _list = STATIC_MEALS;
let _hydrated = false;
const _subs = new Set();

// id → bundled-seed image path. The remade recipe photos live in the bucket;
// migration 0631 backfills the DB `meals.image` pointers (702 rows are still
// NULL until it runs, and the library cache can lag a further TTL). Until the
// DB copy carries every image, this seed map is the floor so a recipe's picture
// still renders — for the ~300 seeded recipes AND for any stale localStorage
// plan snapshot that was saved before its meal had an image.
const _seedImageById = new Map(
  (STATIC_MEALS || []).filter((m) => m && m.id && m.image).map((m) => [m.id, m.image])
);

/** Current recipe library (DB copy once hydrated, else the static seed). */
export function getMeals() { return _list; }

// Cache the live id→image map, rebuilt only when the underlying list identity
// changes (i.e. on DB hydration), so repeated lookups during a plan render stay
// O(1) instead of re-scanning ~1000 rows each call.
let _liveImgMap = null;
let _liveImgMapRef = null;
/**
 * Best available image path for a recipe id: the live library's image first
 * (DB once hydrated), then the bundled seed. Returns null only when neither
 * source has an image (a DB-only recipe still awaiting its 0631 pointer).
 * Lets render sites recover an image even when a saved snapshot stored none.
 */
export function mealImageById(id) {
  if (!id) return null;
  if (_liveImgMapRef !== _list) {
    _liveImgMap = new Map();
    for (const m of _list) { if (m?.id && m.image) _liveImgMap.set(m.id, m.image); }
    _liveImgMapRef = _list;
  }
  return _liveImgMap.get(id) || _seedImageById.get(id) || null;
}

/** True once the DB copy has replaced the seed. */
export function mealsHydrated() { return _hydrated; }

/**
 * Subscribe to library replacements (DB hydration). Returns an unsubscribe.
 * Powers useMeals() so recipe counts/lists re-render when the DB copy lands —
 * DB edits surface on the next cold start with no app rebuild.
 */
export function subscribeMeals(cb) { _subs.add(cb); return () => _subs.delete(cb); }
function _notifyMeals() { for (const cb of _subs) { try { cb(_list); } catch { /* isolate */ } } }

/** Replace the store. DEFENSIVE: ignores empty/too-small/malformed payloads. */
export function setMeals(list) {
  if (!Array.isArray(list) || list.length < 50) return false;
  if (!list.every((m) => m && m.id && m.title && m.category)) return false;
  _list = list;
  _hydrated = true;
  _notifyMeals();
  return true;
}

/** Map a DB `meals` row → the in-app recipe shape (only prep_time → prepTime differs). */
export function mapDbMeal(row) {
  return {
    id: row.id,
    title: row.title,
    title_es: row.title_es,
    // Seed floor for the ~300 bundled recipes whose DB pointer is still NULL
    // pre-0631, so their card image renders without waiting on the migration.
    image: row.image || _seedImageById.get(row.id) || null,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    prepTime: row.prep_time,
    tag: row.tag,
    tag_es: row.tag_es,
    category: row.category,
    difficulty: row.difficulty,
    difficulty_es: row.difficulty_es,
    serves: row.serves,
    ingredients: row.ingredients || [],
    ingredientAmounts: row.ingredient_amounts || [],
    steps: row.steps || [],
    steps_es: row.steps_es || [],
  };
}

/**
 * Best-effort DB refresh; a failure/thin result leaves the static seed intact.
 * Cached in localStorage and gated behind a cheap row-count probe (see
 * libraryCache.js), so the full ~1 MB recipe pull only happens when the library
 * actually changes — not on every app open.
 */
export async function hydrateMealsFromDb(supabase) {
  return cachedHydrate({
    supabase,
    cacheKey: 'tugympr.lib.meals.v1',
    version: 4, // bumped: 0631 remade recipe images (all ~1002 repointed) — force a cache refresh
    table: 'meals',
    columns: 'id, title, title_es, image, calories, protein, carbs, fat, prep_time, tag, tag_es, category, difficulty, difficulty_es, serves, ingredients, ingredient_amounts, steps, steps_es',
    applyFilter: (q) => q.eq('is_active', true),
    map: (rows) => rows.map(mapDbMeal),
    commit: (list) => setMeals(list),
  });
}
