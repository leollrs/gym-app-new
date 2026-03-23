/**
 * Meal Plan Generator v2 — Template-based
 * Uses pre-built real meal combos, scales portions to hit macro targets.
 */
import { getFoodImage } from './foodImages';

// ═══════════════════════════════════════════════════════════
// MEAL TEMPLATES — Real meals people actually eat
// Each item: { pattern: "food name search", servings: default, role: 'protein'|'carb'|'veggie'|'fruit'|'fat'|'cooking' }
// ═══════════════════════════════════════════════════════════

const BREAKFAST_TEMPLATES = [
  {
    name: 'Eggs, Toast & Banana',
    items: [
      { pattern: 'Egg (whole', servings: 3, role: 'protein' },
      { pattern: 'Bread', servings: 2, role: 'carb' },
      { pattern: 'Banana', servings: 1, role: 'fruit' },
      { pattern: 'Butter', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Oatmeal Power Bowl',
    items: [
      { pattern: 'Oatmeal', servings: 1, role: 'carb' },
      { pattern: 'Peanut Butter', servings: 1, role: 'fat' },
      { pattern: 'Banana', servings: 1, role: 'fruit' },
      { pattern: 'Milk', servings: 0.5, role: 'protein' },
    ],
  },
  {
    name: 'Greek Yogurt Parfait',
    items: [
      { pattern: 'Greek Yogurt', servings: 1, role: 'protein' },
      { pattern: 'Blueberries', servings: 1, role: 'fruit' },
      { pattern: 'Almonds', servings: 0.5, role: 'fat' },
      { pattern: 'Honey', servings: 1, role: 'carb' },
    ],
  },
  {
    name: 'Egg White Avocado Toast',
    items: [
      { pattern: 'Egg White', servings: 4, role: 'protein' },
      { pattern: 'Bread — Whole Wheat', servings: 2, role: 'carb' },
      { pattern: 'Avocado', servings: 1, role: 'fat' },
    ],
  },
  {
    name: 'Protein Shake & Banana',
    items: [
      { pattern: 'Whey Protein', servings: 1, role: 'protein' },
      { pattern: 'Banana', servings: 1, role: 'fruit' },
      { pattern: 'Milk', servings: 1, role: 'carb' },
    ],
  },
  {
    name: 'Pancakes, Eggs & Bacon',
    items: [
      { pattern: 'Pancake', servings: 1, role: 'carb' },
      { pattern: 'Egg (whole', servings: 2, role: 'protein' },
      { pattern: 'Bacon', servings: 1, role: 'fat' },
    ],
  },
  {
    name: 'Overnight Oats & Berries',
    items: [
      { pattern: 'Oatmeal', servings: 1, role: 'carb' },
      { pattern: 'Greek Yogurt', servings: 0.5, role: 'protein' },
      { pattern: 'Strawberries', servings: 1, role: 'fruit' },
      { pattern: 'Honey', servings: 1, role: 'fat' },
    ],
  },
  {
    name: 'Avena Boricua',
    items: [
      { pattern: 'Avena', servings: 1, role: 'carb' },
      { pattern: 'Pan Sobao', servings: 1, role: 'carb' },
      { pattern: 'Egg (whole', servings: 2, role: 'protein' },
    ],
  },
  {
    name: 'Huevos con Pan y Queso',
    items: [
      { pattern: 'Egg (whole', servings: 3, role: 'protein' },
      { pattern: 'Pan Sobao', servings: 2, role: 'carb' },
      { pattern: 'Cheese', servings: 1, role: 'fat' },
    ],
  },
  {
    name: 'Cottage Cheese & Fruit Bowl',
    items: [
      { pattern: 'Cottage Cheese', servings: 1, role: 'protein' },
      { pattern: 'Banana', servings: 1, role: 'fruit' },
      { pattern: 'Almonds', servings: 0.5, role: 'fat' },
    ],
  },
  {
    name: 'Egg McMuffin Style',
    items: [
      { pattern: 'Egg (whole', servings: 2, role: 'protein' },
      { pattern: 'English Muffin', servings: 1, role: 'carb' },
      { pattern: 'Cheese', servings: 1, role: 'fat' },
      { pattern: 'Apple', servings: 1, role: 'fruit' },
    ],
  },
  {
    name: 'Protein Oats',
    items: [
      { pattern: 'Oatmeal', servings: 1, role: 'carb' },
      { pattern: 'Whey Protein', servings: 1, role: 'protein' },
      { pattern: 'Peanut Butter', servings: 0.5, role: 'fat' },
    ],
  },
];

const LUNCH_TEMPLATES = [
  {
    name: 'Chicken, Rice & Broccoli',
    items: [
      { pattern: 'Chicken Breast', servings: 1.5, role: 'protein' },
      { pattern: 'White Rice', servings: 1, role: 'carb' },
      { pattern: 'Broccoli', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Turkey Sandwich & Fruit',
    items: [
      { pattern: 'Turkey Breast (deli)', servings: 3, role: 'protein' },
      { pattern: 'Bread — Whole Wheat', servings: 2, role: 'carb' },
      { pattern: 'Apple', servings: 1, role: 'fruit' },
      { pattern: 'Cheese', servings: 1, role: 'fat' },
    ],
  },
  {
    name: 'Steak & Sweet Potato',
    items: [
      { pattern: 'Steak — Sirloin', servings: 1.5, role: 'protein' },
      { pattern: 'Sweet Potato', servings: 1, role: 'carb' },
      { pattern: 'Mixed Salad', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Salmon & Quinoa',
    items: [
      { pattern: 'Salmon', servings: 1.5, role: 'protein' },
      { pattern: 'Quinoa', servings: 1, role: 'carb' },
      { pattern: 'Asparagus', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Tuna Salad',
    items: [
      { pattern: 'Tuna', servings: 1.5, role: 'protein' },
      { pattern: 'Mixed Salad', servings: 2, role: 'veggie' },
      { pattern: 'Avocado', servings: 1, role: 'fat' },
      { pattern: 'Bread', servings: 1, role: 'carb' },
    ],
  },
  {
    name: 'Arroz con Pollo Boricua',
    items: [
      { pattern: 'Arroz con Pollo', servings: 1.5, role: 'protein' },
      { pattern: 'Habichuelas Guisadas', servings: 0.5, role: 'carb' },
    ],
  },
  {
    name: 'Pollo Guisado con Arroz',
    items: [
      { pattern: 'Pollo Guisado', servings: 1, role: 'protein' },
      { pattern: 'Arroz Blanco', servings: 1, role: 'carb' },
      { pattern: 'Tostones', servings: 0.5, role: 'veggie' },
    ],
  },
  {
    name: 'Bistec Encebollado',
    items: [
      { pattern: 'Bistec Encebollado', servings: 1, role: 'protein' },
      { pattern: 'Arroz Blanco', servings: 1, role: 'carb' },
      { pattern: 'Amarillos', servings: 0.5, role: 'carb' },
    ],
  },
  {
    name: 'Burrito Bowl',
    items: [
      { pattern: 'Chicken Breast', servings: 1.5, role: 'protein' },
      { pattern: 'Brown Rice', servings: 1, role: 'carb' },
      { pattern: 'Black Beans', servings: 0.5, role: 'carb' },
      { pattern: 'Salsa', servings: 1, role: 'veggie' },
    ],
  },
  {
    name: 'Grilled Chicken Salad',
    items: [
      { pattern: 'Chicken Breast', servings: 1.5, role: 'protein' },
      { pattern: 'Mixed Salad', servings: 2, role: 'veggie' },
      { pattern: 'Avocado', servings: 1, role: 'fat' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Ground Turkey & Rice',
    items: [
      { pattern: 'Ground Turkey', servings: 1.5, role: 'protein' },
      { pattern: 'White Rice', servings: 1, role: 'carb' },
      { pattern: 'Bell Pepper', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Chicken & Pasta',
    items: [
      { pattern: 'Chicken Breast', servings: 1.5, role: 'protein' },
      { pattern: 'Pasta', servings: 1, role: 'carb' },
      { pattern: 'Broccoli', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
];

const DINNER_TEMPLATES = [
  {
    name: 'Salmon, Rice & Veggies',
    items: [
      { pattern: 'Salmon', servings: 1.5, role: 'protein' },
      { pattern: 'White Rice', servings: 1, role: 'carb' },
      { pattern: 'Broccoli', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Steak, Potato & Broccoli',
    items: [
      { pattern: 'Steak — Sirloin', servings: 1.5, role: 'protein' },
      { pattern: 'Potato (baked', servings: 1, role: 'carb' },
      { pattern: 'Broccoli', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Chicken Thigh & Sweet Potato',
    items: [
      { pattern: 'Chicken Thigh', servings: 1.5, role: 'protein' },
      { pattern: 'Sweet Potato', servings: 1, role: 'carb' },
      { pattern: 'Green Beans', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Pernil con Arroz y Gandules',
    items: [
      { pattern: 'Pernil', servings: 1, role: 'protein' },
      { pattern: 'Arroz con Gandules', servings: 1, role: 'carb' },
      { pattern: 'Mixed Salad', servings: 1, role: 'veggie' },
    ],
  },
  {
    name: 'Carne Guisada con Arroz',
    items: [
      { pattern: 'Carne Guisada', servings: 1, role: 'protein' },
      { pattern: 'Arroz Blanco', servings: 1, role: 'carb' },
      { pattern: 'Habichuelas Guisadas', servings: 0.5, role: 'carb' },
    ],
  },
  {
    name: 'Churrasco con Arroz y Tostones',
    items: [
      { pattern: 'Churrasco', servings: 1, role: 'protein' },
      { pattern: 'Arroz Blanco', servings: 1, role: 'carb' },
      { pattern: 'Tostones', servings: 0.5, role: 'veggie' },
    ],
  },
  {
    name: 'Pork Tenderloin & Rice',
    items: [
      { pattern: 'Pork Tenderloin', servings: 1.5, role: 'protein' },
      { pattern: 'Brown Rice', servings: 1, role: 'carb' },
      { pattern: 'Spinach', servings: 2, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Ground Turkey Pasta',
    items: [
      { pattern: 'Ground Turkey', servings: 1.5, role: 'protein' },
      { pattern: 'Pasta', servings: 1, role: 'carb' },
      { pattern: 'Tomato', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Shrimp Stir Fry',
    items: [
      { pattern: 'Shrimp', servings: 2, role: 'protein' },
      { pattern: 'White Rice', servings: 1, role: 'carb' },
      { pattern: 'Bell Pepper', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Asopao de Pollo',
    items: [
      { pattern: 'Asopao de Pollo', servings: 1.5, role: 'protein' },
      { pattern: 'Tostones', servings: 0.5, role: 'carb' },
    ],
  },
  {
    name: 'Chicken Breast & Potato',
    items: [
      { pattern: 'Chicken Breast', servings: 1.5, role: 'protein' },
      { pattern: 'Potato (baked', servings: 1, role: 'carb' },
      { pattern: 'Mixed Salad', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
  {
    name: 'Tilapia & Rice',
    items: [
      { pattern: 'Tilapia', servings: 1.5, role: 'protein' },
      { pattern: 'White Rice', servings: 1, role: 'carb' },
      { pattern: 'Broccoli', servings: 1, role: 'veggie' },
      { pattern: 'Olive Oil', servings: 1, role: 'cooking' },
    ],
  },
];

const SNACK_TEMPLATES = [
  {
    name: 'Greek Yogurt & Almonds',
    items: [
      { pattern: 'Greek Yogurt', servings: 1, role: 'protein' },
      { pattern: 'Almonds', servings: 1, role: 'fat' },
    ],
  },
  {
    name: 'Protein Bar',
    items: [
      { pattern: 'Protein Bar', servings: 1, role: 'protein' },
    ],
  },
  {
    name: 'Apple & Peanut Butter',
    items: [
      { pattern: 'Apple', servings: 1, role: 'fruit' },
      { pattern: 'Peanut Butter', servings: 1, role: 'fat' },
    ],
  },
  {
    name: 'Banana & PB',
    items: [
      { pattern: 'Banana', servings: 1, role: 'fruit' },
      { pattern: 'Peanut Butter', servings: 1, role: 'fat' },
    ],
  },
  {
    name: 'Cottage Cheese & Fruit',
    items: [
      { pattern: 'Cottage Cheese', servings: 1, role: 'protein' },
      { pattern: 'Strawberries', servings: 1, role: 'fruit' },
    ],
  },
  {
    name: 'Trail Mix',
    items: [
      { pattern: 'Trail Mix', servings: 1.5, role: 'fat' },
    ],
  },
  {
    name: 'Protein Shake',
    items: [
      { pattern: 'Whey Protein', servings: 1, role: 'protein' },
      { pattern: 'Banana', servings: 1, role: 'fruit' },
    ],
  },
  {
    name: 'Quesito',
    items: [
      { pattern: 'Quesito', servings: 1, role: 'carb' },
    ],
  },
  {
    name: 'String Cheese & Fruit',
    items: [
      { pattern: 'String Cheese', servings: 2, role: 'protein' },
      { pattern: 'Orange', servings: 1, role: 'fruit' },
    ],
  },
  {
    name: 'Rice Cakes & PB',
    items: [
      { pattern: 'Rice Cake', servings: 2, role: 'carb' },
      { pattern: 'Peanut Butter', servings: 1, role: 'fat' },
    ],
  },
];

const TEMPLATES_BY_MEAL = {
  breakfast: BREAKFAST_TEMPLATES,
  lunch: LUNCH_TEMPLATES,
  dinner: DINNER_TEMPLATES,
  snack: SNACK_TEMPLATES,
};

// Main meals get 90% of budget; snack fills the remaining gap
const MAIN_MEAL_SPLITS = { breakfast: 0.25, lunch: 0.35, dinner: 0.30 };

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function findFood(foods, pattern) {
  const p = pattern.toLowerCase();
  return foods.find(f => (f.name || '').toLowerCase().includes(p));
}

function r1(n) { return Math.round(n * 10) / 10; }

function buildItem(food, servings, role) {
  const s = r1(servings);
  return {
    food_item_id: food.id,
    name: food.name,
    name_es: food.name_es,
    brand: food.brand,
    image_url: getFoodImage(food.name, food.brand) || food.image_url,
    serving_size: food.serving_size,
    serving_unit: food.serving_unit,
    servings: s,
    calories: Math.round(food.calories * s),
    protein_g: r1(food.protein_g * s),
    carbs_g: r1(food.carbs_g * s),
    fat_g: r1(food.fat_g * s),
    role,
    isCooking: role === 'cooking',
  };
}

/** Round to nearest 0.5, clamp between min and 6 */
function clampServings(s, min = 0.5) {
  return Math.max(min, Math.min(6, Math.round(s * 2) / 2));
}

function sumMacros(items) {
  return items.reduce((t, i) => ({
    protein: t.protein + (i.protein_g || 0),
    carbs: t.carbs + (i.carbs_g || 0),
    fat: t.fat + (i.fat_g || 0),
    calories: t.calories + (i.calories || 0),
  }), { protein: 0, carbs: 0, fat: 0, calories: 0 });
}

/**
 * Pick a template that fits the available foods.
 * Scoring: favorites boost + macro-efficiency bonus.
 * When the fat budget is tight (fat/protein ratio < 0.4), prefer templates
 * whose protein sources are lean (low fat-to-protein ratio).
 */
function pickTemplate(templates, availableFoods, dislikedIds, favoriteIds, mealTargets) {
  const valid = shuffle(templates).filter(tmpl =>
    tmpl.items.every(item => {
      const food = findFood(availableFoods, item.pattern);
      return food && !dislikedIds.has(food.id);
    })
  );

  // Is this a tight-fat plan? (e.g. fat loss where fat budget is small relative to protein)
  const fatRatio = mealTargets ? (mealTargets.fat / Math.max(mealTargets.protein, 1)) : 1;
  const tightFat = fatRatio < 0.4;

  valid.sort((a, b) => {
    // Favorite score
    const aFavs = a.items.filter(i => { const f = findFood(availableFoods, i.pattern); return f && favoriteIds.has(f.id); }).length;
    const bFavs = b.items.filter(i => { const f = findFood(availableFoods, i.pattern); return f && favoriteIds.has(f.id); }).length;

    // Lean-protein score (only when fat is tight): lower fat/protein ratio = better
    let aLean = 0, bLean = 0;
    if (tightFat) {
      const leanScore = (tmpl) => {
        let totalFat = 0, totalProtein = 0;
        for (const item of tmpl.items) {
          const food = findFood(availableFoods, item.pattern);
          if (!food) continue;
          totalFat += (food.fat_g || 0) * item.servings;
          totalProtein += (food.protein_g || 0) * item.servings;
        }
        return totalProtein > 0 ? totalFat / totalProtein : 99;
      };
      aLean = leanScore(a);
      bLean = leanScore(b);
    }

    // Favorites first, then lean-protein preference
    if (bFavs !== aFavs) return bFavs - aFavs;
    return aLean - bLean; // lower fat/protein ratio is better
  });

  return valid[0] || null;
}

/**
 * Scale a template's items to hit per-meal macro targets.
 *
 * Accounts for macro cross-contamination: chicken breast (protein role) also
 * contributes fat and carbs. Those are subtracted from fat/carb budgets before
 * scaling fat/carb sources.
 *
 * Scaling order: protein → fat → carbs (protein is the priority macro for fitness).
 * If cross-contamination already covers a role's budget, those items are omitted.
 */
function scaleMeal(rawItems, mealTargets) {
  const byRole = { protein: [], carb: [], fat: [], veggie: [], fruit: [], cooking: [] };
  for (const r of rawItems) {
    const role = r.tmplItem.role;
    if (byRole[role]) byRole[role].push(r);
    else byRole.veggie.push(r); // unknown roles treated as veggie
  }

  // Veggies & fruit always stay at default (low macro impact)
  const fixedItems = [...byRole.veggie, ...byRole.fruit].map(({ food, tmplItem }) =>
    buildItem(food, tmplItem.servings, tmplItem.role)
  );

  // Cooking items (olive oil, butter) are essentially fat — scale them with the
  // fat budget instead of keeping them fixed. This prevents fat blowouts on
  // low-calorie plans where 3 tbsp olive oil would exceed the entire fat target.
  const allFatSources = [...byRole.fat, ...byRole.cooking];

  const fixedMacros = sumMacros(fixedItems);
  let remainP = Math.max(0, mealTargets.protein - fixedMacros.protein);
  let remainC = Math.max(0, mealTargets.carbs - fixedMacros.carbs);
  let remainF = Math.max(0, mealTargets.fat - fixedMacros.fat);

  // Scale PROTEIN sources first (priority macro)
  const proteinItems = [];
  if (byRole.protein.length > 0 && remainP > 1) {
    const baseP = byRole.protein.reduce((s, r) => s + r.item.protein_g, 0);
    const scale = baseP > 0 ? remainP / baseP : 1;
    for (const { food, tmplItem } of byRole.protein) {
      proteinItems.push(buildItem(food, clampServings(tmplItem.servings * scale), tmplItem.role));
    }
    const pMacros = sumMacros(proteinItems);
    remainC = Math.max(0, remainC - pMacros.carbs);
    remainF = Math.max(0, remainF - pMacros.fat);
  }

  // Scale FAT + COOKING sources together — skip if fat budget is already used
  const fatItems = [];
  if (allFatSources.length > 0 && remainF > 1) {
    const baseF = allFatSources.reduce((s, r) => s + r.item.fat_g, 0);
    const scale = baseF > 0 ? remainF / baseF : 1;
    for (const { food, tmplItem } of allFatSources) {
      fatItems.push(buildItem(food, clampServings(tmplItem.servings * scale), tmplItem.role));
    }
    const fMacros = sumMacros(fatItems);
    remainC = Math.max(0, remainC - fMacros.carbs);
  }

  // Scale CARB sources last
  const carbItems = [];
  if (byRole.carb.length > 0 && remainC > 2) {
    const baseC = byRole.carb.reduce((s, r) => s + r.item.carbs_g, 0);
    const scale = baseC > 0 ? remainC / baseC : 1;
    for (const { food, tmplItem } of byRole.carb) {
      carbItems.push(buildItem(food, clampServings(tmplItem.servings * scale), tmplItem.role));
    }
  }

  return [...proteinItems, ...carbItems, ...fatItems, ...fixedItems];
}

// ═══════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════

export function generateMealPlan({
  targets,
  foods,
  dislikedIds = new Set(),
  favoriteIds = new Set(),
  alreadyEaten = { calories: 0, protein: 0, carbs: 0, fat: 0 },
}) {
  const remaining = {
    calories: Math.max(0, (targets.calories || 2000) - alreadyEaten.calories),
    protein: Math.max(0, (targets.protein || 150) - alreadyEaten.protein),
    carbs: Math.max(0, (targets.carbs || 200) - alreadyEaten.carbs),
    fat: Math.max(0, (targets.fat || 65) - alreadyEaten.fat),
  };

  const availableFoods = foods.filter(f => !dislikedIds.has(f.id) && Number(f.calories) > 0);
  const plan = {};

  // ── Pass 1: Generate main meals (breakfast, lunch, dinner) ──
  // Track running total of what's been allocated
  let usedP = 0, usedC = 0, usedF = 0;

  for (const [mealType, split] of Object.entries(MAIN_MEAL_SPLITS)) {
    const mealTargets = {
      protein: Math.round(remaining.protein * split),
      carbs: Math.round(remaining.carbs * split),
      fat: Math.round(remaining.fat * split),
    };

    const chosen = pickTemplate(TEMPLATES_BY_MEAL[mealType] || [], availableFoods, dislikedIds, favoriteIds, mealTargets);
    if (!chosen) { plan[mealType] = []; continue; }

    const rawItems = [];
    for (const tmplItem of chosen.items) {
      const food = findFood(availableFoods, tmplItem.pattern);
      if (!food) continue;
      rawItems.push({ food, tmplItem, item: buildItem(food, tmplItem.servings, tmplItem.role) });
    }

    const items = scaleMeal(rawItems, mealTargets);
    plan[mealType] = items;

    const totals = sumMacros(items);
    usedP += totals.protein;
    usedC += totals.carbs;
    usedF += totals.fat;
  }

  // ── Pass 2: Snack fills whatever macro gap remains ──
  const snackTargets = {
    protein: Math.max(0, remaining.protein - usedP),
    carbs: Math.max(0, remaining.carbs - usedC),
    fat: Math.max(0, remaining.fat - usedF),
  };

  const snackTemplates = shuffle(SNACK_TEMPLATES).filter(tmpl =>
    tmpl.items.every(item => {
      const food = findFood(availableFoods, item.pattern);
      return food && !dislikedIds.has(food.id);
    })
  );

  // Pick the snack that best matches whichever macro is most short
  const dominantNeed = snackTargets.protein >= snackTargets.carbs && snackTargets.protein >= snackTargets.fat
    ? 'protein'
    : snackTargets.carbs >= snackTargets.fat ? 'carb' : 'fat';
  snackTemplates.sort((a, b) => {
    const aHas = a.items.some(i => i.role === dominantNeed) ? 1 : 0;
    const bHas = b.items.some(i => i.role === dominantNeed) ? 1 : 0;
    const aFav = a.items.filter(i => { const f = findFood(availableFoods, i.pattern); return f && favoriteIds.has(f.id); }).length;
    const bFav = b.items.filter(i => { const f = findFood(availableFoods, i.pattern); return f && favoriteIds.has(f.id); }).length;
    return (bHas - aHas) || (bFav - aFav);
  });

  const chosenSnack = snackTemplates[0];
  if (!chosenSnack) {
    plan.snack = [];
  } else {
    const rawItems = [];
    for (const tmplItem of chosenSnack.items) {
      const food = findFood(availableFoods, tmplItem.pattern);
      if (!food) continue;
      rawItems.push({ food, tmplItem, item: buildItem(food, tmplItem.servings, tmplItem.role) });
    }
    plan.snack = scaleMeal(rawItems, snackTargets);
  }

  // ── Pass 3: Iterative correction — shrink overages, grow shortages ──
  // Runs up to 8 passes. Each pass finds the worst macro error and adjusts
  // the single best food item to reduce it. Can reduce items down to 0.5 servings.
  const dayTarget = { protein: remaining.protein, carbs: remaining.carbs, fat: remaining.fat };

  for (let iter = 0; iter < 8; iter++) {
    const dayTotals = sumMacros(Object.values(plan).flat());
    const errors = {
      protein: dayTotals.protein - dayTarget.protein,
      carbs: dayTotals.carbs - dayTarget.carbs,
      fat: dayTotals.fat - dayTarget.fat,
    };

    // Check if within 3% tolerance on all macros
    const tol = (macro) => Math.abs(errors[macro]) <= Math.max(dayTarget[macro] * 0.03, 2);
    if (tol('protein') && tol('carbs') && tol('fat')) break;

    // Find the macro with the largest absolute error
    let worstMacro = 'protein';
    if (Math.abs(errors.carbs) > Math.abs(errors[worstMacro])) worstMacro = 'carbs';
    if (Math.abs(errors.fat) > Math.abs(errors[worstMacro])) worstMacro = 'fat';

    const worstErr = errors[worstMacro]; // positive = over, negative = under
    const macroKey = worstMacro === 'protein' ? 'protein_g' : worstMacro === 'carbs' ? 'carbs_g' : 'fat_g';
    const roleForMacro = worstMacro === 'protein' ? 'protein' : worstMacro === 'carbs' ? 'carb' : 'fat';

    // Find the best item to adjust.
    // Pass 0: items whose role matches the problem macro (+ cooking for fat).
    // Pass 1: if macro is OVER target, allow ANY item that contributes to it,
    //         but cap the reduction so the item's primary macro stays at/above target.
    let bestMeal = null, bestIdx = -1, bestScore = -Infinity, bestNewServings = 0;

    const primaryRoles = worstMacro === 'fat'
      ? ['fat', 'cooking']
      : [roleForMacro];

    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1 && bestMeal !== null) break;
      if (pass === 1 && worstErr <= 0) break; // only expand for overshoots

      for (const [mealType, items] of Object.entries(plan)) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const food = availableFoods.find(f => f.id === item.food_item_id);
          if (!food) continue;
          const macroPerServing = Number(food[macroKey]) || 0;
          if (macroPerServing <= 0) continue;

          if (pass === 0 && !primaryRoles.includes(item.role)) continue;
          if (pass === 1 && primaryRoles.includes(item.role)) continue;

          let targetNewServings;
          if (pass === 0) {
            // Direct role: adjust fully toward fixing the error
            targetNewServings = clampServings(item.servings - (worstErr / macroPerServing));
          } else {
            // Cross-role: cap reduction so the item's primary macro doesn't go below target
            const itemPrimaryMacro = item.role === 'protein' ? 'protein'
              : item.role === 'carb' ? 'carbs' : 'fat';
            const primarySurplus = errors[itemPrimaryMacro]; // how much over for this macro
            if (primarySurplus <= 0) continue; // primary macro is already under, skip

            // Max we can reduce servings = only eat into the surplus of the primary macro
            const primaryKey = itemPrimaryMacro === 'protein' ? 'protein_g'
              : itemPrimaryMacro === 'carbs' ? 'carbs_g' : 'fat_g';
            const primaryPerServing = Number(food[primaryKey]) || 1;
            const maxReduction = primarySurplus / primaryPerServing;
            // How much we'd want to reduce to fix the worst macro
            const idealReduction = worstErr / macroPerServing;
            const cappedReduction = Math.min(idealReduction, maxReduction);
            targetNewServings = clampServings(item.servings - cappedReduction);
          }

          const actualChange = targetNewServings - item.servings;
          if (actualChange === 0) continue;
          const macroFix = actualChange * macroPerServing;
          const reduction = Math.abs(worstErr) - Math.abs(worstErr + macroFix);
          if (reduction > bestScore) {
            bestScore = reduction;
            bestMeal = mealType;
            bestIdx = i;
            bestNewServings = targetNewServings;
          }
        }
      }
    }

    if (bestMeal === null || bestIdx < 0) break;

    const item = plan[bestMeal][bestIdx];
    const food = availableFoods.find(f => f.id === item.food_item_id);
    if (food) {
      plan[bestMeal][bestIdx] = buildItem(food, bestNewServings, item.role);
    }
  }

  return plan;
}

// ═══════════════════════════════════════════════════════════
// SWAP — Replace a single food with same-role alternative
// ═══════════════════════════════════════════════════════════

export function swapFood({
  currentFoodItemId,
  category, // role: 'protein', 'carb', 'veggie', etc.
  targetCalories,
  foods,
  dislikedIds = new Set(),
  excludeIds = new Set(),
}) {
  // Role-based swap lists — real alternatives for each role
  const ROLE_ALTERNATIVES = {
    protein: ['Chicken Breast', 'Chicken Thigh', 'Ground Turkey', 'Ground Beef', 'Salmon', 'Tuna', 'Shrimp', 'Tilapia', 'Steak', 'Pork Tenderloin', 'Egg (whole', 'Egg White', 'Tofu'],
    carb: ['White Rice', 'Brown Rice', 'Quinoa', 'Pasta', 'Sweet Potato', 'Potato (baked', 'Oatmeal', 'Bread', 'Arroz Blanco', 'Arroz con Gandules'],
    veggie: ['Broccoli', 'Spinach', 'Mixed Salad', 'Green Beans', 'Asparagus', 'Bell Pepper', 'Tomato', 'Zucchini', 'Tostones'],
    fruit: ['Banana', 'Apple', 'Orange', 'Strawberries', 'Blueberries', 'Mango', 'Grapes'],
    fat: ['Avocado', 'Peanut Butter', 'Almond Butter', 'Almonds', 'Cheese', 'Trail Mix'],
    cooking: ['Olive Oil', 'Coconut Oil', 'Butter'],
  };

  const patterns = ROLE_ALTERNATIVES[category] || [];
  const candidates = patterns
    .map(p => foods.find(f => f.name?.toLowerCase().includes(p.toLowerCase()) && !dislikedIds.has(f.id) && !excludeIds.has(f.id) && f.id !== currentFoodItemId))
    .filter(Boolean);

  if (candidates.length === 0) return null;

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const calPer = Number(picked.calories) || 1;
  const newServings = Math.min(4, Math.max(0.5, Math.round((targetCalories / calPer) * 2) / 2));
  return buildItem(picked, newServings, category);
}

// ═══════════════════════════════════════════════════════════
// TOTALS
// ═══════════════════════════════════════════════════════════

export function mealTotals(items) {
  const raw = items.reduce((t, i) => ({
    calories: t.calories + (i.calories || 0),
    protein: t.protein + (i.protein_g || 0),
    carbs: t.carbs + (i.carbs_g || 0),
    fat: t.fat + (i.fat_g || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  return { calories: Math.round(raw.calories), protein: r1(raw.protein), carbs: r1(raw.carbs), fat: r1(raw.fat) };
}

export function planTotals(plan) {
  return mealTotals(Object.values(plan).flat());
}
