// Normalize a trainer_meal_plans `meals` value into a week-keyed structure and
// resolve which week a member is currently on. This is the bridge that lets a
// trainer meal plan hold DISTINCT meals per week (parity with the workout
// program) while every older plan keeps working.
//
// Storage shapes handled (backward compatible):
//   • NEW multi-week: { "1": [ {day, meals, totals}, … ], "2": [ … ] }
//   • legacy flat:    [ {day, meals, totals}, … ]   (one week, repeated)
//   • very old flat:  [ {id, title, …}, … ]         (a bare meal array = one day)
//
// A "day" = { day:Number, meals:[meal], totals:{calories,protein,carbs,fat} }.

const WEEK_MS = 7 * 86400000;

export function dayTotals(meals) {
  return (meals || []).reduce((a, m) => ({
    calories: a.calories + (Number(m?.calories) || 0),
    protein: a.protein + (Number(m?.protein) || 0),
    carbs: a.carbs + (Number(m?.carbs) || 0),
    fat: a.fat + (Number(m?.fat) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function coerceDays(arr) {
  if (!Array.isArray(arr)) return [];
  // A bare meal array (no day wrappers) → treat as a single day.
  if (arr.length > 0 && !Array.isArray(arr[0]?.meals) && (arr[0]?.id != null || arr[0]?.title)) {
    return [{ day: 1, meals: arr, totals: dayTotals(arr) }];
  }
  return arr.map((d, i) => ({
    day: d?.day ?? i + 1,
    meals: Array.isArray(d?.meals) ? d.meals : [],
    totals: d?.totals || dayTotals(d?.meals || []),
  }));
}

/**
 * Normalize into a week-keyed structure.
 * @param {object|array} mealsOrPlan - a plan row, or its `meals` value directly
 * @returns {{ weeks: Record<string, Array>, weekKeys: string[] }}
 */
export function mealPlanWeeks(mealsOrPlan) {
  const m = (mealsOrPlan && typeof mealsOrPlan === 'object' && !Array.isArray(mealsOrPlan) && 'meals' in mealsOrPlan)
    ? mealsOrPlan.meals
    : mealsOrPlan;
  if (m && !Array.isArray(m) && typeof m === 'object') {
    const weekKeys = Object.keys(m).filter((k) => Array.isArray(m[k])).sort((a, b) => Number(a) - Number(b));
    if (weekKeys.length) {
      const weeks = {};
      weekKeys.forEach((k) => { weeks[k] = coerceDays(m[k]); });
      return { weeks, weekKeys };
    }
  }
  return { weeks: { 1: coerceDays(Array.isArray(m) ? m : []) }, weekKeys: ['1'] };
}

/** Which week key the member is currently on, from the plan's start/created date. */
export function currentMealWeekKey(plan, weekKeys) {
  const keys = weekKeys || mealPlanWeeks(plan).weekKeys;
  if (keys.length <= 1) return keys[0] || '1';
  const start = plan?.start_date ? new Date(`${plan.start_date}T00:00:00`)
    : (plan?.created_at ? new Date(plan.created_at) : null);
  if (!start || isNaN(start.getTime())) return keys[0] || '1';
  const wk = Math.floor((Date.now() - start.getTime()) / WEEK_MS) + 1;
  const idx = Math.max(1, Math.min(keys.length, wk)) - 1;
  return keys[idx] || keys[0];
}

/** Strip UI-only fields off one meal and normalize numbers for storage. */
export function serializeMeal(m) {
  return {
    id: m.id ?? null,
    slotType: m.slotType || m.slot || 'meal',
    title: m.title || '',
    title_es: m.title_es || null,
    calories: Math.round(Number(m.calories) || 0),
    protein: Math.round(Number(m.protein) || 0),
    carbs: Math.round(Number(m.carbs) || 0),
    fat: Math.round(Number(m.fat) || 0),
    category: m.category || null,
    prepTime: m.prepTime ?? m.prep_time ?? null,
    time: m.time || null,
    notes: m.notes || null,
    image: m.image || null,
  };
}

/** Serialize the editor's week map back to the stored week-keyed shape. */
export function serializeMealWeeks(weeks) {
  const out = {};
  Object.keys(weeks || {}).sort((a, b) => Number(a) - Number(b)).forEach((k) => {
    out[k] = (weeks[k] || []).map((d, i) => ({
      day: i + 1,
      meals: (d.meals || []).map(serializeMeal),
      totals: dayTotals(d.meals || []),
    }));
  });
  return out;
}
