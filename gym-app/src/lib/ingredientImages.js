// AUTO-GENERATED base set + hand-maintained alias map.
//
// INGREDIENT_IMAGE_SLUGS: the exact ingredient image files uploaded to Supabase
// storage `food-images/ingredients/<slug>.jpg` (116 files). Requesting only
// these guarantees no 404/400s and no broken thumbnails.
// Regenerate the set: ls ~/Downloads/tugympr-ingredient-images/*.jpg | basenames.
//
// INGREDIENT_IMAGE_ALIASES: recipes use ~484 granular ingredient keys; most have
// no dedicated photo. This maps a granular key to the closest uploaded slug so
// e.g. `basmati_rice` borrows `white_rice`, `beef_ribeye` borrows `sirloin_steak`.
// Visual-family matches only — never a misleading one; keys with no good match
// stay unmapped and render a clean letter tile.
export const INGREDIENT_IMAGE_SLUGS = new Set([
  'almond_milk',
  'almonds',
  'apple',
  'asparagus',
  'avocado',
  'bacon',
  'bagel',
  'banana',
  'beets',
  'bell_pepper',
  'black_beans',
  'blackberries',
  'blueberries',
  'broccoli',
  'brown_rice',
  'brussels_sprouts',
  'butter',
  'cabbage',
  'canned_tuna',
  'cantaloupe',
  'carrot',
  'cashews',
  'cauliflower',
  'celery',
  'cheddar_cheese',
  'chia_seeds',
  'chicken_breast',
  'chicken_thigh',
  'chickpeas',
  'coconut_oil',
  'cod',
  'corn',
  'cornflakes',
  'cottage_cheese',
  'couscous',
  'cream_cheese',
  'cucumber',
  'dark_chocolate',
  'deli_turkey',
  'edamame',
  'egg_whites',
  'eggplant',
  'eggs',
  'english_muffin',
  'feta_cheese',
  'flax_seeds',
  'flour_tortilla',
  'garlic',
  'granola',
  'grapefruit',
  'grapes',
  'greek_yogurt',
  'green_beans',
  'ground_beef',
  'ground_chicken',
  'ground_turkey',
  'ham',
  'honey',
  'hummus',
  'kale',
  'kidney_beans',
  'kiwi',
  'lentils',
  'lettuce',
  'mahi_mahi',
  'mango',
  'mozzarella',
  'mushroom',
  'oats',
  'olive_oil',
  'onion',
  'orange',
  'parmesan',
  'pasta',
  'peach',
  'peanut_butter',
  'peanuts',
  'pear',
  'peas',
  'pineapple',
  'pinto_beans',
  'plain_yogurt',
  'plantain',
  'pomegranate',
  'pork_loin',
  'potato',
  'pumpkin',
  'pumpkin_seeds',
  'quinoa',
  'raspberries',
  'rye_bread',
  'salmon',
  'sardines',
  'shrimp',
  'sirloin_steak',
  'skim_milk',
  'soy_milk',
  'spinach',
  'strawberries',
  'sweet_potato',
  'swiss_cheese',
  'tempeh',
  'tilapia',
  'tofu',
  'tomato',
  'tuna',
  'turkey_breast',
  'walnuts',
  'watermelon',
  'whey_protein',
  'white_beans',
  'white_bread',
  'white_rice',
  'whole_milk',
  'whole_wheat_bread',
  'zucchini',
]);

export const INGREDIENT_IMAGE_ALIASES = {
  // rice
  rice: 'white_rice', basmati_rice: 'white_rice', jasmine_rice: 'white_rice', cooked_rice: 'white_rice',
  microwaveable_rice: 'white_rice', cooked_brown_rice: 'brown_rice', cauliflower_rice: 'cauliflower',
  // beef / steak
  beef_brisket: 'sirloin_steak', beef_chuck: 'sirloin_steak', beef_flank: 'sirloin_steak', beef_ribeye: 'sirloin_steak',
  beef_sirloin: 'sirloin_steak', beef_skirt: 'sirloin_steak', beef_strips: 'sirloin_steak', flank_steak: 'sirloin_steak',
  ribeye_steak: 'sirloin_steak', sirloin_beef: 'sirloin_steak', lean_beef_strips: 'sirloin_steak',
  lean_beef: 'ground_beef', lean_ground_beef: 'ground_beef', ground_bison: 'ground_beef',
  ground_lamb: 'ground_beef', lamb_mince: 'ground_beef', ground_pork: 'ground_beef',
  // chicken
  chicken_thighs: 'chicken_thigh', chicken_drumsticks: 'chicken_thigh', grilled_chicken_breast: 'chicken_breast',
  rotisserie_chicken: 'chicken_breast', canned_chicken: 'chicken_breast',
  // pork
  pork_tenderloin: 'pork_loin', pork_belly: 'pork_loin', pork_ribs: 'pork_loin', pulled_pork: 'pork_loin',
  canadian_bacon: 'bacon', pancetta: 'bacon',
  // fish / seafood
  salmon_fillet: 'salmon', smoked_salmon: 'salmon', canned_salmon: 'salmon', tuna_steak: 'tuna',
  sushi_grade_tuna: 'tuna', cod_fillet: 'cod', white_fish: 'cod', sole: 'cod', halibut: 'cod',
  tilapia_fillet: 'tilapia', canned_mackerel: 'sardines', canned_sardines: 'sardines',
  large_shrimp: 'shrimp', cooked_shrimp: 'shrimp', pre_cooked_shrimp: 'shrimp',
  // turkey
  turkey_breast_slices: 'turkey_breast', turkey_slices: 'turkey_breast', turkey_sausage: 'ground_turkey', turkey_sausage_patty: 'ground_turkey',
  // eggs
  egg: 'eggs', whole_eggs: 'eggs', fried_egg: 'eggs', hard_boiled_eggs: 'eggs', egg_yolks: 'eggs',
  // cheese
  cheddar: 'cheddar_cheese', double_cheddar: 'cheddar_cheese', american_cheese: 'cheddar_cheese', low_fat_cheese: 'cheddar_cheese',
  feta: 'feta_cheese', cotija_cheese: 'feta_cheese', halloumi: 'feta_cheese', parmesan_cheese: 'parmesan',
  provolone_cheese: 'mozzarella', monterey_jack_cheese: 'mozzarella', string_cheese: 'mozzarella',
  gruyere: 'swiss_cheese', gruyere_cheese: 'swiss_cheese', ricotta: 'cottage_cheese', ricotta_cheese: 'cottage_cheese',
  cream_cheese_light: 'cream_cheese', low_fat_cottage_cheese: 'cottage_cheese',
  // yogurt / milk / cream
  yogurt: 'plain_yogurt', whole_milk_yogurt: 'plain_yogurt', coconut_yogurt: 'plain_yogurt', skyr: 'greek_yogurt',
  milk: 'whole_milk', buttermilk: 'whole_milk', sour_cream: 'plain_yogurt', tzatziki: 'plain_yogurt',
  // bread / buns / bagels
  bread: 'whole_wheat_bread', toast: 'whole_wheat_bread', whole_grain_bread: 'whole_wheat_bread',
  sourdough_bread: 'white_bread', crusty_bread: 'white_bread', thick_bread: 'white_bread', brioche_bread: 'white_bread',
  brioche_bun: 'white_bread', burger_bun: 'white_bread', burger_buns: 'white_bread', hoagie_roll: 'white_bread', sub_roll: 'white_bread',
  whole_grain_bagel: 'bagel',
  // tortillas / wraps / flatbread
  flour_tortillas: 'flour_tortilla', corn_tortilla: 'flour_tortilla', corn_tortillas: 'flour_tortilla',
  large_tortilla: 'flour_tortilla', large_tortillas: 'flour_tortilla', whole_wheat_tortilla: 'flour_tortilla',
  whole_wheat_wrap: 'flour_tortilla', large_wrap: 'flour_tortilla', pita: 'flour_tortilla', pita_bread: 'flour_tortilla',
  large_pita: 'flour_tortilla', whole_wheat_pita: 'flour_tortilla', naan_bread: 'flour_tortilla',
  // oats / grains
  rolled_oats: 'oats', steel_cut_oats: 'oats', farro: 'quinoa', bulgur_wheat: 'quinoa',
  // pasta / noodles
  macaroni: 'pasta', spaghetti: 'pasta', fettuccine: 'pasta', rigatoni: 'pasta', orzo_pasta: 'pasta',
  lasagna_sheets: 'pasta', high_protein_pasta: 'pasta', whole_wheat_pasta: 'pasta', noodles: 'pasta',
  ramen_noodles: 'pasta', rice_noodles: 'pasta', soba_noodles: 'pasta', udon_noodles: 'pasta',
  chow_mein_noodles: 'pasta', gnocchi: 'pasta',
  // potato
  potatoes: 'potato', baby_potatoes: 'potato', large_potato: 'potato', russet_potato: 'potato',
  mashed_potato: 'potato', french_fries: 'potato',
  // vegetables
  carrots: 'carrot', bell_peppers: 'bell_pepper', red_bell_pepper: 'bell_pepper', green_pepper: 'bell_pepper',
  red_pepper: 'bell_pepper', roasted_red_pepper: 'bell_pepper', cherry_tomato: 'tomato', cherry_tomatoes: 'tomato',
  canned_tomato: 'tomato', canned_tomatoes: 'tomato', crushed_tomatoes: 'tomato', tomatoes: 'tomato',
  sun_dried_tomatoes: 'tomato', mushrooms: 'mushroom', portobello_mushrooms: 'mushroom', romaine: 'lettuce',
  romaine_lettuce: 'lettuce', butter_lettuce: 'lettuce', mixed_greens: 'lettuce', bagged_salad_mix: 'lettuce',
  arugula: 'lettuce', red_onion: 'onion', green_onion: 'onion', green_onions: 'onion', scallion: 'onion',
  scallions: 'onion', spring_onion: 'onion', shallot: 'onion', snap_peas: 'peas', snow_peas: 'peas',
  green_peas: 'peas', frozen_peas: 'peas', frozen_edamame: 'edamame', napa_cabbage: 'cabbage',
  bok_choy: 'cabbage', coleslaw: 'cabbage', coleslaw_mix: 'cabbage', kimchi: 'cabbage',
  // beans / legumes
  canned_black_beans: 'black_beans', canned_beans: 'black_beans', canned_chickpeas: 'chickpeas',
  canned_pinto_beans: 'pinto_beans', refried_beans: 'pinto_beans', baked_beans: 'pinto_beans',
  black_eyed_peas: 'white_beans', fava_beans: 'white_beans', brown_lentils: 'lentils', green_lentils: 'lentils', red_lentils: 'lentils',
  // fruit
  berries: 'strawberries', fresh_berries: 'strawberries', mixed_berries: 'strawberries', frozen_berries: 'strawberries',
  ripe_banana: 'banana', frozen_banana: 'banana', frozen_mango: 'mango',
  // nuts / seeds / fats
  almond_butter: 'peanut_butter', mixed_nuts: 'almonds', pine_nuts: 'cashews', sesame_seeds: 'flax_seeds',
  flaxseeds: 'flax_seeds', guacamole: 'avocado',
  // protein powders
  protein_powder: 'whey_protein', vanilla_protein_powder: 'whey_protein', chocolate_protein_powder: 'whey_protein',
  // tomato-based sauces
  salsa: 'tomato', tomato_salsa: 'tomato', pico_de_gallo: 'tomato', marinara_sauce: 'tomato',
  tomato_sauce: 'tomato', tomato_paste: 'tomato',
};

// The uploaded slug to use for an ingredient key (exact match → itself; else an
// alias; else null = no image, render a letter tile). Never returns a slug that
// isn't actually uploaded.
export function ingredientImageSlug(key) {
  if (!key) return null;
  const k = String(key).toLowerCase();
  if (INGREDIENT_IMAGE_SLUGS.has(k)) return k;
  const a = INGREDIENT_IMAGE_ALIASES[k];
  return (a && INGREDIENT_IMAGE_SLUGS.has(a)) ? a : null;
}

export const hasIngredientImage = (key) => ingredientImageSlug(key) !== null;
