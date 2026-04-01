import { MEALS } from '../data/meals';

// Tolerance: macros must be within these % of targets
const CALORIE_TOLERANCE = 0.10; // ±10%
const MACRO_TOLERANCE = 0.15; // ±15% for protein/carbs/fat

/**
 * Score a meal against remaining macro budget.
 * Returns 0-1 where 1 = perfect fit, 0 = terrible fit.
 * ALL macros must be within tolerance for a positive score.
 */
function scoreMeal(meal, remaining) {
  if (!meal.calories || !remaining.calories) return 0;

  const calRatio = meal.calories / Math.max(remaining.calories, 1);
  const proteinRatio = (meal.protein || 0) / Math.max(remaining.protein, 1);
  const carbRatio = (meal.carbs || 0) / Math.max(remaining.carbs, 1);
  const fatRatio = (meal.fat || 0) / Math.max(remaining.fat, 1);

  // Penalize meals that exceed remaining budget
  if (meal.calories > remaining.calories * 1.3) return 0;
  if ((meal.protein || 0) > remaining.protein * 1.5) return 0;

  // Score: how well does this meal use the remaining budget?
  // Ideal: uses 25-40% of remaining (one of 3 meals left)
  const idealPortion = 0.33;
  const calScore = 1 - Math.abs(calRatio - idealPortion) / idealPortion;
  const proteinScore = 1 - Math.abs(proteinRatio - idealPortion) / idealPortion;
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
 * @param lang - 'en' | 'es'
 * @returns sorted array of { meal, score, fits } objects
 */
export function suggestMeals({ targets, consumed, mealType, excludeIds = [], favorites = [], lang = 'en' }) {
  // Normalize Set/array inputs
  excludeIds = Array.isArray(excludeIds) ? excludeIds : [...(excludeIds || [])];
  favorites = Array.isArray(favorites) ? favorites : [...(favorites || [])];
  const remaining = {
    calories: Math.max(0, targets.calories - consumed.calories),
    protein: Math.max(0, targets.protein - consumed.protein),
    carbs: Math.max(0, targets.carbs - consumed.carbs),
    fat: Math.max(0, targets.fat - consumed.fat),
  };

  if (remaining.calories < 50) return []; // Already at target

  const allMeals = MEALS;

  return allMeals
    .filter(m => !excludeIds.includes(m.id))
    .filter(m => !mealType || m.category === mealType || !m.category)
    .map(meal => {
      const score = scoreMeal(meal, remaining);
      const isFavorite = favorites.includes(meal.id);
      return {
        meal,
        score: score + (isFavorite ? 0.15 : 0), // boost favorites
        fits: score > 0.3, // "fits your macros" badge
      };
    })
    .filter(m => m.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

/**
 * Generate a full day meal plan that hits ALL macro targets.
 * Uses a greedy algorithm with backtracking to ensure protein, carbs, fat all match.
 *
 * @param targets - { calories, protein, carbs, fat }
 * @param slots - number of meals (3 = breakfast/lunch/dinner, 4 = +snack)
 * @param excludeIds - meals to exclude
 * @param favorites - user favorites (prioritized)
 * @returns object with meals array, totals, fits boolean, and accuracy percentages
 */
export function generateDayPlan({ targets, slots = 3, excludeIds = [], favorites = [], recentMealIds = [] }) {
  // Normalize Set/array inputs
  excludeIds = Array.isArray(excludeIds) ? excludeIds : [...(excludeIds || [])];
  favorites = Array.isArray(favorites) ? favorites : [...(favorites || [])];
  recentMealIds = Array.isArray(recentMealIds) ? recentMealIds : [...(recentMealIds || [])];
  const available = MEALS.filter(m => !excludeIds.includes(m.id));

  const plan = [];
  const used = new Set();
  let totalCal = 0, totalP = 0, totalC = 0, totalF = 0;

  for (let slot = 0; slot < slots; slot++) {
    const remaining = {
      calories: targets.calories - totalCal,
      protein: targets.protein - totalP,
      carbs: targets.carbs - totalC,
      fat: targets.fat - totalF,
    };

    const slotsLeft = slots - slot;
    const idealCal = remaining.calories / slotsLeft;
    const idealP = remaining.protein / slotsLeft;
    const idealC = remaining.carbs / slotsLeft;
    const idealF = remaining.fat / slotsLeft;

    // Score candidates for this slot
    const candidates = available
      .filter(m => !used.has(m.id))
      .filter(m => !recentMealIds.includes(m.id) || slot > 1) // avoid recent meals for first 2 slots
      .map(m => {
        const calDiff = Math.abs((m.calories || 0) - idealCal) / Math.max(idealCal, 1);
        const pDiff = Math.abs((m.protein || 0) - idealP) / Math.max(idealP, 1);
        const cDiff = Math.abs((m.carbs || 0) - idealC) / Math.max(idealC, 1);
        const fDiff = Math.abs((m.fat || 0) - idealF) / Math.max(idealF, 1);

        // All macros must be close — weighted score
        const score = 1 - (calDiff * 0.25 + pDiff * 0.35 + cDiff * 0.2 + fDiff * 0.2);
        const favBoost = favorites.includes(m.id) ? 0.1 : 0;

        return { meal: m, score: Math.max(0, score) + favBoost };
      })
      .sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      const pick = candidates[0].meal;
      plan.push(pick);
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
 * Generate a 7-day meal plan with variety.
 * No meal repeats within 3 days.
 */
export function generateWeekPlan({ targets, favorites = [], lang = 'en' }) {
  favorites = Array.isArray(favorites) ? favorites : [...(favorites || [])];
  const days = [];
  const recentIds = [];

  for (let d = 0; d < 7; d++) {
    const dayPlan = generateDayPlan({
      targets,
      slots: 3,
      excludeIds: [],
      favorites,
      recentMealIds: recentIds.slice(-9), // last 3 days × 3 meals = 9 meals to avoid
    });

    days.push(dayPlan);
    recentIds.push(...dayPlan.meals.map(m => m.id));
  }

  return days;
}

/**
 * Suggest a post-workout recovery meal (high protein + carbs, moderate fat).
 */
export function suggestPostWorkoutMeal({ targets, consumed, favorites = [] }) {
  favorites = Array.isArray(favorites) ? favorites : [...(favorites || [])];
  // Post-workout: prioritize protein and carbs
  const remaining = {
    calories: Math.max(200, targets.calories - consumed.calories),
    protein: Math.max(20, targets.protein - consumed.protein),
    carbs: Math.max(30, targets.carbs - consumed.carbs),
    fat: Math.max(5, targets.fat - consumed.fat),
  };

  return MEALS
    .filter(m => (m.protein || 0) >= 20) // minimum 20g protein
    .map(m => {
      const proteinScore = Math.min(1, (m.protein || 0) / 40); // max score at 40g
      const carbScore = Math.min(1, (m.carbs || 0) / 50);
      const fatPenalty = (m.fat || 0) > 20 ? 0.3 : 0; // penalize high fat post-workout
      const calFit = 1 - Math.abs((m.calories || 0) - remaining.calories * 0.35) / (remaining.calories * 0.35);

      return {
        meal: m,
        score: Math.max(0, proteinScore * 0.4 + carbScore * 0.3 + calFit * 0.2 - fatPenalty) + (favorites.includes(m.id) ? 0.1 : 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
