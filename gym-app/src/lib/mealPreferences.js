/**
 * Meal Preference Learning System
 *
 * Learns user food preferences from multiple signals:
 *   1. meal_ratings     — explicit thumbs up/down on suggested meals
 *   2. food_logs        — meals actually eaten (implicit positive)
 *   3. disliked_foods   — explicit ingredient dislikes
 *   4. favorite_foods   — explicit ingredient likes
 *
 * Builds per-ingredient affinity scores (-1 to +1) that feed into
 * the meal planner to personalize suggestions over time.
 */

import { supabase } from './supabase';
import { MEALS } from '../data/meals';

// ── Ingredient → Allergy / Dietary Restriction Mappings ─────

/** Ingredients that contain or are derived from common allergens */
export const ALLERGEN_MAP = {
  nuts: [
    'almonds', 'almond_butter', 'almond_flour', 'almond_milk',
    'walnuts', 'mixed_nuts', 'peanut_butter',
  ],
  shellfish: [
    'large_shrimp', 'shrimp', 'cooked_shrimp', 'pre_cooked_shrimp',
    'cocktail_sauce',
  ],
  dairy: [
    'milk', 'whole_milk', 'butter', 'cream', 'heavy_cream', 'cheese',
    'cheddar', 'cheddar_cheese', 'mozzarella', 'parmesan', 'feta',
    'feta_cheese', 'gruyere', 'gruyere_cheese', 'ricotta', 'ricotta_cheese',
    'cream_cheese', 'cream_cheese_light', 'greek_yogurt', 'yogurt',
    'whole_milk_yogurt', 'cottage_cheese', 'low_fat_cottage_cheese',
    'low_fat_cheese', 'american_cheese', 'double_cheddar', 'sour_cream',
    'whipped_cream', 'buttermilk', 'skyr', 'string_cheese', 'ice_cream',
    'coconut_yogurt', // NOT dairy — will be excluded below
  ],
  eggs: [
    'egg', 'eggs', 'egg_whites', 'egg_yolks', 'whole_eggs',
    'hard_boiled_eggs', 'fried_egg',
  ],
  soy: [
    'soy_sauce', 'tofu', 'firm_tofu', 'extra_firm_tofu', 'edamame',
    'frozen_edamame', 'miso_paste', 'white_miso',
  ],
  wheat: [
    'flour', 'breadcrumbs', 'pasta', 'spaghetti', 'fettuccine', 'macaroni',
    'whole_wheat_pasta', 'high_protein_pasta', 'noodles', 'udon_noodles',
    'soba_noodles', 'flour_tortilla', 'flour_tortillas', 'large_tortilla',
    'large_tortillas', 'whole_wheat_tortilla', 'whole_wheat_wrap', 'large_wrap',
    'whole_wheat_bread', 'whole_grain_bread', 'sourdough_bread', 'thick_bread',
    'toast', 'brioche_bread', 'crusty_bread', 'burger_bun', 'burger_buns',
    'english_muffin', 'bagel', 'whole_grain_bagel', 'sub_roll',
    'whole_grain_croutons', 'croutons', 'pizza_dough', 'lasagna_sheets',
    'waffle_mix', 'whole_wheat_biscuits', 'whole_grain_crackers',
    'whole_wheat_pita', 'large_pita', 'pita_bread', 'seasoned_flour',
    'oat_flour', // oats are technically gluten-free but often cross-contaminated
  ],
  fish: [
    'salmon', 'salmon_fillet', 'smoked_salmon', 'canned_salmon',
    'canned_tuna', 'tuna_steak', 'sushi_grade_tuna',
    'cod_fillet', 'tilapia_fillet', 'canned_mackerel', 'canned_sardines',
    'fish_sauce', 'dashi', 'dashi_stock',
  ],
};

// coconut_yogurt is plant-based, remove from dairy
ALLERGEN_MAP.dairy = ALLERGEN_MAP.dairy.filter(i => i !== 'coconut_yogurt');

/** Ingredients that violate dietary restrictions */
const MEAT_INGREDIENTS = [
  'chicken_breast', 'chicken_thigh', 'chicken_thighs', 'chicken_drumsticks',
  'chicken_broth', 'grilled_chicken_breast', 'rotisserie_chicken',
  'ground_chicken', 'canned_chicken', 'deli_turkey', 'turkey_breast',
  'turkey_breast_slices', 'turkey_slices', 'turkey_sausage', 'turkey_sausage_patty',
  'ground_turkey', 'lean_ground_beef', 'ground_beef', 'lean_beef', 'lean_beef_strips',
  'beef_strips', 'beef_broth', 'beef_jerky', 'sirloin_steak', 'sirloin_beef',
  'ribeye_steak', 'ground_pork', 'pork_tenderloin', 'pork_belly', 'pork_ribs',
  'pulled_pork', 'ground_lamb', 'lamb_mince', 'bacon', 'ham', 'pepperoni',
  'chorizo', 'pancetta', 'sausages', 'canadian_bacon', 'black_pudding',
];

const POULTRY_INGREDIENTS = [
  'chicken_breast', 'chicken_thigh', 'chicken_thighs', 'chicken_drumsticks',
  'chicken_broth', 'grilled_chicken_breast', 'rotisserie_chicken',
  'ground_chicken', 'canned_chicken', 'deli_turkey', 'turkey_breast',
  'turkey_breast_slices', 'turkey_slices', 'turkey_sausage', 'turkey_sausage_patty',
  'ground_turkey',
];

const RED_MEAT_INGREDIENTS = [
  'lean_ground_beef', 'ground_beef', 'lean_beef', 'lean_beef_strips',
  'beef_strips', 'beef_broth', 'beef_jerky', 'sirloin_steak', 'sirloin_beef',
  'ribeye_steak', 'ground_pork', 'pork_tenderloin', 'pork_belly', 'pork_ribs',
  'pulled_pork', 'ground_lamb', 'lamb_mince',
];

const SEAFOOD_INGREDIENTS = [
  ...ALLERGEN_MAP.fish,
  ...ALLERGEN_MAP.shellfish,
];

const HIGH_CARB_INGREDIENTS = [
  'rice', 'brown_rice', 'white_rice', 'wild_rice', 'basmati_rice', 'jasmine_rice',
  'cooked_rice', 'cooked_brown_rice', 'microwaveable_rice',
  'pasta', 'spaghetti', 'fettuccine', 'macaroni', 'whole_wheat_pasta', 'high_protein_pasta',
  'noodles', 'udon_noodles', 'soba_noodles', 'rice_noodles',
  'bread', 'whole_wheat_bread', 'whole_grain_bread', 'sourdough_bread',
  'toast', 'brioche_bread', 'crusty_bread', 'thick_bread',
  'tortilla', 'flour_tortilla', 'flour_tortillas', 'corn_tortillas',
  'whole_wheat_tortilla', 'whole_wheat_wrap', 'large_wrap', 'large_tortilla',
  'potato', 'potatoes', 'sweet_potato', 'russet_potato', 'large_potato', 'baby_potatoes',
  'mashed_potato', 'oats', 'rolled_oats', 'steel_cut_oats', 'granola', 'granola_light',
  'honey', 'maple_syrup', 'brown_sugar', 'sugar',
  'banana', 'ripe_banana', 'frozen_banana',
  'pizza_dough', 'lasagna_sheets', 'waffle_mix',
];

export const DIETARY_RESTRICTION_FILTERS = {
  vegan: (ingredients) =>
    ingredients.some(i =>
      MEAT_INGREDIENTS.includes(i) ||
      SEAFOOD_INGREDIENTS.includes(i) ||
      ALLERGEN_MAP.dairy.includes(i) ||
      ALLERGEN_MAP.eggs.includes(i) ||
      i === 'honey'
    ),
  vegetarian: (ingredients) =>
    ingredients.some(i =>
      MEAT_INGREDIENTS.includes(i) ||
      SEAFOOD_INGREDIENTS.includes(i)
    ),
  pescatarian: (ingredients) =>
    ingredients.some(i => MEAT_INGREDIENTS.includes(i)),
  keto: (ingredients) =>
    ingredients.filter(i => HIGH_CARB_INGREDIENTS.includes(i)).length >= 2,
  gluten_free: (ingredients) =>
    ingredients.some(i => ALLERGEN_MAP.wheat.includes(i)),
  dairy_free: (ingredients) =>
    ingredients.some(i => ALLERGEN_MAP.dairy.includes(i)),
  halal: (ingredients) =>
    ingredients.some(i =>
      ['bacon', 'ham', 'pork_tenderloin', 'pork_belly', 'pork_ribs',
       'pulled_pork', 'ground_pork', 'pancetta', 'pepperoni',
       'black_pudding', 'chorizo'].includes(i)
    ),
};

// ── Core Preference Engine ──────────────────────────────────

/**
 * Check if a meal violates any of the user's allergies.
 * Returns true if the meal is SAFE (no allergens).
 */
export function isMealAllergenSafe(meal, allergies = []) {
  if (!allergies.length) return true;
  const ingredients = meal.ingredients || [];
  for (const allergy of allergies) {
    const allergenIngredients = ALLERGEN_MAP[allergy] || [];
    if (ingredients.some(i => allergenIngredients.includes(i))) return false;
  }
  return true;
}

/**
 * Check if a meal respects the user's dietary restrictions.
 * Returns true if the meal is COMPLIANT.
 */
export function isMealDietaryCompliant(meal, restrictions = []) {
  if (!restrictions.length) return true;
  const ingredients = meal.ingredients || [];
  for (const restriction of restrictions) {
    const violates = DIETARY_RESTRICTION_FILTERS[restriction];
    if (violates && violates(ingredients)) return false;
  }
  return true;
}

/**
 * Score a meal based on learned ingredient affinities.
 * Returns a value from -1 (avoid) to +1 (highly preferred).
 * Meals with disliked ingredients get a strong negative score.
 */
export function scoreByPreference(meal, affinities = {}) {
  const ingredients = meal.ingredients || [];
  if (!ingredients.length || !Object.keys(affinities).length) return 0;

  let totalScore = 0;
  let matchCount = 0;

  for (const ingredient of ingredients) {
    if (affinities[ingredient] !== undefined) {
      const aff = affinities[ingredient];
      // Strong negatives are deal-breakers — amplify them
      if (aff.score < -0.5) return -1;
      totalScore += aff.score * Math.min(aff.sampleCount / 3, 1); // confidence weighting
      matchCount++;
    }
  }

  if (matchCount === 0) return 0;
  return Math.max(-1, Math.min(1, totalScore / matchCount));
}

/**
 * Calculate grocery overlap score between a candidate meal and existing plan meals.
 * Higher score = more ingredient sharing = fewer unique items to buy.
 * Returns 0-1.
 */
export function groceryOverlapScore(candidateMeal, planMeals) {
  if (!planMeals.length) return 0;
  const candidateIngredients = new Set(candidateMeal.ingredients || []);
  if (!candidateIngredients.size) return 0;

  // Collect all ingredients already in the plan
  const planIngredients = new Set();
  for (const m of planMeals) {
    (m.ingredients || []).forEach(i => planIngredients.add(i));
  }

  // Count how many of the candidate's ingredients are already in the plan
  let overlap = 0;
  for (const ing of candidateIngredients) {
    if (planIngredients.has(ing)) overlap++;
  }

  return overlap / candidateIngredients.size;
}

// ── Affinity Learning (builds scores from user history) ─────

/**
 * Rebuild ingredient affinities from all available signals.
 * Call this periodically (e.g. after a meal rating, once per session).
 *
 * Signals and weights:
 *   meal_ratings  +1/-1  × 0.40 (strongest — explicit)
 *   food_logs     +1     × 0.25 (ate it = liked it)
 *   disliked_foods -1    × 0.50 (explicit avoid — strongest negative)
 *   favorite_foods +1    × 0.30 (explicit positive)
 *
 * Time decay: interactions older than 30 days get 0.5× weight.
 */
export async function rebuildAffinities(profileId, gymId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all signals in parallel
  const [ratingsRes, logsRes, dislikedRes, favoritesRes] = await Promise.all([
    supabase
      .from('meal_ratings')
      .select('meal_id, rating, created_at')
      .eq('profile_id', profileId),
    supabase
      .from('food_logs')
      .select('meal_id, created_at')
      .eq('profile_id', profileId)
      .not('meal_id', 'is', null),
    supabase
      .from('disliked_foods')
      .select('food_name')
      .eq('profile_id', profileId),
    supabase
      .from('favorite_foods')
      .select('food_name')
      .eq('profile_id', profileId),
  ]);

  // Build meal ID → meal lookup
  const mealMap = {};
  for (const m of MEALS) mealMap[m.id] = m;

  // Accumulate per-ingredient scores
  const ingredientScores = {}; // { ingredient: { total: 0, count: 0 } }

  const addScore = (ingredient, score, weight) => {
    if (!ingredientScores[ingredient]) {
      ingredientScores[ingredient] = { total: 0, count: 0 };
    }
    ingredientScores[ingredient].total += score * weight;
    ingredientScores[ingredient].count += 1;
  };

  // 1. Meal ratings (explicit likes/dislikes on suggested meals)
  if (ratingsRes.data) {
    for (const r of ratingsRes.data) {
      const meal = mealMap[r.meal_id];
      if (!meal?.ingredients) continue;
      const decay = r.created_at >= thirtyDaysAgo ? 1 : 0.5;
      for (const ing of meal.ingredients) {
        addScore(ing, r.rating, 0.40 * decay);
      }
    }
  }

  // 2. Food logs (ate it = positive signal)
  if (logsRes.data) {
    for (const log of logsRes.data) {
      const meal = mealMap[log.meal_id];
      if (!meal?.ingredients) continue;
      const decay = log.created_at >= thirtyDaysAgo ? 1 : 0.5;
      for (const ing of meal.ingredients) {
        addScore(ing, 1, 0.25 * decay);
      }
    }
  }

  // 3. Disliked foods (strong negative)
  if (dislikedRes.data) {
    for (const d of dislikedRes.data) {
      addScore(d.food_name, -1, 0.50);
    }
  }

  // 4. Favorite foods (positive)
  if (favoritesRes.data) {
    for (const f of favoritesRes.data) {
      addScore(f.food_name, 1, 0.30);
    }
  }

  // Normalize to -1..+1 and upsert
  const rows = Object.entries(ingredientScores).map(([ingredient, data]) => ({
    profile_id: profileId,
    gym_id: gymId,
    ingredient,
    score: Math.max(-1, Math.min(1, data.total / Math.max(data.count, 1))),
    sample_count: data.count,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    await supabase
      .from('ingredient_affinities')
      .upsert(rows, { onConflict: 'profile_id,ingredient' });
  }

  return rows;
}

/**
 * Load cached affinities as a simple { ingredient: { score, sampleCount } } map.
 */
export async function loadAffinities(profileId) {
  const { data } = await supabase
    .from('ingredient_affinities')
    .select('ingredient, score, sample_count')
    .eq('profile_id', profileId);

  if (!data) return {};
  const map = {};
  for (const row of data) {
    map[row.ingredient] = { score: row.score, sampleCount: row.sample_count };
  }
  return map;
}

/**
 * Rate a meal (thumbs up/down). Triggers affinity rebuild.
 */
export async function rateMeal(profileId, gymId, mealId, rating) {
  await supabase
    .from('meal_ratings')
    .upsert({
      profile_id: profileId,
      gym_id: gymId,
      meal_id: mealId,
      rating,
    }, { onConflict: 'profile_id,meal_id' });

  // Rebuild in background (don't await)
  rebuildAffinities(profileId, gymId).catch(() => {});
}

/**
 * Get all meals filtered and scored for a user.
 * Combines allergy safety, dietary compliance, and preference scoring.
 */
export function getPersonalizedMeals({ allergies = [], restrictions = [], affinities = {} }) {
  return MEALS
    .filter(m => isMealAllergenSafe(m, allergies))
    .filter(m => isMealDietaryCompliant(m, restrictions))
    .map(m => ({
      meal: m,
      preferenceScore: scoreByPreference(m, affinities),
    }))
    .sort((a, b) => b.preferenceScore - a.preferenceScore);
}
