import { MEALS } from '../data/meals';
import {
  isMealAllergenSafe,
  isMealDietaryCompliant,
  scoreByPreference,
  groceryOverlapScore,
} from './mealPreferences';

// Tolerance: macros must be within these % of targets
const CALORIE_TOLERANCE = 0.10; // ±10%
const MACRO_TOLERANCE = 0.15; // ±15% for protein/carbs/fat

// ── Meal-time slots ──────────────────────────────────────────────────────────
// The catalog has ONE time-of-day category: 'breakfast' (35 meals) — the rest
// are program categories (high_protein, fat_loss, …). Generation used to be
// type-blind, which produced "smoked salmon with broccoli" in the 7am slot.
// Slot rules:
//   breakfast → breakfast-category dishes only
//   lunch/dinner → anything EXCEPT breakfast dishes
//   snack → light + fast (≤400 kcal, ≤15 min prep), any category
export function slotTypesFor(slots) {
  if (slots === 1) return ['lunch'];
  if (slots === 2) return ['lunch', 'dinner'];
  if (slots === 3) return ['breakfast', 'lunch', 'dinner'];
  if (slots === 4) return ['breakfast', 'lunch', 'snack', 'dinner'];
  // 5+: extra snacks between lunch and dinner
  return ['breakfast', 'lunch', ...Array(slots - 3).fill('snack'), 'dinner'];
}

export function mealFitsSlot(meal, slotKey) {
  if (!slotKey) return true;
  if (slotKey === 'breakfast') return meal.category === 'breakfast';
  if (slotKey === 'snack') return (meal.calories || 0) <= 400 && (meal.prepTime || 99) <= 15;
  // lunch / dinner: any real meal that isn't a breakfast dish
  return meal.category !== 'breakfast';
}

// Realistic calorie distribution across the day (normalized over the slots
// actually present, so totals still hit the daily target).
const SLOT_SHARE = { breakfast: 0.28, lunch: 0.34, dinner: 0.38, snack: 0.14 };

/**
 * Get the filtered meal pool based on user restrictions.
 * This is the single entry point — all functions use this.
 */
function getFilteredMeals({ allergies = [], restrictions = [], excludeIds = [], avoidIngredients = [] }) {
  const avoidSet = new Set(avoidIngredients);
  return MEALS
    .filter(m => !excludeIds.includes(m.id))
    .filter(m => isMealAllergenSafe(m, allergies))
    .filter(m => isMealDietaryCompliant(m, restrictions))
    // Explicit "foods to avoid" (disliked ingredients) are a HARD exclude —
    // same rule onboarding's "available meals" count uses, so the two agree.
    .filter(m => avoidSet.size === 0 || !(m.ingredients || []).some(i => avoidSet.has(i)));
}

/**
 * Score a meal against remaining macro budget.
 * Returns 0-1 where 1 = perfect fit, 0 = terrible fit.
 * ALL macros must be within tolerance for a positive score.
 */
function scoreMeal(meal, remaining) {
  if (!meal.calories || !remaining.calories) return 0;

  const calRatio = meal.calories / Math.max(remaining.calories, 1);
  const proteinRatio = (meal.protein || 0) / Math.max(remaining.protein, 1);

  // Penalize meals that exceed remaining budget
  if (meal.calories > remaining.calories * 1.3) return 0;
  if ((meal.protein || 0) > remaining.protein * 1.5) return 0;

  // Score: how well does this meal use the remaining budget?
  // Ideal: uses 25-40% of remaining (one of 3 meals left)
  const idealPortion = 0.33;
  const calScore = 1 - Math.abs(calRatio - idealPortion) / idealPortion;
  const proteinScore = 1 - Math.abs(proteinRatio - idealPortion) / idealPortion;
  const carbRatio = (meal.carbs || 0) / Math.max(remaining.carbs, 1);
  const fatRatio = (meal.fat || 0) / Math.max(remaining.fat, 1);
  const carbScore = 1 - Math.abs(carbRatio - idealPortion) / idealPortion;
  const fatScore = 1 - Math.abs(fatRatio - idealPortion) / idealPortion;

  // Protein weighted higher (most important macro for gym-goers)
  return Math.max(0, calScore * 0.3 + proteinScore * 0.35 + carbScore * 0.2 + fatScore * 0.15);
}

/**
 * Suggest meals for the rest of the day based on remaining macros.
 * @param targets - { calories, protein, carbs, fat } daily targets
 * @param consumed - { calories, protein, carbs, fat } already eaten today
 * @param mealType - 'breakfast' | 'lunch' | 'dinner' | 'snack' | null (any)
 * @param excludeIds - meal IDs already eaten today
 * @param favorites - user's favorited meal IDs (prioritized)
 * @param allergies - user's food allergies
 * @param restrictions - user's dietary restrictions
 * @param affinities - learned ingredient affinities { ingredient: { score, sampleCount } }
 * @param lang - 'en' | 'es'
 * @returns sorted array of { meal, score, fits } objects
 */
export function suggestMeals({
  targets, consumed, mealType, excludeIds = [], favorites = [],
  allergies = [], restrictions = [], avoidIngredients = [], affinities = {}, lang = 'en',
}) {
  excludeIds = Array.isArray(excludeIds) ? excludeIds : [...(excludeIds || [])];
  favorites = Array.isArray(favorites) ? favorites : [...(favorites || [])];
  const remaining = {
    calories: Math.max(0, targets.calories - consumed.calories),
    protein: Math.max(0, targets.protein - consumed.protein),
    carbs: Math.max(0, targets.carbs - consumed.carbs),
    fat: Math.max(0, targets.fat - consumed.fat),
  };

  if (remaining.calories < 50) return []; // Already at target

  const pool = getFilteredMeals({ allergies, restrictions, excludeIds, avoidIngredients });

  // Slot-aware: only meals that fit the requested meal time. (The old check
  // compared against `category`, which only ever matched 'breakfast' — lunch/
  // dinner/snack requests silently returned nothing.)
  return pool
    .filter(m => mealFitsSlot(m, mealType))
    .map(meal => {
      const macroScore = scoreMeal(meal, remaining);
      const isFavorite = favorites.includes(meal.id);
      const prefScore = scoreByPreference(meal, affinities);
      return {
        meal,
        score: macroScore + (isFavorite ? 0.15 : 0) + prefScore * 0.15,
        fits: macroScore > 0.3,
      };
    })
    .filter(m => m.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

/**
 * Generate a full day meal plan that hits ALL macro targets.
 * Uses a greedy algorithm with preference and grocery overlap scoring.
 *
 * @param targets - { calories, protein, carbs, fat }
 * @param slots - number of meals (3 = breakfast/lunch/dinner, 4 = +snack)
 * @param excludeIds - meals to exclude
 * @param favorites - user favorites (prioritized)
 * @param recentMealIds - recently eaten meal IDs (for variety)
 * @param allergies - user's food allergies
 * @param restrictions - user's dietary restrictions
 * @param affinities - learned ingredient affinities
 * @param planMealsSoFar - meals already in the weekly plan (for grocery overlap)
 * @returns object with meals array, totals, fits boolean, and accuracy percentages
 */
export function generateDayPlan({
  targets, slots = 3, slotTypes = null, excludeIds = [], favorites = [], recentMealIds = [],
  allergies = [], restrictions = [], avoidIngredients = [], affinities = {}, planMealsSoFar = [],
}) {
  excludeIds = Array.isArray(excludeIds) ? excludeIds : [...(excludeIds || [])];
  favorites = Array.isArray(favorites) ? favorites : [...(favorites || [])];
  recentMealIds = Array.isArray(recentMealIds) ? recentMealIds : [...(recentMealIds || [])];

  const available = getFilteredMeals({ allergies, restrictions, excludeIds, avoidIngredients });

  // One meal-time key per slot — callers with named slots (the weekly planner
  // filling only "dinner", a trainer swapping a "snack") pass slotTypes
  // explicitly; everyone else gets the standard day shape.
  const types = (Array.isArray(slotTypes) && slotTypes.length === slots)
    ? slotTypes
    : slotTypesFor(slots);

  const plan = [];
  const used = new Set();
  let totalCal = 0, totalP = 0, totalC = 0, totalF = 0;

  for (let slot = 0; slot < slots; slot++) {
    const slotKey = types[slot] || null;
    const remaining = {
      calories: targets.calories - totalCal,
      protein: targets.protein - totalP,
      carbs: targets.carbs - totalC,
      fat: targets.fat - totalF,
    };

    // Weight the remaining budget by realistic meal-time shares (breakfast
    // lighter, dinner heavier) instead of an equal split — normalized over
    // the slots still to fill so the day total stays on target.
    const remainingKeys = types.slice(slot);
    const slotsLeft = slots - slot;
    const shareSum = remainingKeys.reduce((s, k) => s + (SLOT_SHARE[k] || 1 / slots), 0);
    const myShare = shareSum > 0 ? (SLOT_SHARE[slotKey] || 1 / slots) / shareSum : 1 / slotsLeft;
    const idealCal = remaining.calories * myShare;
    const idealP = remaining.protein * myShare;
    const idealC = remaining.carbs * myShare;
    const idealF = remaining.fat * myShare;

    // Score candidates for this slot. `recentMealIds` is now enforced for ALL
    // slots (was previously only slots 0-1), with a graceful fallback below if
    // the strict pool is empty — this prevents "same meal every day" when the
    // top-scored meal would otherwise repeat at slot 2+.
    const recentSet = new Set(recentMealIds);
    const scoreOf = (m) => {
      const calDiff = Math.abs((m.calories || 0) - idealCal) / Math.max(idealCal, 1);
      const pDiff = Math.abs((m.protein || 0) - idealP) / Math.max(idealP, 1);
      const cDiff = Math.abs((m.carbs || 0) - idealC) / Math.max(idealC, 1);
      const fDiff = Math.abs((m.fat || 0) - idealF) / Math.max(idealF, 1);
      const macroScore = 1 - (calDiff * 0.25 + pDiff * 0.35 + cDiff * 0.2 + fDiff * 0.2);
      const prefBoost = scoreByPreference(m, affinities) * 0.15;
      const favBoost = favorites.includes(m.id) ? 0.1 : 0;
      const allPlanMeals = [...planMealsSoFar, ...plan];
      const groceryBoost = allPlanMeals.length > 0
        ? groceryOverlapScore(m, allPlanMeals) * 0.08
        : 0;
      // Small random jitter so two consecutive regenerations don't pick the
      // exact same top meal when scores are near-tied. Deliberately small —
      // doesn't override macro fit, just breaks ties.
      const jitter = (Math.random() - 0.5) * 0.08;
      return Math.max(0, macroScore) + prefBoost + favBoost + groceryBoost + jitter;
    };

    const baseUnused = available.filter(m => !used.has(m.id));
    // Slot-appropriate pool first — breakfast dishes at breakfast, no salmon
    // at 7am. Degrade gracefully if filters empty the pool (tiny catalogs
    // after heavy allergy/restriction filtering).
    const slotPool = baseUnused.filter(m => mealFitsSlot(m, slotKey));
    const pool = slotPool.length > 0 ? slotPool : baseUnused;
    let candidates = pool
      .filter(m => !recentSet.has(m.id))
      .map(m => ({ meal: m, score: scoreOf(m) }))
      .sort((a, b) => b.score - a.score);

    // Fallback: if the strict (non-recent) pool is empty, allow recent meals
    // back in rather than producing an empty slot.
    if (candidates.length === 0) {
      candidates = pool
        .map(m => ({ meal: m, score: scoreOf(m) }))
        .sort((a, b) => b.score - a.score);
    }

    if (candidates.length > 0) {
      // Pick randomly among the top N candidates instead of always #1.
      // With 300 meals in the pool, this guarantees real variation across
      // regenerations and across days within a week, while still keeping
      // the picks among the best macro fits.
      const TOP_N = Math.min(8, candidates.length);
      const idx = Math.floor(Math.random() * TOP_N);
      const pick = candidates[idx].meal;
      // Tag the pick with its meal-time so every consumer (member plan view,
      // onboarding preview, trainer plans) labels it from DATA, not index.
      plan.push({ ...pick, slot: slotKey });
      used.add(pick.id);
      totalCal += pick.calories || 0;
      totalP += pick.protein || 0;
      totalC += pick.carbs || 0;
      totalF += pick.fat || 0;
    }
  }

  // Validate the full plan
  const calOk = Math.abs(totalCal - targets.calories) / targets.calories <= CALORIE_TOLERANCE;
  const pOk = Math.abs(totalP - targets.protein) / Math.max(targets.protein, 1) <= MACRO_TOLERANCE;
  const cOk = Math.abs(totalC - targets.carbs) / Math.max(targets.carbs, 1) <= MACRO_TOLERANCE;
  const fOk = Math.abs(totalF - targets.fat) / Math.max(targets.fat, 1) <= MACRO_TOLERANCE;

  return {
    meals: plan,
    totals: { calories: totalCal, protein: totalP, carbs: totalC, fat: totalF },
    fits: calOk && pOk && cOk && fOk,
    accuracy: {
      calories: Math.round((1 - Math.abs(totalCal - targets.calories) / targets.calories) * 100),
      protein: Math.round((1 - Math.abs(totalP - targets.protein) / Math.max(targets.protein, 1)) * 100),
      carbs: Math.round((1 - Math.abs(totalC - targets.carbs) / Math.max(targets.carbs, 1)) * 100),
      fat: Math.round((1 - Math.abs(totalF - targets.fat) / Math.max(targets.fat, 1)) * 100),
    },
  };
}

/**
 * Generate a 7-day meal plan with variety + preference learning + grocery optimization.
 * No meal repeats within 3 days.
 */
export function generateWeekPlan({
  targets, slots = 3, favorites = [], allergies = [], restrictions = [], avoidIngredients = [], affinities = {}, lang = 'en',
}) {
  favorites = Array.isArray(favorites) ? favorites : [...(favorites || [])];
  const days = [];
  const recentIds = [];
  const allPlanMeals = []; // accumulate for grocery overlap scoring

  for (let d = 0; d < 7; d++) {
    const dayPlan = generateDayPlan({
      targets,
      slots,
      excludeIds: [],
      favorites,
      // Penalize ALL meals already used earlier in the week so days don't
      // repeat each other. The graceful fallback in generateDayPlan will
      // relax this if the meal pool is too small.
      recentMealIds: recentIds.slice(),
      allergies,
      restrictions,
      avoidIngredients,
      affinities,
      planMealsSoFar: allPlanMeals,
    });

    days.push(dayPlan);
    recentIds.push(...dayPlan.meals.map(m => m.id));
    allPlanMeals.push(...dayPlan.meals);
  }

  return days;
}

/**
 * Suggest a post-workout recovery meal (high protein + carbs, moderate fat).
 */
export function suggestPostWorkoutMeal({
  targets, consumed, favorites = [], allergies = [], restrictions = [], avoidIngredients = [], affinities = {},
}) {
  favorites = Array.isArray(favorites) ? favorites : [...(favorites || [])];
  const remaining = {
    calories: Math.max(200, targets.calories - consumed.calories),
    protein: Math.max(20, targets.protein - consumed.protein),
    carbs: Math.max(30, targets.carbs - consumed.carbs),
    fat: Math.max(5, targets.fat - consumed.fat),
  };

  const pool = getFilteredMeals({ allergies, restrictions, avoidIngredients });

  return pool
    .filter(m => (m.protein || 0) >= 20)
    .map(m => {
      const proteinScore = Math.min(1, (m.protein || 0) / 40);
      const carbScore = Math.min(1, (m.carbs || 0) / 50);
      const fatPenalty = (m.fat || 0) > 20 ? 0.3 : 0;
      const calFit = 1 - Math.abs((m.calories || 0) - remaining.calories * 0.35) / (remaining.calories * 0.35);
      const prefBoost = scoreByPreference(m, affinities) * 0.1;

      return {
        meal: m,
        score: Math.max(0, proteinScore * 0.4 + carbScore * 0.3 + calFit * 0.2 - fatPenalty + prefBoost)
          + (favorites.includes(m.id) ? 0.1 : 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
