"""
Batch generate all 646 food images via ComfyUI + Flux Dev.
Style: white plate/bowl centered on white background, overhead shot, realistic.
"""
import json, time, requests, re, os, sys

COMFY = "http://127.0.0.1:8188"
OUTPUT_DIR = "c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/public/foods"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Extract image names from foodImages.js
with open("c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/src/lib/foodImages.js") as f:
    content = f.read()
images = sorted(set(re.findall(r'"/foods/([^"]+)\.png"', content)))

# Map filename -> human-readable prompt description
# We convert snake_case filenames to natural descriptions and add context
FOOD_DESCRIPTIONS = {
    # === PROTEINS ===
    "chicken_breast": "a grilled chicken breast with grill marks, seasoned with herbs",
    "chicken_thigh": "a golden-brown roasted chicken thigh, skin-on",
    "ground_turkey": "a portion of cooked seasoned ground turkey crumbled on the plate",
    "ground_beef_90": "a portion of cooked lean ground beef (90/10) crumbled on the plate",
    "ground_beef_80": "a portion of cooked ground beef (80/20) crumbled on the plate",
    "salmon_fillet": "a pan-seared salmon fillet with crispy skin, pink inside",
    "tuna_canned": "a portion of canned tuna drained and flaked on the plate",
    "shrimp_cooked": "a pile of cooked pink shrimp, peeled and deveined",
    "tilapia_cooked": "a baked tilapia fillet, white flaky fish with lemon",
    "pork_tenderloin": "sliced roasted pork tenderloin medallions",
    "steak_sirloin": "a grilled sirloin steak, medium rare, sliced to show pink center",
    "steak_ribeye": "a grilled ribeye steak with marbling and char marks, medium rare",
    "turkey_breast_deli": "sliced deli turkey breast meat stacked on the plate",
    "bacon_cooked": "strips of crispy cooked bacon",
    "sausage_link": "two cooked breakfast sausage links, browned",
    "cod_baked": "a baked cod fillet, white flaky fish",
    "halibut_baked": "a baked halibut fillet, thick white fish",
    "sardines_canned": "canned sardines arranged on the plate",
    "catfish_baked": "a baked catfish fillet, golden crust",
    "mahi_mahi": "a grilled mahi mahi fillet with grill marks",
    "crab_meat": "a mound of lump crab meat",
    "lobster_steamed": "a steamed lobster tail, shell cracked open showing meat",
    "beef_brisket": "sliced smoked beef brisket with bark crust",
    "lamb_chop": "two grilled lamb chops with bones exposed",
    "veal_cutlet": "a breaded and fried veal cutlet",
    "turkey_burger": "a cooked turkey burger patty",
    "bison_burger": "a cooked bison burger patty",
    "venison_roasted": "sliced roasted venison",
    "pork_chop": "a grilled bone-in pork chop with grill marks",
    "lamb_ground": "a portion of cooked ground lamb",
    "egg_whole": "two fried eggs sunny side up",
    "egg_white": "a pile of cooked scrambled egg whites",

    # === DAIRY ===
    "greek_yogurt_0": "a bowl of plain nonfat greek yogurt, thick and creamy white",
    "greek_yogurt_2": "a bowl of greek yogurt 2% fat, thick and creamy",
    "cottage_cheese_2": "a bowl of cottage cheese with visible curds",
    "milk_whole": "a clear glass of whole milk",
    "milk_2percent": "a clear glass of 2% milk",
    "milk_skim": "a clear glass of skim milk",
    "cheese_cheddar": "sliced yellow cheddar cheese",
    "cheese_mozzarella": "a ball of fresh mozzarella cheese, sliced",
    "butter": "a stick of butter with a pat sliced off on a small plate",
    "cream_cheese": "a spread of cream cheese on a small plate",
    "cottage_cheese_4percent": "a bowl of full fat cottage cheese with visible curds",
    "parmesan_cheese_grated": "a small pile of grated parmesan cheese",
    "swiss_cheese_slice": "slices of swiss cheese with holes",
    "chobani_vanilla_greek_yogurt": "a container of Chobani vanilla greek yogurt, opened",
    "yoplait_strawberry_yogurt": "a container of Yoplait strawberry yogurt, opened",
    "light_string_cheese": "two string cheese sticks, one partially peeled",
    "fairlife_2percent_milk": "a bottle of Fairlife 2% milk",
    "fairlife_fat_free_milk": "a bottle of Fairlife fat free milk",

    # === GRAINS & CARBS ===
    "white_rice": "a mound of cooked fluffy white rice",
    "brown_rice": "a mound of cooked brown rice",
    "jasmine_rice": "a mound of cooked jasmine rice, fluffy",
    "quinoa": "a mound of cooked quinoa",
    "pasta_cooked": "a portion of cooked plain pasta (penne)",
    "bread_white": "two slices of white sandwich bread",
    "bread_whole_wheat": "two slices of whole wheat bread",
    "tortilla_flour": "a stack of flour tortillas",
    "tortilla_corn": "a stack of corn tortillas",
    "oatmeal": "a bowl of cooked oatmeal, plain",
    "bagel_plain": "a plain bagel, sliced in half",
    "potato_baked": "a baked potato split open with steam",
    "sweet_potato_baked": "a baked sweet potato split open, orange flesh",
    "couscous": "a mound of fluffy couscous",
    "bulgur_wheat": "a mound of cooked bulgur wheat",
    "farro": "a mound of cooked farro grains",
    "barley": "a mound of cooked pearl barley",
    "wild_rice": "a mound of cooked wild rice, dark grains",
    "english_muffin_whole_wheat": "a whole wheat english muffin, toasted and split",
    "pita_bread": "round pita bread",
    "naan_bread": "a piece of naan bread with char spots",
    "croissant_large": "a large golden flaky croissant",
    "hamburger_bun": "a sesame seed hamburger bun",
    "daves_killer_bread_21_grains": "two slices of Dave's Killer Bread 21 Whole Grains, seeded",
    "daves_killer_bread_good_seed": "two slices of Dave's Killer Bread Good Seed, seeded",
    "ezekiel_sprouted_bread": "two slices of Ezekiel sprouted grain bread",

    # === FRUITS ===
    "banana": "a ripe yellow banana",
    "apple": "a red apple, whole",
    "orange": "an orange, whole",
    "blueberries": "a bowl of fresh blueberries",
    "strawberries": "fresh strawberries in a small bowl",
    "grapes": "a bunch of green grapes",
    "avocado": "a halved avocado showing the pit and green flesh",
    "mango": "a sliced ripe mango showing orange flesh",
    "watermelon": "a slice of watermelon, red flesh with seeds",
    "pineapple": "pineapple chunks, fresh and yellow",
    "peach": "a ripe peach, whole with fuzzy skin",
    "plum": "a purple plum, whole",
    "kiwi": "a sliced kiwi showing green flesh with seeds",
    "pomegranate_seeds": "a bowl of pomegranate seeds, ruby red",
    "figs_fresh": "fresh figs, one cut in half showing pink interior",
    "dates_medjool": "medjool dates, a few pieces",
    "dried_cranberries": "a small pile of dried cranberries",
    "raisins": "a small pile of dark raisins",
    "raspberries": "a bowl of fresh raspberries",
    "blackberries": "a bowl of fresh blackberries",
    "cantaloupe": "sliced cantaloupe melon, orange flesh",
    "honeydew": "sliced honeydew melon, pale green flesh",

    # === VEGETABLES ===
    "broccoli": "a portion of steamed broccoli florets",
    "spinach_raw": "a pile of fresh raw baby spinach leaves",
    "mixed_salad_greens": "a bowl of mixed salad greens",
    "carrots_raw": "baby carrots, a handful on the plate",
    "bell_pepper": "a sliced red bell pepper",
    "tomato": "a sliced red tomato",
    "cucumber": "sliced cucumber rounds",
    "green_beans": "a portion of steamed green beans",
    "asparagus": "a bundle of roasted asparagus spears",
    "corn_cooked": "an ear of cooked corn on the cob with butter",
    "mushrooms_raw": "sliced raw white mushrooms",
    "onion_raw": "a sliced raw white onion",
    "zucchini_cooked": "sliced sauteed zucchini rounds",
    "kale_raw": "a pile of fresh raw curly kale",
    "cauliflower_raw": "raw cauliflower florets",
    "brussels_sprouts": "roasted halved brussels sprouts, caramelized",
    "eggplant_cooked": "sliced roasted eggplant",
    "artichoke_cooked": "a cooked whole artichoke",
    "beets_cooked": "sliced cooked beets, deep purple",
    "cabbage_raw": "shredded raw green cabbage",
    "celery_raw": "celery sticks",
    "radishes_raw": "sliced red radishes",
    "snap_peas_raw": "fresh sugar snap peas",

    # === LEGUMES & NUTS ===
    "black_beans": "a bowl of cooked black beans",
    "chickpeas": "a bowl of cooked chickpeas",
    "lentils": "a bowl of cooked brown lentils",
    "peanut_butter": "a spoonful of creamy peanut butter on a small plate",
    "almond_butter": "a spoonful of almond butter on a small plate",
    "almonds": "a handful of raw almonds",
    "walnuts": "a handful of walnut halves",
    "cashews": "a handful of cashews",
    "mixed_nuts": "a handful of mixed nuts",
    "pistachios": "a handful of shelled pistachios",
    "macadamia_nuts": "a handful of macadamia nuts",
    "pecans": "a handful of pecan halves",
    "pine_nuts": "a small pile of pine nuts",
    "sunflower_seeds": "a small pile of sunflower seeds",
    "pumpkin_seeds": "a small pile of green pumpkin seeds",
    "chia_seeds": "a small pile of chia seeds",
    "flax_seeds": "a small pile of golden flax seeds",
    "hemp_hearts": "a small pile of hemp hearts",
    "tahini": "a small bowl of tahini paste",
    "kidney_beans": "a bowl of cooked red kidney beans",
    "pinto_beans": "a bowl of cooked pinto beans",
    "navy_beans": "a bowl of cooked white navy beans",
    "refried_beans": "a bowl of refried beans",
    "tofu_firm": "a block of firm tofu, sliced",
    "tempeh": "sliced tempeh block, fermented soy",
    "seitan": "sliced seitan pieces",
    "edamame": "a bowl of shelled edamame beans",
    "beyond_meat_burger": "a Beyond Meat plant-based burger patty, cooked",
    "impossible_burger": "an Impossible Burger patty, cooked and juicy",

    # === SUPPLEMENTS & BARS ===
    "whey_protein_shake": "a shaker bottle with protein shake, creamy liquid",
    "casein_protein_shake": "a shaker bottle with casein protein shake",
    "mass_gainer_shake": "a large shaker bottle with mass gainer shake",
    "protein_bar": "a protein bar, unwrapped showing texture",
    "quest_chocolate_chip_cookie_dough": "a Quest protein bar chocolate chip cookie dough flavor, unwrapped",
    "quest_birthday_cake": "a Quest protein bar birthday cake flavor, unwrapped",
    "rxbar_chocolate_sea_salt": "an RXBar chocolate sea salt, unwrapped",
    "rxbar_peanut_butter_chocolate": "an RXBar peanut butter chocolate, unwrapped",
    "onebar_birthday_cake": "a ONE Bar birthday cake flavor, unwrapped",
    "clifbar_crunchy_peanut_butter": "a Clif Bar crunchy peanut butter, unwrapped",
    "kind_dark_chocolate_nuts": "a KIND bar dark chocolate nuts and sea salt, unwrapped",
    "larabar_peanut_butter_chocolate_chip": "a Larabar peanut butter chocolate chip, unwrapped",

    # === CONDIMENTS & SAUCES ===
    "olive_oil": "a small glass bowl of extra virgin olive oil",
    "coconut_oil": "a small jar of coconut oil, white solid",
    "honey": "a small bowl of golden honey with a honey dipper",
    "soy_sauce": "a small dish of dark soy sauce",
    "hot_sauce": "a bottle of red hot sauce",
    "ketchup": "a small ramekin of ketchup",
    "mustard": "a small ramekin of yellow mustard",
    "ranch_dressing": "a small ramekin of ranch dressing",
    "salsa": "a small bowl of fresh red salsa",
    "hummus": "a bowl of smooth hummus with olive oil drizzle",
    "guacamole": "a bowl of chunky guacamole",
    "bbq_sauce": "a small ramekin of BBQ sauce, dark and glossy",
    "mayonnaise": "a small ramekin of mayonnaise",
    "sriracha": "a squeeze bottle of Sriracha sauce",
    "balsamic_vinaigrette": "a small ramekin of balsamic vinaigrette dressing",
    "italian_dressing": "a small ramekin of Italian dressing",
    "caesar_dressing": "a small ramekin of creamy Caesar dressing",
    "teriyaki_sauce": "a small dish of teriyaki sauce, glossy brown",
    "maple_syrup": "a small pitcher of maple syrup, amber",
    "jam_jelly": "a small jar of strawberry jam",
    "nutella": "a small jar of Nutella hazelnut spread, opened",

    # === DRINKS ===
    "water_glass": "a clear glass of water with ice",
    "black_coffee": "a cup of black coffee in a white mug",
    "orange_juice": "a glass of fresh orange juice",
    "coca_cola": "a can of Coca-Cola",
    "diet_coke": "a can of Diet Coke",
    "gatorade": "a bottle of Gatorade sports drink, orange flavor",
    "almond_milk": "a glass of almond milk, slightly off-white",
    "oat_milk": "a glass of oat milk, creamy beige",
    "gatorade_zero": "a bottle of Gatorade Zero, blue flavor",
    "body_armor_lyte": "a bottle of Body Armor Lyte sports drink",
    "monster_energy": "a can of Monster Energy original, green logo",
    "monster_zero_ultra": "a can of Monster Zero Ultra, white can",
    "red_bull": "a can of Red Bull energy drink, blue and silver",
    "red_bull_sugar_free": "a can of Red Bull Sugar Free",
    "celsius_sparkling": "a can of Celsius sparkling energy drink",
    "fairlife_chocolate_shake": "a bottle of Fairlife chocolate protein shake",
    "fairlife_vanilla_shake": "a bottle of Fairlife vanilla protein shake",
    "premier_protein_chocolate": "a bottle of Premier Protein chocolate shake",
    "premier_protein_vanilla": "a bottle of Premier Protein vanilla shake",
    "muscle_milk_shake": "a bottle of Muscle Milk protein shake",
    "powerade_zero": "a bottle of Powerade Zero sports drink",

    # === MEALS/COMBOS ===
    "chicken_rice_bowl": "a chicken and rice bowl with vegetables, meal prep style",
    "protein_smoothie": "a tall glass of berry protein smoothie, purple-pink",
    "turkey_sandwich": "a turkey sandwich on whole wheat bread with lettuce and tomato",
    "steak_and_potatoes": "a plate of steak and roasted potatoes",
    "salmon_and_veggies": "a plate of salmon fillet with steamed vegetables",
    "egg_toast_breakfast": "toast with fried eggs and avocado slices",
    "overnight_oats": "a jar of overnight oats topped with berries",
    "tuna_salad": "a bowl of tuna salad with lettuce",
    "burrito_bowl": "a burrito bowl with rice, beans, meat, and toppings",
    "greek_yogurt_parfait": "a glass of greek yogurt parfait layered with granola and berries",

    # === MCDONALDS ===
    "mcdonalds_big_mac": "a McDonald's Big Mac burger, two patties with special sauce and lettuce",
    "mcdonalds_quarter_pounder": "a McDonald's Quarter Pounder with Cheese",
    "mcdonalds_mcchicken": "a McDonald's McChicken sandwich",
    "mcdonalds_nuggets_4pc": "4 piece McDonald's Chicken McNuggets",
    "mcdonalds_nuggets_6pc": "6 piece McDonald's Chicken McNuggets",
    "mcdonalds_nuggets_10pc": "10 piece McDonald's Chicken McNuggets in a box",
    "mcdonalds_nuggets_20pc": "20 piece McDonald's Chicken McNuggets in a box",
    "mcdonalds_filet_o_fish": "a McDonald's Filet-O-Fish sandwich",
    "mcdonalds_mcdouble": "a McDonald's McDouble burger",
    "mcdonalds_egg_mcmuffin": "a McDonald's Egg McMuffin, english muffin with egg and cheese",
    "mcdonalds_sausage_mcmuffin": "a McDonald's Sausage McMuffin",
    "mcdonalds_sausage_mcmuffin_egg": "a McDonald's Sausage McMuffin with Egg",
    "mcdonalds_hash_brown": "a McDonald's hash brown, golden and crispy",
    "mcdonalds_large_fries": "a large McDonald's french fries in red box",
    "mcdonalds_medium_fries": "a medium McDonald's french fries in red box",
    "mcdonalds_small_fries": "a small McDonald's french fries in red box",
    "mcdonalds_grilled_chicken_salad": "a McDonald's Southwest Grilled Chicken Salad",
    "mcdonalds_apple_slices": "a bag of McDonald's apple slices",
    "mcdonalds_mcflurry_oreo": "a McDonald's McFlurry with Oreo cookies",
    "mcdonalds_mcflurry_mm": "a McDonald's McFlurry with M&M's",
    "mcdonalds_hotcakes": "McDonald's hotcakes with butter and syrup",
    "mcdonalds_big_breakfast": "a McDonald's Big Breakfast plate with eggs, sausage, biscuit, hash brown",
    "mcdonalds_bacon_egg_biscuit": "a McDonald's Bacon Egg and Cheese Biscuit",
    "mcdonalds_iced_coffee": "a McDonald's iced coffee in clear cup",
    "mcdonalds_chocolate_shake": "a McDonald's chocolate milkshake in clear cup",
    "mcdonalds_vanilla_shake": "a McDonald's vanilla milkshake in clear cup",
    "mcdonalds_double_quarter_pounder": "a McDonald's Double Quarter Pounder with Cheese",
    "mcdonalds_crispy_chicken_sandwich": "a McDonald's Crispy Chicken Sandwich",
    "mcdonalds_6pc_nuggets_meal": "a McDonald's 6pc McNuggets meal with fries and drink",
    "mcdonalds_bacon_clubhouse_burger": "a McDonald's Bacon Clubhouse Burger",
    "mcdonalds_grilled_chicken_deluxe": "a McDonald's Grilled Chicken Deluxe sandwich",

    # === CHICK-FIL-A ===
    "chickfila_original_sandwich": "a Chick-fil-A Original Chicken Sandwich in wrapper",
    "chickfila_spicy_sandwich": "a Chick-fil-A Spicy Chicken Sandwich",
    "chickfila_grilled_sandwich": "a Chick-fil-A Grilled Chicken Sandwich",
    "chickfila_nuggets_8ct": "8 Chick-fil-A chicken nuggets",
    "chickfila_nuggets_12ct": "12 Chick-fil-A chicken nuggets",
    "chickfila_grilled_nuggets": "Chick-fil-A grilled chicken nuggets",
    "chickfila_waffle_fries_medium": "a medium order of Chick-fil-A waffle fries",
    "chickfila_waffle_fries_large": "a large order of Chick-fil-A waffle fries",
    "chickfila_mac_cheese": "a bowl of Chick-fil-A mac and cheese",
    "chickfila_chicken_biscuit": "a Chick-fil-A Chicken Biscuit",
    "chickfila_spicy_southwest_salad": "a Chick-fil-A Spicy Southwest Salad",
    "chickfila_grilled_cool_wrap": "a Chick-fil-A Grilled Cool Wrap, sliced",
    "chickfila_chick_n_strips": "Chick-fil-A Chick-n-Strips, breaded chicken tenders",
    "chickfila_frosted_lemonade": "a Chick-fil-A Frosted Lemonade in clear cup",
    "chickfila_milkshake": "a Chick-fil-A Cookies and Cream Milkshake in cup",
    "chickfila_hash_brown_burrito": "a Chick-fil-A Hash Brown Scramble Burrito",
    "chickfila_tortilla_soup": "a bowl of Chick-fil-A Chicken Tortilla Soup",
    "chickfila_side_salad": "a Chick-fil-A side salad",
    "chickfila_cobb_salad": "a Chick-fil-A Cobb Salad",
    "chickfila_fruit_cup": "a Chick-fil-A fruit cup with mixed fruit",
    "chickfila_chocolate_chip_cookie": "a Chick-fil-A Chocolate Chip Cookie",
    "chickfila_sauce": "a small cup of Chick-fil-A sauce, yellow dipping sauce",

    # === CHIPOTLE ===
    "chipotle_chicken_burrito": "a Chipotle chicken burrito wrapped in foil, partially unwrapped",
    "chipotle_steak_burrito": "a Chipotle steak burrito wrapped in foil",
    "chipotle_chicken_bowl": "a Chipotle chicken burrito bowl with rice, beans, salsa, guac",
    "chipotle_steak_bowl": "a Chipotle steak burrito bowl with rice, beans, and toppings",
    "chipotle_carnitas_bowl": "a Chipotle carnitas bowl with rice and toppings",
    "chipotle_sofritas_bowl": "a Chipotle sofritas bowl, tofu-based with rice",
    "chipotle_chips_guacamole": "Chipotle tortilla chips with a side of guacamole",
    "chipotle_chips_queso": "Chipotle tortilla chips with queso dip",
    "chipotle_cilantro_lime_rice": "a portion of Chipotle cilantro lime white rice",
    "chipotle_black_beans": "a portion of Chipotle black beans",
    "chipotle_pinto_beans": "a portion of Chipotle pinto beans",
    "chipotle_chicken_quesadilla": "a Chipotle chicken quesadilla, cut into triangles",
    "chipotle_steak_tacos": "three Chipotle steak tacos",
    "chipotle_chicken_tacos": "three Chipotle chicken tacos",
    "chipotle_barbacoa_bowl": "a Chipotle barbacoa bowl with rice and toppings",
    "chipotle_veggie_bowl": "a Chipotle veggie bowl with rice, beans, fajita veggies",

    # === SUBWAY ===
    "subway_turkey_6inch": "a 6-inch Subway turkey breast sub sandwich",
    "subway_italian_bmt_6inch": "a 6-inch Subway Italian BMT sub sandwich",
    "subway_chicken_teriyaki_6inch": "a 6-inch Subway chicken teriyaki sub",
    "subway_meatball_marinara_6inch": "a 6-inch Subway meatball marinara sub",
    "subway_tuna_6inch": "a 6-inch Subway tuna sub sandwich",
    "subway_veggie_delite_6inch": "a 6-inch Subway Veggie Delite sub",
    "subway_steak_cheese_6inch": "a 6-inch Subway steak and cheese sub",
    "subway_spicy_italian_6inch": "a 6-inch Subway Spicy Italian sub",
    "subway_turkey_footlong": "a footlong Subway turkey breast sub",
    "subway_italian_bmt_footlong": "a footlong Subway Italian BMT sub",
    "subway_chicken_teriyaki_footlong": "a footlong Subway chicken teriyaki sub",
    "subway_chocolate_chip_cookie": "a Subway chocolate chip cookie",
    "subway_rotisserie_chicken_6inch": "a 6-inch Subway rotisserie chicken sub",
    "subway_cold_cut_combo_6inch": "a 6-inch Subway cold cut combo sub",
    "subway_black_forest_ham_6inch": "a 6-inch Subway Black Forest Ham sub",
    "subway_meatball_marinara_footlong": "a footlong Subway meatball marinara sub",

    # === TACO BELL ===
    "tacobell_crunchy_taco": "a Taco Bell crunchy taco with beef, lettuce, cheese",
    "tacobell_soft_taco": "a Taco Bell soft taco with beef, lettuce, cheese",
    "tacobell_crunchy_taco_supreme": "a Taco Bell Crunchy Taco Supreme with sour cream",
    "tacobell_burrito_supreme": "a Taco Bell Burrito Supreme, cut in half",
    "tacobell_crunchwrap_supreme": "a Taco Bell Crunchwrap Supreme, grilled flat hexagonal wrap",
    "tacobell_chicken_quesadilla": "a Taco Bell chicken quesadilla cut into triangles",
    "tacobell_steak_quesadilla": "a Taco Bell steak quesadilla",
    "tacobell_mexican_pizza": "a Taco Bell Mexican Pizza",
    "tacobell_nachos_bellgrande": "Taco Bell Nachos BellGrande with cheese and toppings",
    "tacobell_cheesy_gordita_crunch": "a Taco Bell Cheesy Gordita Crunch",
    "tacobell_bean_burrito": "a Taco Bell Bean Burrito",
    "tacobell_chalupa_supreme": "a Taco Bell Chalupa Supreme",
    "tacobell_beefy_5layer_burrito": "a Taco Bell Beefy 5-Layer Burrito, cut in half",
    "tacobell_doritos_locos_taco": "a Taco Bell Doritos Locos Taco with nacho cheese shell",
    "tacobell_cheese_quesadilla": "a Taco Bell cheese quesadilla",
    "tacobell_chicken_burrito": "a Taco Bell chicken burrito",
    "tacobell_nachos_cheese": "Taco Bell nachos with cheese sauce",

    # === WENDY'S ===
    "wendys_daves_single": "a Wendy's Dave's Single burger with square patty",
    "wendys_daves_double": "a Wendy's Dave's Double burger, two square patties",
    "wendys_daves_triple": "a Wendy's Dave's Triple burger, three square patties",
    "wendys_baconator": "a Wendy's Baconator burger with bacon strips",
    "wendys_spicy_chicken_sandwich": "a Wendy's Spicy Chicken Sandwich",
    "wendys_jr_cheeseburger": "a Wendy's Jr. Cheeseburger",
    "wendys_jr_bacon_cheeseburger": "a Wendy's Jr. Bacon Cheeseburger",
    "wendys_nuggets_4ct": "4 Wendy's chicken nuggets",
    "wendys_nuggets_10ct": "10 Wendy's chicken nuggets",
    "wendys_large_fries": "a large order of Wendy's natural-cut fries",
    "wendys_chili_small": "a small cup of Wendy's chili",
    "wendys_chili_large": "a large cup of Wendy's chili",
    "wendys_baked_potato": "a Wendy's plain baked potato",
    "wendys_frosty_chocolate": "a Wendy's Chocolate Frosty in a clear cup",
    "wendys_frosty_vanilla": "a Wendy's Vanilla Frosty in a clear cup",
    "wendys_classic_chicken_sandwich": "a Wendy's Classic Chicken Sandwich",

    # === BURGER KING ===
    "bk_whopper": "a Burger King Whopper, flame-grilled patty with lettuce and tomato",
    "bk_whopper_jr": "a Burger King Whopper Jr.",
    "bk_whopper_with_cheese": "a Burger King Whopper with Cheese",
    "bk_original_chicken_sandwich": "a Burger King Original Chicken Sandwich",
    "bk_chicken_fries": "Burger King Chicken Fries in a box",
    "bk_onion_rings": "Burger King onion rings",
    "bk_bacon_cheeseburger": "a Burger King Bacon Cheeseburger",
    "bk_double_whopper": "a Burger King Double Whopper",
    "bk_impossible_whopper": "a Burger King Impossible Whopper",
    "bk_french_fries_medium": "a medium order of Burger King french fries",
    "bk_chicken_jr": "a Burger King Chicken Jr. sandwich",
    "bk_hash_browns": "Burger King hash browns, golden and crispy",

    # === FIVE GUYS ===
    "fiveguys_cheeseburger": "a Five Guys cheeseburger in foil wrapper, messy and loaded",
    "fiveguys_little_cheeseburger": "a Five Guys Little Cheeseburger",
    "fiveguys_bacon_cheeseburger": "a Five Guys Bacon Cheeseburger, loaded with toppings",
    "fiveguys_little_bacon_cheeseburger": "a Five Guys Little Bacon Cheeseburger",
    "fiveguys_cajun_fries": "a cup of Five Guys Cajun Fries, seasoned",
    "fiveguys_regular_fries": "a cup of Five Guys regular fries",
    "fiveguys_hot_dog": "a Five Guys hot dog in a bun",
    "fiveguys_veggie_sandwich": "a Five Guys Veggie Sandwich loaded with toppings",

    # === PANDA EXPRESS ===
    "panda_orange_chicken": "a plate of Panda Express Orange Chicken, glazed and glossy",
    "panda_beijing_beef": "a plate of Panda Express Beijing Beef with crispy beef strips",
    "panda_kung_pao_chicken": "a plate of Panda Express Kung Pao Chicken with peanuts",
    "panda_broccoli_beef": "a plate of Panda Express Broccoli Beef",
    "panda_fried_rice": "a plate of Panda Express fried rice",
    "panda_chow_mein": "a plate of Panda Express chow mein noodles",
    "panda_super_greens": "a plate of Panda Express Super Greens, mixed vegetables",
    "panda_string_bean_chicken": "a plate of Panda Express String Bean Chicken Breast",
    "panda_teriyaki_chicken": "a plate of Panda Express Grilled Teriyaki Chicken",
    "panda_honey_walnut_shrimp": "a plate of Panda Express Honey Walnut Shrimp",
    "panda_mushroom_chicken": "a plate of Panda Express Mushroom Chicken",
    "panda_steamed_white_rice": "a plate of Panda Express steamed white rice",

    # === POPEYES ===
    "popeyes_classic_chicken_sandwich": "a Popeyes Classic Chicken Sandwich with pickles",
    "popeyes_spicy_chicken_sandwich": "a Popeyes Spicy Chicken Sandwich",
    "popeyes_chicken_breast": "a Popeyes fried chicken breast piece, crispy",
    "popeyes_chicken_thigh": "a Popeyes fried chicken thigh piece",
    "popeyes_cajun_fries": "a box of Popeyes Cajun Fries, seasoned",
    "popeyes_red_beans_rice": "a portion of Popeyes Red Beans and Rice",
    "popeyes_biscuit": "a Popeyes buttermilk biscuit, golden flaky",
    "popeyes_chicken_tenders": "Popeyes chicken tenders, crispy breaded",
    "popeyes_mashed_potatoes": "Popeyes mashed potatoes with cajun gravy",
    "popeyes_coleslaw": "a portion of Popeyes coleslaw",

    # === STARBUCKS ===
    "starbucks_caramel_frappuccino": "a Starbucks Caramel Frappuccino in branded clear cup with whipped cream",
    "starbucks_caffe_latte": "a Starbucks Caffè Latte in a white cup",
    "starbucks_caffe_mocha": "a Starbucks Caffè Mocha with whipped cream",
    "starbucks_pike_place_coffee": "a Starbucks Pike Place brewed coffee in a paper cup",
    "starbucks_iced_caramel_macchiato": "a Starbucks Iced Caramel Macchiato in clear cup",
    "starbucks_cake_pop": "a Starbucks birthday cake pop on a stick",
    "starbucks_bacon_gouda_sandwich": "a Starbucks Bacon Gouda breakfast sandwich",
    "starbucks_spinach_feta_wrap": "a Starbucks Spinach Feta Wrap",
    "starbucks_impossible_sandwich": "a Starbucks Impossible Breakfast Sandwich",
    "starbucks_butter_croissant": "a Starbucks butter croissant, golden flaky",
    "starbucks_blueberry_muffin": "a Starbucks blueberry muffin",
    "starbucks_banana_nut_bread": "a slice of Starbucks banana nut bread",
    "starbucks_protein_box": "a Starbucks Protein Box with eggs, cheese, fruit, and bread",
    "starbucks_vanilla_sweet_cream_cold_brew": "a Starbucks Vanilla Sweet Cream Cold Brew in clear cup",
    "starbucks_matcha_latte": "a Starbucks Matcha Green Tea Latte, vibrant green",
    "starbucks_chai_tea_latte": "a Starbucks Chai Tea Latte in a cup",
    "starbucks_double_chocolate_brownie": "a Starbucks Double Chocolate Brownie",

    # === DUNKIN ===
    "dunkin_iced_coffee_cream_sugar": "a Dunkin iced coffee with cream and sugar in branded cup",
    "dunkin_iced_coffee_black": "a Dunkin iced coffee black in branded cup",
    "dunkin_glazed_donut": "a Dunkin glazed donut, classic",
    "dunkin_boston_kreme_donut": "a Dunkin Boston Kreme donut with chocolate glaze",
    "dunkin_chocolate_frosted_donut": "a Dunkin chocolate frosted donut",
    "dunkin_bacon_egg_cheese_croissant": "a Dunkin Bacon Egg and Cheese on a croissant",
    "dunkin_bacon_egg_cheese_bagel": "a Dunkin Bacon Egg and Cheese on a bagel",
    "dunkin_plain_bagel_cream_cheese": "a Dunkin plain bagel with cream cheese",
    "dunkin_hash_browns": "Dunkin hash browns, golden and crispy",
    "dunkin_munchkins": "a box of Dunkin Munchkins donut holes, assorted",
    "dunkin_sausage_egg_cheese_wrap": "a Dunkin Wake-Up Wrap with sausage, egg, cheese",
    "dunkin_hot_latte": "a Dunkin hot latte in branded cup",

    # === PIZZA ===
    "pizzahut_cheese_pizza_slice": "a slice of Pizza Hut cheese pizza, stretchy mozzarella",
    "pizzahut_pepperoni_pizza_slice": "a slice of Pizza Hut pepperoni pizza",
    "pizzahut_supreme_pizza_slice": "a slice of Pizza Hut supreme pizza with all toppings",
    "pizzahut_breadsticks": "Pizza Hut breadsticks with marinara dipping sauce",
    "pizzahut_garlic_bread": "Pizza Hut garlic bread, golden with butter",
    "pizzahut_bone_out_wings": "Pizza Hut boneless wings with sauce",
    "dominos_cheese_pizza_slice": "a slice of Domino's cheese pizza",
    "dominos_pepperoni_pizza_slice": "a slice of Domino's pepperoni pizza",
    "dominos_cinnamon_bread_twists": "Domino's Cinnamon Bread Twists with icing",
    "dominos_boneless_wings": "Domino's boneless chicken wings",
    "papajohns_cheese_pizza_slice": "a slice of Papa John's cheese pizza",
    "papajohns_pepperoni_pizza_slice": "a slice of Papa John's pepperoni pizza",
    "papajohns_garlic_knots": "Papa John's garlic knots",
    "papajohns_breadsticks": "Papa John's breadsticks with cheese dipping sauce",

    # === SIT-DOWN RESTAURANTS ===
    "olivegarden_chicken_alfredo": "Olive Garden Chicken Alfredo pasta in a bowl",
    "olivegarden_tour_of_italy": "Olive Garden Tour of Italy plate with chicken parm, lasagna, alfredo",
    "olivegarden_breadstick": "an Olive Garden breadstick, golden and buttery",
    "olivegarden_house_salad": "Olive Garden house salad with Italian dressing",
    "olivegarden_chicken_parmigiana": "Olive Garden Chicken Parmigiana with marinara",
    "olivegarden_fettuccine_alfredo": "Olive Garden Fettuccine Alfredo, creamy white sauce",
    "applebees_classic_burger": "an Applebee's Classic Burger with fries",
    "applebees_boneless_wings": "Applebee's boneless wings with sauce",
    "applebees_chicken_tenders_basket": "Applebee's Chicken Tenders Basket with fries",
    "applebees_loaded_fries": "Applebee's Loaded Fries with cheese, bacon",
    "chilis_oldtimer_burger": "a Chili's Oldtimer Burger",
    "chilis_chicken_crispers": "Chili's Chicken Crispers, breaded chicken tenders",
    "chilis_baby_back_ribs": "Chili's Baby Back Ribs with BBQ glaze",
    "chilis_chicken_bacon_ranch_quesadillas": "Chili's Chicken Bacon Ranch Quesadilla, sliced",
    "chilis_classic_buffalo_wings": "Chili's Classic Buffalo Wings",
    "tgifridays_cajun_shrimp_chicken_pasta": "TGI Friday's Cajun Shrimp and Chicken Pasta",
    "tgifridays_fridays_burger": "a TGI Friday's burger",
    "tgifridays_sesame_jack_chicken_strips": "TGI Friday's Sesame Jack Chicken Strips",

    # === CEREALS ===
    "cheerios": "a bowl of Cheerios cereal with milk",
    "frosted_flakes": "a bowl of Frosted Flakes cereal with milk",
    "special_k": "a bowl of Special K cereal with milk",
    "raisin_bran": "a bowl of Raisin Bran cereal with milk",
    "lucky_charms": "a bowl of Lucky Charms cereal with marshmallows and milk",
    "cinnamon_toast_crunch": "a bowl of Cinnamon Toast Crunch cereal with milk",
    "honey_nut_cheerios": "a bowl of Honey Nut Cheerios cereal with milk",
    "froot_loops": "a bowl of Froot Loops cereal with milk, colorful",

    # === SNACKS ===
    "doritos_nacho_cheese": "a pile of Nacho Cheese Doritos chips",
    "doritos_cool_ranch": "a pile of Cool Ranch Doritos chips",
    "cheez_its_original": "a pile of Cheez-It crackers",
    "goldfish_cheddar": "a pile of Goldfish cheddar crackers",
    "hard_pretzels": "a pile of hard pretzel twists",
    "rice_cakes_lightly_salted": "stacked lightly salted rice cakes",
    "movie_theater_popcorn": "a large tub of buttered movie theater popcorn",
    "skinny_pop": "a bowl of SkinnyPop popcorn",
    "trail_mix": "a handful of trail mix with nuts, raisins, and chocolate",
    "beef_jerky_original": "strips of original beef jerky",
    "beef_jerky_teriyaki": "strips of teriyaki beef jerky",
    "cheddar_sour_cream_chips": "a pile of cheddar and sour cream flavored potato chips",
    "peanut_butter_crackers": "peanut butter sandwich crackers",
    "veggie_straws_original": "a pile of Veggie Straws crisps, colorful",

    # === FROZEN MEALS ===
    "lean_cuisine_chicken_alfredo": "a Lean Cuisine Chicken Alfredo frozen meal, in tray",
    "lean_cuisine_herb_roasted_chicken": "a Lean Cuisine Herb Roasted Chicken frozen meal",
    "healthy_choice_cafe_steamers": "a Healthy Choice Cafe Steamers meal in tray",
    "healthy_choice_power_bowl": "a Healthy Choice Power Bowl",
    "hot_pockets_cheese_pizza": "a Hot Pocket Cheese Pizza, bitten to show filling",
    "hot_pockets_pepperoni_pizza": "a Hot Pocket Pepperoni Pizza, bitten to show filling",
    "digiorno_cheese_pizza_slice": "a slice of DiGiorno frozen cheese pizza, baked",
    "digiorno_pepperoni_pizza_slice": "a slice of DiGiorno frozen pepperoni pizza, baked",
    "totinos_pizza_rolls": "a plate of Totino's Pizza Rolls, golden and crispy",
    "totinos_party_pizza": "a Totino's Party Pizza, baked and sliced",
    "amys_bean_cheese_burrito": "an Amy's Bean and Cheese Burrito, unwrapped",
    "amys_cheese_enchilada": "Amy's Cheese Enchilada in tray",

    # === DESSERTS & SWEETS ===
    "vanilla_ice_cream": "a bowl of vanilla ice cream scoops",
    "chocolate_ice_cream": "a bowl of chocolate ice cream scoops",
    "frozen_yogurt_vanilla": "a bowl of vanilla frozen yogurt",
    "brownie_homemade": "a homemade chocolate brownie, fudgy",
    "chocolate_chip_cookie_large": "a large chocolate chip cookie",
    "cheesecake_slice": "a slice of New York cheesecake",
    "apple_pie_slice": "a slice of apple pie with lattice crust",
    "plain_glazed_donut": "a plain glazed donut, shiny",
    "cinnamon_roll_large": "a large frosted cinnamon roll with icing",
    "blueberry_muffin_bakery": "a bakery-style blueberry muffin",
    "pancakes_3": "a stack of three fluffy pancakes with butter and syrup",
    "waffles_2": "two golden waffles stacked with butter and syrup",
    "french_toast_2_slices": "two slices of french toast with powdered sugar",
    "dark_chocolate_70": "squares of dark chocolate 70% cacao",
    "milk_chocolate": "squares of milk chocolate",
    "snickers_bar": "a Snickers bar, cut in half showing layers",
    "kit_kat_4finger": "a Kit Kat 4-finger bar, broken apart",
    "reeses_peanut_butter_cups": "two Reese's Peanut Butter Cups",
    "mms_peanut": "a pile of Peanut M&M's, colorful",
    "skittles_original": "a pile of Skittles original candies, rainbow colors",
    "oreo_cookies_3": "three Oreo cookies stacked",
    "chips_ahoy_3": "three Chips Ahoy chocolate chip cookies",
    "rice_krispies_treat": "a Rice Krispies Treat, marshmallow cereal bar",
    "pop_tart_frosted_strawberry": "a frosted strawberry Pop-Tart",
    "ben_and_jerrys_chocolate_fudge_brownie": "a pint of Ben and Jerry's Chocolate Fudge Brownie ice cream, open",
    "halo_top_vanilla_bean": "a pint of Halo Top Vanilla Bean ice cream, open",

    # === PUERTO RICAN / LATIN FOODS ===
    "arroz_blanco": "a mound of Puerto Rican arroz blanco, plain white rice cooked with oil and salt",
    "arroz_amarillo": "a mound of arroz amarillo, yellow rice with saffron and sofrito",
    "arroz_con_gandules": "a plate of arroz con gandules, Puerto Rican rice with pigeon peas",
    "arroz_con_pollo": "a plate of arroz con pollo, Latin chicken and rice",
    "arroz_con_habichuelas": "a plate of arroz con habichuelas, rice and beans Puerto Rican style",
    "arroz_con_salchichas": "a plate of arroz con salchichas, rice with Vienna sausages in tomato sauce",
    "arroz_con_maiz": "a plate of arroz con maíz, rice with corn kernels",
    "arroz_mamposteao": "a plate of arroz mamposteao, refried rice with beans mixed in",
    "arroz_con_dulce": "a bowl of arroz con dulce, Puerto Rican coconut rice pudding with cinnamon",
    "pegao": "a piece of pegao, crispy rice from the bottom of the pot, golden crust",
    "habichuelas_guisadas_rosadas": "a bowl of habichuelas guisadas rosadas, pink beans stewed in sofrito",
    "habichuelas_guisadas_rojas": "a bowl of habichuelas guisadas rojas, red beans stewed in sofrito",
    "habichuelas_guisadas_blancas": "a bowl of habichuelas guisadas blancas, white beans stewed",
    "habichuelas_negras_guisadas": "a bowl of habichuelas negras guisadas, stewed black beans",
    "gandules_guisados": "a bowl of gandules guisados, stewed pigeon peas",
    "pernil": "sliced pernil, slow-roasted Puerto Rican pork shoulder with crispy skin",
    "lechon_asado": "sliced lechón asado, whole roasted pig with crispy crackling skin",
    "pollo_guisado": "a plate of pollo guisado, Puerto Rican braised chicken in tomato sofrito",
    "carne_guisada": "a plate of carne guisada, Puerto Rican beef stew",
    "bistec_encebollado": "a plate of bistec encebollado, thin steak smothered in sautéed onions",
    "chuleta_kan_kan": "a chuleta kan kan, Puerto Rican thick-cut fried pork chop with fat cap",
    "churrasco": "grilled churrasco skirt steak, charred",
    "pollo_frito": "pieces of pollo frito, Latin fried chicken",
    "pollo_a_la_brasa": "pollo a la brasa, Peruvian-style rotisserie chicken, golden",
    "carne_frita": "pieces of carne frita, Puerto Rican fried pork chunks",
    "chicharron_de_pollo": "pieces of chicharrón de pollo, fried chicken chunks crispy",
    "chicharron_de_cerdo": "pieces of chicharrón de cerdo, fried pork rinds crispy",
    "camarones_al_ajillo": "a plate of camarones al ajillo, garlic shrimp in olive oil",
    "mofongo_relleno_camarones": "mofongo relleno de camarones, mashed plantain mound stuffed with shrimp",
    "asopao_de_camarones": "a bowl of asopao de camarones, Puerto Rican shrimp gumbo-like soup",
    "pescado_frito": "a whole fried fish, pescado frito, crispy golden",
    "ensalada_de_pulpo": "a bowl of ensalada de pulpo, Puerto Rican octopus salad",
    "bacalao_guisado": "a plate of bacalao guisado, salt cod stew",
    "serenata_de_bacalao": "a plate of serenata de bacalao, salt cod salad with viandas",
    "mofongo_plain": "a dome of mofongo, mashed green plantain with garlic and pork cracklings",
    "mofongo_relleno_pollo": "mofongo relleno de pollo, mashed plantain stuffed with chicken",
    "mofongo_relleno_carne": "mofongo relleno de carne, mashed plantain stuffed with beef",
    "tostones": "a plate of tostones, twice-fried green plantain discs, golden and crispy",
    "amarillos_maduros": "a plate of amarillos maduros, sweet fried ripe plantain slices, caramelized",
    "trifongo": "a plate of trifongo, mashed mix of green plantain, sweet plantain, and yuca",
    "mofongo_de_yuca": "a dome of mofongo de yuca, mashed cassava",
    "alcapurria_meat": "alcapurrias, Puerto Rican fried fritters stuffed with meat, golden crust",
    "alcapurria_crab": "alcapurrias de jueyes, Puerto Rican fried fritters stuffed with crab",
    "bacalaito": "bacalaítos, thin crispy codfish fritters, golden",
    "empanadilla_carne": "empanadillas de carne, Puerto Rican fried meat turnovers",
    "empanadilla_pollo": "empanadillas de pollo, Puerto Rican fried chicken turnovers",
    "empanadilla_pizza": "empanadillas de pizza, Puerto Rican fried pizza turnovers",
    "sorullito_de_maiz": "sorullitos de maíz, Puerto Rican sweet corn fritters, golden cylinders",
    "relleno_de_papa": "rellenos de papa, Puerto Rican stuffed potato balls, fried golden",
    "papa_rellena": "papa rellena, stuffed potato ball, fried",
    "pionono": "piononos, sweet plantain rolls stuffed with ground beef",
    "aranitas_de_platano": "arañitas de plátano, crispy shredded plantain fritters",
    "toston_relleno": "tostón relleno, a large fried plantain cup filled with meat",
    "sancocho_puertorriqueno": "a bowl of sancocho puertorriqueño, hearty root vegetable and meat stew",
    "asopao_de_pollo": "a bowl of asopao de pollo, Puerto Rican chicken rice soup",
    "sopa_de_pollo_fideos": "a bowl of sopa de pollo con fideos, chicken noodle soup Latin style",
    "sopa_de_platano": "a bowl of sopa de plátano, plantain soup",
    "caldo_de_res": "a bowl of caldo de res, Latin beef broth with vegetables",
    "yuca_hervida": "a plate of yuca hervida, boiled cassava pieces",
    "yuca_frita": "a plate of yuca frita, fried cassava sticks, golden and crispy",
    "batata_boniato": "a baked batata/boniato, white sweet potato",
    "guineo_verde_hervido": "boiled green bananas, guineo verde hervido",
    "platano_hervido": "boiled green plantain slices",
    "ensalada_de_coditos": "a bowl of ensalada de coditos, Puerto Rican macaroni salad",
    "ensalada_de_papa": "a bowl of ensalada de papa, Puerto Rican potato salad",
    "pastelon_de_platano_maduro": "a slice of pastelón, Puerto Rican sweet plantain lasagna with ground beef",
    "pasteles_pork": "Puerto Rican pasteles, banana leaf-wrapped parcels with pork filling, unwrapped",
    "pasteles_de_yuca": "pasteles de yuca, cassava-based pasteles, unwrapped from banana leaf",
    "lasagna_boricua": "a slice of lasagna boricua, Puerto Rican style lasagna",
    "huevos_revueltos_jamon": "huevos revueltos con jamón, scrambled eggs with ham, Latin style",
    "tortilla_de_huevo": "a tortilla de huevo, Spanish-style egg omelette",
    "avena_pr": "a glass of avena, Puerto Rican oatmeal drink, thick and creamy",
    "pan_sobao": "pan sobao, Puerto Rican soft bread roll",
    "pan_de_agua": "pan de agua, Puerto Rican water bread, crusty exterior",
    "mallorca_bread": "a mallorca bread roll, sweet and dusted with powdered sugar",
    "mallorca_jamon_queso": "a mallorca sandwich with ham and cheese, powdered sugar on top",
    "quesito": "a quesito, Puerto Rican puff pastry filled with cream cheese",
    "pastelillo_de_guayaba": "a pastelillo de guayaba, fried guava pastry turnover",
    "pastelillo_guayaba_queso": "a pastelillo de guayaba y queso, fried guava and cheese pastry",
    "tembleque": "a square of tembleque, Puerto Rican coconut pudding with cinnamon on top",
    "flan_de_queso": "a slice of flan de queso, Puerto Rican cream cheese flan with caramel",
    "flan_de_coco": "a slice of flan de coco, coconut flan with caramel sauce",
    "tres_leches_cake": "a slice of tres leches cake, soaked sponge cake with whipped cream",
    "limber_de_coco": "a limber de coco, Puerto Rican coconut ice pop in a cup",
    "piragua": "a piragua, Puerto Rican shaved ice cone with colorful syrup",
    "cafe_con_leche": "a cup of café con leche, Puerto Rican coffee with milk",
    "cafe_puya": "a small cup of café puya, strong Puerto Rican black espresso",
    "malta_india": "a bottle of Malta India, Puerto Rican malt beverage, dark brown",
    "coquito": "a glass of coquito, Puerto Rican coconut eggnog, creamy white with cinnamon",
    "jugo_de_parcha": "a glass of jugo de parcha, passion fruit juice, orange-yellow",
    "jugo_de_guayaba": "a glass of jugo de guayaba, guava juice, pink",
    "pina_colada": "a glass of piña colada, creamy tropical cocktail with pineapple garnish",

    # === DOMINICAN / OTHER LATIN ===
    "pica_pollo": "pica pollo, Dominican fried chicken pieces, crispy golden",
    "yaroa_de_pollo": "a plate of yaroa de pollo, Dominican chicken with cheese and ketchup/mayo on fries",
    "mangu": "a plate of mangú, Dominican mashed plantains with sautéed onions",
    "tres_golpes": "a plate of tres golpes, Dominican breakfast with mangú, eggs, cheese, and salami",
    "sancocho_dominicano": "a bowl of sancocho dominicano, Dominican meat and root vegetable stew",
    "chimichurri_burger": "a Dominican chimichurri burger, loaded with cabbage slaw",
    "moro_habichuelas_negras": "a mound of moro de habichuelas negras, Dominican black beans and rice",
    "moro_gandules": "a mound of moro de gandules, rice with pigeon peas Dominican style",
    "habichuela_con_dulce": "a bowl of habichuela con dulce, Dominican sweet cream bean dessert",
    "concon": "a piece of concón, Dominican crispy rice crust from the bottom of the pot",
    "chofan": "a plate of chofán, Dominican fried rice",
    "cubano_sandwich": "a Cuban sandwich pressed and toasted, with ham, pork, cheese, pickles, mustard",
    "ropa_vieja": "a plate of ropa vieja, Cuban shredded beef in tomato sauce",
    "vaca_frita": "a plate of vaca frita, Cuban crispy fried shredded beef with onions",
    "medianoche_sandwich": "a medianoche sandwich, Cuban sweet bread with pork, ham, cheese",
    "croquetas_de_jamon": "croquetas de jamón, Cuban ham croquettes, golden and fried",

    # === INTERNATIONAL ===
    "california_roll": "California roll sushi pieces, 6 pieces with rice, crab, avocado",
    "spicy_tuna_roll": "spicy tuna roll sushi pieces, topped with spicy mayo",
    "salmon_roll": "salmon roll sushi pieces, fresh orange salmon on rice",
    "pad_thai_chicken": "a plate of Pad Thai with chicken, noodles, peanuts, lime",
    "fried_rice_takeout": "a plate of Chinese takeout fried rice with vegetables",
    "lo_mein_chicken": "a plate of chicken lo mein noodles",
    "general_tsos_chicken": "a plate of General Tso's Chicken, crispy with sweet sauce",
    "chicken_tikka_masala": "a bowl of chicken tikka masala, orange creamy curry",
    "falafel": "falafel balls, crispy fried chickpea fritters",
    "chicken_shawarma_wrap": "a chicken shawarma wrap with garlic sauce",
    "gyro_lamb_beef": "a lamb and beef gyro wrap with tzatziki sauce",
    "pho_beef": "a bowl of beef pho, Vietnamese noodle soup with herbs",
    "instant_ramen": "a bowl of cooked instant ramen noodles with soft egg",
    "restaurant_ramen_tonkotsu": "a bowl of tonkotsu ramen with pork belly, egg, nori",
    "bibimbap": "a bowl of Korean bibimbap with vegetables, egg, and gochujang",
    "pork_tamale": "unwrapped pork tamales with red sauce",
    "beef_empanada": "beef empanadas, golden fried turnovers",
    "pupusa_cheese": "a pupusa, Salvadoran stuffed corn tortilla with cheese",
    "jerk_chicken_thigh": "jerk chicken thigh, Jamaican style, charred and spiced",
    "chicken_curry_thai_green": "a bowl of Thai green chicken curry with basil",
    "chicken_curry_japanese": "a plate of Japanese chicken curry with rice",
    "pork_dumplings_steamed": "steamed pork dumplings, translucent wrappers",
    "pork_dumplings_fried": "pan-fried pork dumplings, golden crispy bottom",
    "vegetable_spring_rolls": "fried vegetable spring rolls, golden and crispy",
    "pork_egg_rolls": "fried pork egg rolls, golden and crispy",
    "arepas_cheese": "arepas with melted cheese, Venezuelan corn cakes",
    "chicken_teriyaki_bowl": "a chicken teriyaki bowl with rice and vegetables",
    "butter_chicken": "a bowl of Indian butter chicken, rich orange-red creamy curry",
    "lamb_curry_vindaloo": "a bowl of lamb vindaloo curry, spicy red",
    "vegetable_samosa": "vegetable samosas, fried triangular pastries",
    "chicken_satay": "chicken satay skewers with peanut dipping sauce",

    # === OTHER CHAINS ===
    "polloTropical_tropichop": "a Pollo Tropical TropiChop bowl with chicken, rice, beans",
    "polloTropical_quarter_chicken_dark": "a Pollo Tropical quarter dark chicken, roasted",
    "polloTropical_quarter_chicken_white": "a Pollo Tropical quarter white chicken, roasted",
    "polloTropical_moro_rice": "a portion of Pollo Tropical moro rice",
    "polloTropical_sweet_plantains": "Pollo Tropical sweet plantains, caramelized",
    "innout_double_double": "an In-N-Out Double-Double burger with spread, lettuce, tomato",
    "innout_cheeseburger_protein_style": "an In-N-Out cheeseburger protein style, wrapped in lettuce",
    "innout_animal_style_fries": "In-N-Out Animal Style Fries with spread, cheese, grilled onions",
    "deltaco_crunchy_taco": "a Del Taco crunchy taco",
    "whitecastle_original_slider": "a White Castle original slider, small square burger",
    "qdoba_chicken_burrito_bowl": "a Qdoba chicken burrito bowl with rice and toppings",
    "arbys_original_roast_beef": "an Arby's Original Roast Beef sandwich",
}

def get_prompt(food_name):
    """Generate the full Flux Dev prompt for a food item."""
    desc = FOOD_DESCRIPTIONS.get(food_name)
    if not desc:
        # Auto-generate from filename
        readable = food_name.replace("_", " ")
        desc = f"{readable}"

    # For drinks/bottles/cups, don't say "on a white plate"
    drink_keywords = ["glass", "cup", "bottle", "can", "shake", "coffee", "latte", "juice",
                      "colada", "frappuccino", "frosty", "milkshake", "milk", "water", "cola",
                      "coke", "gatorade", "monster", "red_bull", "celsius", "powerade", "malta",
                      "coquito", "avena", "cafe", "lemonade"]
    is_drink = any(kw in food_name.lower() or kw in desc.lower() for kw in drink_keywords)

    if is_drink:
        return f"RAW photo, {desc}, centered on a clean white surface, pure white background, soft diffused natural daylight, overhead shot slightly angled, no harsh shadows, product photography style for a food delivery app, photorealistic, shot on Canon EOS R5 50mm f2.8"
    else:
        return f"RAW photo, {desc}, on a round white ceramic plate centered on a clean white surface, pure white background, soft diffused natural daylight from above, overhead top-down shot, no harsh shadows, the food looks real and appetizing not artificial, product photography for a food delivery app, photorealistic, shot on Canon EOS R5 50mm f2.8"

def queue_prompt(prompt_text, filename, seed):
    """Send a generation job to ComfyUI."""
    workflow = {
        "prompt": {
            "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": "flux1-dev-Q8_0.gguf"}},
            "2": {"class_type": "DualCLIPLoaderGGUF", "inputs": {"clip_name1": "clip_l.safetensors", "clip_name2": "t5-v1_1-xxl-encoder-Q8_0.gguf", "type": "flux"}},
            "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt_text, "clip": ["2", 0]}},
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["2", 0]}},
            "50": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["4", 0], "guidance": 3.0}},
            "6": {"class_type": "EmptyLatentImage", "inputs": {"width": 768, "height": 768, "batch_size": 1}},
            "7": {"class_type": "KSampler", "inputs": {
                "model": ["1", 0], "positive": ["50", 0], "negative": ["5", 0],
                "latent_image": ["6", 0], "seed": seed, "steps": 25, "cfg": 1.0,
                "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0
            }},
            "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": f"food_{filename}", "images": ["8", 0]}}
        }
    }
    r = requests.post(f"{COMFY}/prompt", json=workflow)
    return r.json()["prompt_id"]

def wait_for_result(prompt_id, filename, timeout=300):
    """Wait for ComfyUI to finish and save the result."""
    start = time.time()
    while time.time() - start < timeout:
        time.sleep(3)
        try:
            r = requests.get(f"{COMFY}/history/{prompt_id}")
            data = r.json()
            if prompt_id in data:
                out = data[prompt_id].get("outputs", {}).get("9", {}).get("images", [])
                if out:
                    fname = out[0]["filename"]
                    # Download and save as PNG
                    img_data = requests.get(f"{COMFY}/view?filename={fname}&type=output").content
                    out_path = os.path.join(OUTPUT_DIR, f"{filename}.png")
                    with open(out_path, "wb") as f:
                        f.write(img_data)
                    return out_path
        except:
            pass
    return None

def main():
    # Check which images already exist
    existing = set()
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith(".png"):
            existing.add(f.replace(".png", ""))

    remaining = [img for img in images if img not in existing]
    total = len(remaining)

    print(f"Total food images needed: {len(images)}")
    print(f"Already generated: {len(existing)}")
    print(f"Remaining to generate: {total}")
    print(f"Estimated time: {total * 45 / 3600:.1f} hours")
    print("=" * 60)

    if "--dry-run" in sys.argv:
        for i, img in enumerate(remaining[:10]):
            print(f"  [{i+1}] {img}: {get_prompt(img)[:80]}...")
        return

    for i, img in enumerate(remaining):
        seed = hash(img) % 999999 + 10000  # Deterministic seed per food
        prompt_text = get_prompt(img)

        print(f"[{i+1}/{total}] Generating: {img}")
        print(f"  Prompt: {prompt_text[:100]}...")

        try:
            pid = queue_prompt(prompt_text, img, seed)
            result = wait_for_result(pid, img)
            if result:
                print(f"  OK Saved: {result}")
            else:
                print(f"  FAIL TIMEOUT: {img}")
        except Exception as e:
            print(f"  FAIL ERROR: {e}")

        # Small delay between jobs
        time.sleep(1)

    print("\n" + "=" * 60)
    print("DONE! All food images generated.")

if __name__ == "__main__":
    main()
