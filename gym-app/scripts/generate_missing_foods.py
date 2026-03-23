"""
Batch generate food images via ComfyUI API (FLUX.1-schnell fp8).
Style: food on a dark/black plate, white background, top-down studio food photography.

Usage:
  1. Start ComfyUI (default http://127.0.0.1:8188)
  2. python scripts/generate_missing_foods.py
"""

import json, urllib.request, urllib.parse, urllib.error, time, os, sys

COMFY_URL = "http://127.0.0.1:8188"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "foods")

# Format: (filename_without_ext, visual_description)
FOODS = [
    # ── 19 previously missing (already in DB) ────────────────────────────────
    ("creatine_monohydrate",    "a small scoop of white creatine monohydrate powder on a black plate"),
    ("bcaa_powder",             "a scoop of bright blue BCAA amino acid powder on a black plate"),
    ("cooking_spray_pam",       "a can of PAM cooking spray on a white background"),
    ("sopa_de_salchichon",      "Puerto Rican sopa de salchichon sausage soup with potatoes in a bowl on a black plate"),
    ("majarete",                "Puerto Rican majarete corn pudding topped with cinnamon in a small bowl on a black plate"),
    ("panqueques_con_sirope",   "a stack of three fluffy pancakes with maple syrup on a black plate"),
    ("bizcocho_de_ron",         "a slice of Puerto Rican rum cake with glaze on a black plate"),
    ("mantecaditos",            "three Puerto Rican mantecaditos shortbread cookies with sprinkles on a black plate"),
    ("polvoron",                "three crumbly Puerto Rican polvoron shortbread cookies on a black plate"),
    ("limber_de_parcha",        "a Puerto Rican limber de parcha frozen passion fruit treat in a cup on a black plate"),
    ("dulce_de_lechoza",        "Puerto Rican dulce de lechoza candied papaya in syrup on a black plate"),
    ("arroz_con_coco",          "a serving of Caribbean arroz con coco coconut rice on a black plate"),
    ("besitos_de_coco",         "three golden Puerto Rican besitos de coco coconut cookies on a black plate"),
    ("jugo_de_acerola",         "a glass of bright red acerola cherry juice on a black plate"),
    ("morir_sonando",           "a tall glass of creamy orange juice and milk Dominican drink morir sonando"),
    ("medalla_light",           "a can of Medalla Light Puerto Rican beer on a black plate"),
    ("pastelitos_dominicanos",  "two golden fried Dominican pastelitos chicken turnovers on a black plate"),
    ("empanada_de_carne",       "a golden fried beef empanada cut in half showing filling on a black plate"),
    ("arepas_de_queso",         "two golden Venezuelan arepas stuffed with melted white cheese on a black plate"),

    # ── KFC (10) ──────────────────────────────────────────────────────────────
    ("kfc_original_chicken_breast",   "KFC original recipe fried chicken breast piece on a black plate"),
    ("kfc_extra_crispy_breast",       "KFC extra crispy fried chicken breast on a black plate"),
    ("kfc_spicy_chicken_sandwich",    "KFC spicy crispy chicken sandwich on a black plate"),
    ("kfc_famous_bowl",               "KFC famous bowl with mashed potatoes chicken corn and gravy on a black plate"),
    ("kfc_mac_cheese",                "KFC mac and cheese in a small container on a black plate"),
    ("kfc_mashed_potatoes_gravy",     "KFC creamy mashed potatoes with brown gravy on a black plate"),
    ("kfc_coleslaw",                  "KFC creamy coleslaw in a cup on a black plate"),
    ("kfc_biscuit",                   "a KFC golden flaky buttermilk biscuit on a black plate"),
    ("kfc_chicken_pot_pie",           "KFC chicken pot pie with flaky crust on a black plate"),
    ("kfc_popcorn_nuggets",           "KFC popcorn nuggets crispy bite-sized chicken on a black plate"),

    # ── Shake Shack (7) ───────────────────────────────────────────────────────
    ("shake_shack_shackburger",       "Shake Shack ShackBurger cheeseburger with lettuce tomato on a black plate"),
    ("shake_shack_smokestack",        "Shake Shack SmokeShack burger with bacon and cheese on a black plate"),
    ("shake_shack_chick_n_shack",     "Shake Shack crispy chicken sandwich on a black plate"),
    ("shake_shack_cheese_fries",      "Shake Shack fries with cheese sauce on a black plate"),
    ("shake_shack_crinkle_fries",     "Shake Shack crinkle cut fries on a black plate"),
    ("shake_shack_frozen_custard",    "Shake Shack vanilla frozen custard in a cup on a black plate"),
    ("shake_shack_shack_stack",       "Shake Shack Shack Stack burger with mushroom and cheese on a black plate"),

    # ── Wingstop (6) ──────────────────────────────────────────────────────────
    ("wingstop_bone_in_wings",         "Wingstop bone-in chicken wings on a black plate"),
    ("wingstop_boneless_wings",        "Wingstop boneless chicken wings on a black plate"),
    ("wingstop_seasoned_fries",        "Wingstop seasoned fries on a black plate"),
    ("wingstop_lemon_pepper_wings",    "Wingstop lemon pepper dry-rub chicken wings on a black plate"),
    ("wingstop_mango_habanero_wings",  "Wingstop mango habanero glazed chicken wings on a black plate"),
    ("wingstop_garlic_parmesan_wings", "Wingstop garlic parmesan chicken wings on a black plate"),

    # ── Jack in the Box (7) ───────────────────────────────────────────────────
    ("jbox_jumbo_jack",            "Jack in the Box Jumbo Jack cheeseburger on a black plate"),
    ("jbox_sourdough_jack",        "Jack in the Box Sourdough Jack burger on sourdough on a black plate"),
    ("jbox_ultimate_cheeseburger", "Jack in the Box Ultimate Cheeseburger on a black plate"),
    ("jbox_spicy_crispy_chicken",  "Jack in the Box spicy crispy chicken sandwich on a black plate"),
    ("jbox_egg_rolls",             "Jack in the Box egg rolls with dipping sauce on a black plate"),
    ("jbox_tacos",                 "two Jack in the Box fried tacos on a black plate"),
    ("jbox_loaded_curly_fries",    "Jack in the Box loaded curly fries with bacon and cheese on a black plate"),

    # ── Panera Bread (9) ──────────────────────────────────────────────────────
    ("panera_broccoli_cheddar_bread_bowl", "Panera broccoli cheddar soup in a sourdough bread bowl on a black plate"),
    ("panera_broccoli_cheddar_cup",        "Panera broccoli cheddar soup in a cup on a black plate"),
    ("panera_chicken_noodle_soup",         "Panera chicken noodle soup in a bowl on a black plate"),
    ("panera_turkey_sourdough",            "Panera turkey sandwich on sourdough on a black plate"),
    ("panera_chicken_caesar_salad",        "Panera chicken caesar salad with croutons on a black plate"),
    ("panera_greek_salad",                 "Panera Greek salad with feta olives on a black plate"),
    ("panera_cinnamon_crunch_bagel",       "Panera cinnamon crunch bagel on a black plate"),
    ("panera_chocolate_chip_cookie",       "Panera large chocolate chip cookie on a black plate"),
    ("panera_bacon_egg_cheese",            "Panera bacon egg and cheese breakfast sandwich on a black plate"),

    # ── Raising Cane's (5) ────────────────────────────────────────────────────
    ("canes_box_combo",      "Raising Cane's box combo with three chicken fingers and fries on a black plate"),
    ("canes_3_finger_combo", "Raising Cane's 3-finger chicken tenders combo on a black plate"),
    ("canes_caniac_combo",   "Raising Cane's Caniac combo with six chicken fingers on a black plate"),
    ("canes_crinkle_fries",  "Raising Cane's crinkle cut fries on a black plate"),
    ("canes_texas_toast",    "Raising Cane's buttered Texas toast thick bread on a black plate"),

    # ── Dairy Queen (6) ───────────────────────────────────────────────────────
    ("dq_oreo_blizzard",            "Dairy Queen Oreo Blizzard soft serve with Oreo pieces on a black plate"),
    ("dq_dilly_bar",                "Dairy Queen Dilly Bar vanilla ice cream on a stick with chocolate coating"),
    ("dq_chicken_strip_basket",     "Dairy Queen chicken strip basket with fries on a black plate"),
    ("dq_double_cheeseburger",      "Dairy Queen double cheeseburger on a black plate"),
    ("dq_soft_serve_cone",          "Dairy Queen soft serve vanilla ice cream swirl cone"),
    ("dq_pb_cookie_dough_blizzard", "Dairy Queen peanut butter cookie dough Blizzard on a black plate"),

    # ── Jersey Mike's (5) ─────────────────────────────────────────────────────
    ("jersey_mikes_original_italian", "Jersey Mike's Original Italian sub sandwich on a black plate"),
    ("jersey_mikes_turkey_provolone", "Jersey Mike's turkey and provolone sub on a black plate"),
    ("jersey_mikes_club_sub",         "Jersey Mike's Club Sub with turkey and ham on a black plate"),
    ("jersey_mikes_philly",           "Jersey Mike's Philly cheesesteak sub on a black plate"),
    ("jersey_mikes_blt",              "Jersey Mike's BLT sub with bacon lettuce tomato on a black plate"),

    # ── Jimmy John's (5) ──────────────────────────────────────────────────────
    ("jj_turkey_tom",   "Jimmy John's Turkey Tom sandwich on French bread on a black plate"),
    ("jj_vito",         "Jimmy John's Vito Italian sub sandwich on a black plate"),
    ("jj_pepe",         "Jimmy John's Pepe ham and cheese sandwich on a black plate"),
    ("jj_slim_tuna",    "Jimmy John's slim tuna salad sandwich on a black plate"),
    ("jj_beach_club",   "Jimmy John's Beach Club turkey avocado sandwich on a black plate"),

    # ── Sonic (5) ─────────────────────────────────────────────────────────────
    ("sonic_cheeseburger",   "Sonic Drive-In cheeseburger on a black plate"),
    ("sonic_footlong_coney", "Sonic footlong chili cheese coney hot dog on a black plate"),
    ("sonic_tots",           "Sonic tater tots golden crispy on a black plate"),
    ("sonic_corn_dog",       "Sonic corn dog golden fried on a black plate"),
    ("sonic_cherry_limeade", "Sonic cherry limeade red drink in a cup on a black plate"),

    # ── Whataburger (6) ───────────────────────────────────────────────────────
    ("whataburger_original",        "Whataburger original hamburger on a black plate"),
    ("whataburger_double",          "Whataburger double meat hamburger on a black plate"),
    ("whataburger_spicy_chicken",   "Whataburger spicy chicken sandwich on a black plate"),
    ("whataburger_onion_rings",     "Whataburger crispy onion rings on a black plate"),
    ("whataburger_apple_pie",       "Whataburger fried apple pie pastry on a black plate"),
    ("whataburger_chocolate_shake", "Whataburger chocolate milkshake in a cup on a black plate"),

    # ── Zaxby's (5) ───────────────────────────────────────────────────────────
    ("zaxbys_signature_sandwich", "Zaxby's signature crispy chicken sandwich on a black plate"),
    ("zaxbys_fingerz_plate",      "Zaxby's chicken fingerz plate with fries on a black plate"),
    ("zaxbys_wings_and_things",   "Zaxby's wings and things platter on a black plate"),
    ("zaxbys_crinkle_fries",      "Zaxby's crinkle cut fries on a black plate"),
    ("zaxbys_zalads_house",       "Zaxby's house salad with grilled chicken on a black plate"),

    # ── Culver's (5) ──────────────────────────────────────────────────────────
    ("culvers_butterburger",        "Culver's ButterBurger single on a black plate"),
    ("culvers_double_butterburger", "Culver's double ButterBurger with cheese on a black plate"),
    ("culvers_cheese_curds",        "Culver's Wisconsin cheese curds golden fried on a black plate"),
    ("culvers_frozen_custard",      "Culver's vanilla frozen custard scoop in a dish on a black plate"),
    ("culvers_fish_sandwich",       "Culver's North Atlantic cod fish sandwich on a black plate"),

    # ── IHOP (8) ──────────────────────────────────────────────────────────────
    ("ihop_buttermilk_pancakes",    "IHOP original buttermilk pancakes stack of three on a black plate"),
    ("ihop_cheesecake_pancakes",    "IHOP New York cheesecake pancakes with strawberry topping on a black plate"),
    ("ihop_stuffed_french_toast",   "IHOP stuffed French toast with cream cheese filling on a black plate"),
    ("ihop_bacon_omelette",         "IHOP bacon omelette with cheese on a black plate"),
    ("ihop_belgian_waffle",         "IHOP Belgian waffle with butter and syrup on a black plate"),
    ("ihop_harvest_grain_pancakes", "IHOP harvest grain and nut pancakes on a black plate"),
    ("ihop_big_steak_omelette",     "IHOP big steak omelette with steak and vegetables on a black plate"),
    ("ihop_chicken_waffles",        "IHOP chicken and waffles on a black plate"),

    # ── Denny's (6) ───────────────────────────────────────────────────────────
    ("dennys_grand_slam",          "Denny's Grand Slam breakfast with pancakes eggs bacon and sausage on a black plate"),
    ("dennys_moons_over_hammy",    "Denny's Moons Over My Hammy scrambled egg ham cheese sandwich on a black plate"),
    ("dennys_pancakes",            "Denny's fluffy pancakes stack on a black plate"),
    ("dennys_country_fried_steak", "Denny's country fried steak with white gravy on a black plate"),
    ("dennys_scrambler",           "Denny's scrambler eggs with hash browns and sausage on a black plate"),
    ("dennys_avocado_toast",       "Denny's avocado toast with sliced avocado on toast on a black plate"),

    # ── Texas Roadhouse (6) ───────────────────────────────────────────────────
    ("txrh_sirloin_6oz",          "Texas Roadhouse 6oz sirloin steak on a black plate"),
    ("txrh_ribs_half_rack",       "Texas Roadhouse half rack baby back ribs on a black plate"),
    ("txrh_rolls",                "Texas Roadhouse fresh baked dinner rolls with cinnamon butter on a black plate"),
    ("txrh_green_beans",          "Texas Roadhouse seasoned green beans side dish on a black plate"),
    ("txrh_loaded_sweet_potato",  "Texas Roadhouse loaded sweet potato with butter and marshmallows on a black plate"),
    ("txrh_grilled_salmon",       "Texas Roadhouse grilled salmon fillet on a black plate"),

    # ── Red Lobster (5) ───────────────────────────────────────────────────────
    ("red_lobster_cheddar_bay_biscuit", "Red Lobster Cheddar Bay Biscuit golden cheesy biscuit on a black plate"),
    ("red_lobster_lobster_tail",        "Red Lobster steamed lobster tail with butter on a black plate"),
    ("red_lobster_shrimp_scampi",       "Red Lobster shrimp scampi with garlic butter on a black plate"),
    ("red_lobster_admiral_feast",       "Red Lobster Admiral's Feast seafood platter on a black plate"),
    ("red_lobster_clam_chowder",        "Red Lobster New England clam chowder in a bowl on a black plate"),

    # ── Outback Steakhouse (4) ────────────────────────────────────────────────
    ("outback_6oz_sirloin",     "Outback Steakhouse 6oz sirloin steak on a black plate"),
    ("outback_blooming_onion",  "Outback Blooming Onion fried crispy with dipping sauce on a black plate"),
    ("outback_grilled_salmon",  "Outback grilled salmon fillet on a black plate"),
    ("outback_victorias_filet", "Outback Victoria's Filet Mignon on a black plate"),

    # ── Korean (10) ───────────────────────────────────────────────────────────
    ("korean_bulgogi",       "Korean beef bulgogi marinated grilled beef on a black plate"),
    ("korean_galbi",         "Korean galbi short ribs grilled on a black plate"),
    ("korean_samgyeopsal",   "Korean samgyeopsal grilled pork belly on a black plate"),
    ("tteokbokki",           "Korean tteokbokki spicy rice cakes in red sauce on a black plate"),
    ("japchae",              "Korean japchae glass noodles with vegetables on a black plate"),
    ("korean_fried_chicken", "Korean fried chicken glazed crispy on a black plate"),
    ("kimchi_bowl",          "a bowl of Korean kimchi fermented cabbage on a black plate"),
    ("korean_bibim_noodles", "Korean cold spicy bibim noodles with vegetables on a black plate"),
    ("sundubu_jjigae",       "Korean sundubu jjigae soft tofu stew in a stone bowl"),
    ("doenjang_jjigae",      "Korean doenjang jjigae soybean paste stew in a bowl on a black plate"),

    # ── Filipino (8) ──────────────────────────────────────────────────────────
    ("chicken_adobo_filipino", "Filipino chicken adobo braised in vinegar and soy sauce on a black plate"),
    ("pork_sinigang",          "Filipino pork sinigang sour tamarind soup in a bowl on a black plate"),
    ("kare_kare",              "Filipino kare kare oxtail peanut stew on a black plate"),
    ("lechon_kawali",          "Filipino lechon kawali crispy fried pork belly on a black plate"),
    ("pancit_bihon",           "Filipino pancit bihon stir-fried rice noodles with vegetables on a black plate"),
    ("lumpia_shanghai",        "Filipino lumpia Shanghai crispy mini spring rolls on a black plate"),
    ("sinangag_garlic_rice",   "Filipino sinangag garlic fried rice on a black plate"),
    ("halo_halo",              "Filipino halo-halo colorful shaved ice dessert with toppings in a tall glass"),

    # ── Brazilian (7) ─────────────────────────────────────────────────────────
    ("acai_bowl_brazilian", "Brazilian acai bowl with granola berries and banana on a black plate"),
    ("pao_de_queijo",       "Brazilian pao de queijo cheese bread rolls on a black plate"),
    ("coxinha",             "Brazilian coxinha fried chicken croquette teardrop shaped on a black plate"),
    ("churrasco_picanha",   "Brazilian churrasco picanha beef rump cap on a black plate"),
    ("feijoada",            "Brazilian feijoada black bean stew with pork in a bowl on a black plate"),
    ("farofa",              "Brazilian farofa toasted cassava flour with bacon on a black plate"),
    ("brigadeiro",          "Brazilian brigadeiro chocolate truffle balls with sprinkles on a black plate"),

    # ── Mexican Home Cooking (8) ──────────────────────────────────────────────
    ("birria_tacos",       "Mexican birria tacos with consomme dipping broth on a black plate"),
    ("enchiladas_rojas",   "Mexican enchiladas rojas with red chile sauce and cheese on a black plate"),
    ("pozole_rojo",        "Mexican pozole rojo hominy pork soup in a bowl on a black plate"),
    ("chilaquiles_rojos",  "Mexican chilaquiles rojos with tortillas in red sauce on a black plate"),
    ("elote_street_corn",  "Mexican elote street corn on cob with mayo chili cheese on a black plate"),
    ("carne_asada_plate",  "Mexican carne asada grilled beef plate with rice and beans on a black plate"),
    ("tamale_pork_red",    "Mexican tamale with pork in red chile sauce on a black plate"),
    ("menudo_bowl",        "Mexican menudo tripe soup in a bowl with lime and oregano"),

    # ── Ethiopian (5) ─────────────────────────────────────────────────────────
    ("injera_ethiopian",        "Ethiopian injera spongy sourdough flatbread on a black plate"),
    ("doro_wat",                "Ethiopian doro wat spicy chicken stew with egg on a black plate"),
    ("ethiopian_tibs",          "Ethiopian tibs sauteed beef with vegetables on a black plate"),
    ("misir_red_lentils",       "Ethiopian misir red lentil stew on a black plate"),
    ("ethiopian_combo_platter", "Ethiopian combination platter with injera and various stews on a black plate"),

    # ── Peruvian (5) ──────────────────────────────────────────────────────────
    ("ceviche_peruano", "Peruvian ceviche fresh fish in lime juice with red onion on a black plate"),
    ("lomo_saltado",    "Peruvian lomo saltado stir-fried beef with peppers and fries on a black plate"),
    ("aji_de_gallina",  "Peruvian aji de gallina creamy yellow chile chicken on a black plate"),
    ("causa_limena",    "Peruvian causa limena yellow potato terrine on a black plate"),
    ("anticuchos",      "Peruvian anticuchos beef heart skewers grilled on a black plate"),

    # ── Colombian (6) ─────────────────────────────────────────────────────────
    ("bandeja_paisa",        "Colombian bandeja paisa platter with beans rice meat egg chorizo on a black plate"),
    ("arepa_colombiana",     "Colombian arepa grilled corn cake on a black plate"),
    ("sancocho_colombiano",  "Colombian sancocho chicken vegetable stew in a bowl on a black plate"),
    ("changua",              "Colombian changua milk soup with egg and bread on a black plate"),
    ("ajiaco_colombiano",    "Colombian ajiaco potato chicken soup in a bowl on a black plate"),
    ("sobrebarriga",         "Colombian sobrebarriga slow-cooked beef flank on a black plate"),

    # ── Venezuelan (5) ────────────────────────────────────────────────────────
    ("pabellon_criollo",    "Venezuelan pabellon criollo with shredded beef black beans rice plantains on a black plate"),
    ("cachapas",            "Venezuelan cachapas sweet corn pancakes with white cheese on a black plate"),
    ("hallacas_venezuelan", "Venezuelan hallacas corn dough stuffed with stew on a black plate"),
    ("caraotas_negras",     "Venezuelan caraotas negras black beans in a bowl on a black plate"),
    ("tequenos",            "Venezuelan tequenos fried cheese-filled bread sticks on a black plate"),

    # ── Turkish / Greek (6) ───────────────────────────────────────────────────
    ("doner_kebab",     "Turkish doner kebab sliced meat in flatbread on a black plate"),
    ("lahmacun",        "Turkish lahmacun thin flatbread with minced meat on a black plate"),
    ("menemen_turkish", "Turkish menemen scrambled eggs with tomatoes and peppers on a black plate"),
    ("spanakopita",     "Greek spanakopita spinach and feta phyllo pastry triangle on a black plate"),
    ("moussaka_greek",  "Greek moussaka layered eggplant beef bechamel casserole on a black plate"),
    ("baklava",         "Greek baklava sweet pastry with honey and nuts on a black plate"),

    # ── Thai extra (5) ────────────────────────────────────────────────────────
    ("massaman_curry",   "Thai massaman curry with beef potatoes and peanuts on a black plate"),
    ("som_tam",          "Thai som tam green papaya salad on a black plate"),
    ("khao_man_gai",     "Thai khao man gai poached chicken with rice on a black plate"),
    ("mango_sticky_rice","Thai mango sticky rice with coconut milk on a black plate"),
    ("tom_kha_gai",      "Thai tom kha gai coconut chicken soup in a bowl on a black plate"),

    # ── Vietnamese extra (5) ──────────────────────────────────────────────────
    ("bun_bo_hue",       "Vietnamese bun bo Hue spicy beef noodle soup in a bowl on a black plate"),
    ("banh_mi_sandwich", "Vietnamese banh mi sandwich with pork and pickled vegetables on a black plate"),
    ("com_tam",          "Vietnamese com tam broken rice with grilled pork on a black plate"),
    ("bun_cha",          "Vietnamese bun cha grilled pork with rice noodles on a black plate"),
    ("che_ba_mau",       "Vietnamese che ba mau three-color sweet dessert in a glass"),

    # ── Indian extra (6) ──────────────────────────────────────────────────────
    ("chicken_biryani", "Indian chicken biryani aromatic rice with spices on a black plate"),
    ("dal_makhani",     "Indian dal makhani creamy black lentils in a bowl on a black plate"),
    ("chana_masala",    "Indian chana masala spiced chickpeas on a black plate"),
    ("palak_paneer",    "Indian palak paneer creamy spinach with cheese cubes on a black plate"),
    ("garlic_naan",     "Indian garlic naan flatbread with butter and herbs on a black plate"),
    ("samosa_chaat",    "Indian samosa chaat with yogurt and chutneys on a black plate"),

    # ── Japanese extra (4) ────────────────────────────────────────────────────
    ("tonkatsu",       "Japanese tonkatsu panko-breaded fried pork cutlet on a black plate"),
    ("oyakodon",       "Japanese oyakodon chicken and egg rice bowl on a black plate"),
    ("takoyaki",       "Japanese takoyaki octopus balls with sauce and bonito flakes on a black plate"),
    ("mochi_ice_cream","Japanese mochi ice cream balls on a black plate"),

    # ── Supplements (10) ──────────────────────────────────────────────────────
    ("pre_workout_powder",    "a scoop of colorful pre-workout supplement powder on a black plate"),
    ("fish_oil_softgel",      "fish oil omega-3 supplement softgel capsules on a black plate"),
    ("collagen_peptides",     "a scoop of white collagen peptides powder on a black plate"),
    ("vitamin_d3_supplement", "vitamin D3 supplement capsules on a white background"),
    ("glutamine_powder",      "a scoop of white L-glutamine powder on a black plate"),
    ("zma_supplement",        "ZMA zinc magnesium supplement capsules on a black plate"),
    ("magnesium_glycinate",   "magnesium glycinate supplement capsules on a black plate"),
    ("electrolyte_powder",    "a scoop of colorful electrolyte powder on a black plate"),
    ("omega3_supplement",     "omega-3 fish oil supplement softgel capsules on a black plate"),
    ("ashwagandha",           "ashwagandha root powder and capsules on a black plate"),

    # ── Breakfast extras (10) ─────────────────────────────────────────────────
    ("eggs_benedict",          "eggs Benedict with poached eggs hollandaise sauce on English muffin on a black plate"),
    ("acai_bowl",              "acai bowl with granola blueberries banana and honey on a black plate"),
    ("smoothie_bowl_berry",    "mixed berry smoothie bowl with granola and fresh fruit on a black plate"),
    ("quiche_lorraine_slice",  "a slice of quiche Lorraine with bacon and cheese on a black plate"),
    ("crepes_plain",           "two thin French crepes folded on a black plate"),
    ("granola_bowl_milk",      "a bowl of granola with milk and berries on a black plate"),
    ("biscuits_and_gravy",     "two buttermilk biscuits covered in white sausage gravy on a black plate"),
    ("bagel_lox_cream_cheese", "a bagel with cream cheese and smoked salmon lox on a black plate"),
    ("shakshuka",              "shakshuka poached eggs in spiced tomato sauce in a skillet on a black plate"),
    ("breakfast_quesadilla",   "a breakfast quesadilla with eggs cheese and peppers on a black plate"),

    # ── More proteins (10) ────────────────────────────────────────────────────
    ("duck_breast_roasted",     "roasted duck breast with crispy skin on a black plate"),
    ("goat_meat_stewed",        "stewed goat meat in herbs and spices on a black plate"),
    ("rabbit_roasted",          "roasted rabbit with herbs on a black plate"),
    ("swordfish_steak_grilled", "grilled swordfish steak on a black plate"),
    ("rainbow_trout_baked",     "baked rainbow trout fish on a black plate"),
    ("atlantic_mackerel_baked", "baked Atlantic mackerel fish on a black plate"),
    ("pan_seared_scallops",     "pan-seared scallops golden brown on a black plate"),
    ("raw_oysters_6",           "six raw oysters on the half shell on a black plate"),
    ("steamed_clams",           "steamed clams in broth on a black plate"),
    ("mussels_steamed",         "steamed mussels in broth on a black plate"),

    # ── Drinks (14) ───────────────────────────────────────────────────────────
    ("sprite_can",             "a can of Sprite clear lemon-lime soda on a black plate"),
    ("sweet_tea",              "a glass of Southern sweet iced tea on a black plate"),
    ("unsweetened_iced_tea",   "a glass of unsweetened iced tea on a black plate"),
    ("prime_hydration",        "a bottle of Prime Hydration sports drink on a black plate"),
    ("coconut_water_vitacoco", "a Vita Coco coconut water carton on a black plate"),
    ("chocolate_milk",         "a glass of chocolate milk on a black plate"),
    ("heineken_bottle",        "a green Heineken beer bottle on a black plate"),
    ("corona_bottle",          "a Corona beer bottle with lime wedge on a black plate"),
    ("red_wine_glass",         "a glass of red wine on a black plate"),
    ("white_wine_glass",       "a glass of white wine on a black plate"),
    ("tequila_shot",           "a shot glass of tequila with lime and salt on a black plate"),
    ("vodka_shot",             "a shot glass of clear vodka on a black plate"),
    ("rum_and_coke",           "a glass of rum and Coca-Cola with ice on a black plate"),
    ("white_claw_hard_seltzer","a White Claw hard seltzer can on a black plate"),

    # ── Snacks (12) ───────────────────────────────────────────────────────────
    ("quest_protein_chips",     "Quest protein chips bag on a black plate"),
    ("popcorners_white_cheddar","PopCorners white cheddar popped chips on a black plate"),
    ("nature_valley_crunchy",   "Nature Valley crunchy granola bar on a black plate"),
    ("nutri_grain_bar",         "Nutri-Grain strawberry cereal bar on a black plate"),
    ("pirates_booty",           "Pirate's Booty aged white cheddar puffed snacks on a black plate"),
    ("gummy_bears",             "colorful gummy bears candy on a black plate"),
    ("sour_patch_kids",         "Sour Patch Kids colorful candies on a black plate"),
    ("swedish_fish",            "Swedish Fish red chewy candy on a black plate"),
    ("starburst_original",      "Starburst original fruit chews on a black plate"),
    ("haribo_goldbears",        "Haribo Gold-Bears gummy candy on a black plate"),
    ("hi_chew_strawberry",      "Hi-Chew strawberry chewy candy on a black plate"),
    ("takis_fuego",             "Takis Fuego rolled spicy tortilla chips on a black plate"),

    # ── Vegetables (12) ───────────────────────────────────────────────────────
    ("bok_choy_cooked",          "cooked bok choy on a black plate"),
    ("arugula_raw",              "fresh arugula leaves on a black plate"),
    ("butternut_squash_roasted", "roasted butternut squash cubes on a black plate"),
    ("acorn_squash_roasted",     "roasted acorn squash halves on a black plate"),
    ("nopales_grilled",          "grilled nopales cactus paddles on a black plate"),
    ("jicama_raw",               "sliced raw jicama root vegetable on a black plate"),
    ("swiss_chard_cooked",       "sauteed Swiss chard with garlic on a black plate"),
    ("watercress_raw",           "fresh watercress leaves on a black plate"),
    ("turnip_cooked",            "cooked diced turnip on a black plate"),
    ("parsnip_roasted",          "roasted parsnip pieces on a black plate"),
    ("leek_cooked",              "sauteed sliced leeks on a black plate"),
    ("fennel_raw",               "sliced fresh fennel bulb on a black plate"),

    # ── Fruits (12) ───────────────────────────────────────────────────────────
    ("dragon_fruit",         "sliced pink dragon fruit on a black plate"),
    ("papaya_fresh",         "fresh papaya sliced showing orange flesh on a black plate"),
    ("guava_fresh",          "fresh guava cut in half showing pink flesh on a black plate"),
    ("passion_fruit_halved", "passion fruit halved showing yellow pulp on a black plate"),
    ("lychee_fresh",         "fresh peeled lychee fruits on a black plate"),
    ("star_fruit",           "sliced carambola star fruit showing star shape on a black plate"),
    ("jackfruit_fresh",      "fresh jackfruit pulled apart showing yellow pods on a black plate"),
    ("persimmon_fresh",      "fresh persimmon fruit on a black plate"),
    ("kumquat",              "fresh kumquat small orange fruits on a black plate"),
    ("blood_orange",         "blood orange cut in half showing red flesh on a black plate"),
    ("tamarind",             "tamarind pods with brown pulp on a black plate"),
    ("longan_fresh",         "fresh peeled longan fruits on a black plate"),

    # ── Dairy (10) ────────────────────────────────────────────────────────────
    ("sour_cream",       "a dollop of sour cream in a small bowl on a black plate"),
    ("heavy_cream",      "heavy whipping cream in a small pitcher on a black plate"),
    ("half_and_half",    "a small pitcher of half and half cream on a black plate"),
    ("kefir_plain",      "a glass of plain kefir cultured milk drink on a black plate"),
    ("brie_cheese",      "a wedge of brie cheese with soft white rind on a black plate"),
    ("blue_cheese",      "crumbled blue cheese on a black plate"),
    ("gouda_cheese",     "a slice of gouda cheese on a black plate"),
    ("feta_crumbled",    "crumbled feta cheese on a black plate"),
    ("ricotta_cheese",   "creamy ricotta cheese in a small bowl on a black plate"),
    ("mascarpone_cheese","a spoonful of mascarpone cheese on a black plate"),

    # ── Cereals / Grains (10) ─────────────────────────────────────────────────
    ("granola_plain",        "a bowl of plain granola clusters on a black plate"),
    ("grape_nuts_cereal",    "a bowl of Grape Nuts cereal on a black plate"),
    ("kashi_go_cereal",      "a bowl of Kashi GO cereal on a black plate"),
    ("cap_n_crunch",         "a bowl of Cap'n Crunch cereal on a black plate"),
    ("cocoa_puffs",          "a bowl of Cocoa Puffs chocolate cereal on a black plate"),
    ("polenta_cooked",       "cooked creamy polenta in a bowl on a black plate"),
    ("grits_cooked",         "creamy cooked grits in a bowl on a black plate"),
    ("millet_cooked",        "cooked millet grain in a bowl on a black plate"),
    ("udon_noodles_cooked",  "cooked thick udon wheat noodles in a bowl on a black plate"),
    ("soba_noodles_cooked",  "cooked soba buckwheat noodles in a bowl on a black plate"),

    # ── Protein Bars / Shakes (8) ─────────────────────────────────────────────
    ("barebells_chocolate_dough",  "Barebells chocolate dough protein bar on a black plate"),
    ("grenade_carb_killa",         "Grenade Carb Killa protein bar on a black plate"),
    ("built_bar_chocolate",        "Built Bar chocolate protein bar on a black plate"),
    ("ghost_protein_bar",          "Ghost protein bar on a black plate"),
    ("core_power_chocolate",       "Core Power elite chocolate protein shake bottle on a black plate"),
    ("bsn_syntha6",                "BSN Syntha-6 protein powder container on a white background"),
    ("orgain_plant_protein_shake", "Orgain organic plant protein shake bottle on a black plate"),
    ("vega_sport_protein",         "Vega Sport protein powder container on a white background"),

    # ── Condiments / Sauces (8) ───────────────────────────────────────────────
    ("worcestershire_sauce", "a bottle of Worcestershire sauce on a black plate"),
    ("fish_sauce_bottle",    "a bottle of Thai fish sauce on a black plate"),
    ("oyster_sauce",         "a bottle of oyster sauce on a black plate"),
    ("hoisin_sauce",         "a small bowl of hoisin sauce on a black plate"),
    ("miso_paste",           "a small bowl of brown miso paste on a black plate"),
    ("gochujang_paste",      "a small bowl of Korean gochujang red chili paste on a black plate"),
    ("chimichurri_sauce",    "a small bowl of green chimichurri sauce on a black plate"),
    ("red_curry_paste",      "a small bowl of Thai red curry paste on a black plate"),

    # ── Misc Grains / Breads (6) ──────────────────────────────────────────────
    ("rice_noodles_cooked",  "cooked rice noodles in a bowl on a black plate"),
    ("egg_noodles_cooked",   "cooked egg noodles in a bowl on a black plate"),
    ("cream_of_rice",        "creamy cooked cream of rice porridge in a bowl on a black plate"),
    ("sourdough_bread_slice","a slice of sourdough bread on a black plate"),
    ("cornbread_slice",      "a slice of golden cornbread on a black plate"),
    ("focaccia_slice",       "a slice of focaccia bread with herbs and olive oil on a black plate"),

    # ── More Common Foods (to reach ~1000 total) ──────────────────────────────
    ("little_caesars_pepperoni_slice", "Little Caesars pepperoni pizza slice on a black plate"),
    ("little_caesars_cheese_slice",    "Little Caesars plain cheese pizza slice on a black plate"),
    ("little_caesars_crazy_bread",     "Little Caesars Crazy Bread with garlic butter on a black plate"),
    ("little_caesars_deep_dish",       "Little Caesars deep dish pepperoni pizza on a black plate"),
    ("checkers_big_buford",            "Checkers Big Buford double cheeseburger on a black plate"),
    ("checkers_seasoned_fries",        "Checkers Rally's seasoned fries on a black plate"),
    ("cook_out_double_cheeseburger",   "Cook Out double cheeseburger on a black plate"),
    ("bojangles_chicken_supremes",     "Bojangles' seasoned crispy chicken supremes on a black plate"),
    ("red_robin_gourmet_cheeseburger", "Red Robin gourmet cheeseburger on a black plate"),
    ("red_robin_steak_fries",          "Red Robin steak fries on a black plate"),
    ("cracker_barrel_chicken_fried_chicken","Cracker Barrel chicken fried chicken with gravy on a black plate"),
    ("cracker_barrel_biscuit",         "Cracker Barrel flaky buttermilk biscuit on a black plate"),
    ("cracker_barrel_meatloaf",        "Cracker Barrel homestyle meatloaf with gravy on a black plate"),
    ("olive_garden_zuppa_toscana",     "Olive Garden Zuppa Toscana soup with sausage kale potatoes in a bowl"),
    ("olive_garden_tiramisu",          "Olive Garden tiramisu dessert on a black plate"),
    ("waffle_house_waffle",            "Waffle House classic waffle on a black plate"),
    ("grilled_cheese_sandwich",        "a golden grilled cheese sandwich on a black plate"),
    ("blt_sandwich",                   "a BLT sandwich with bacon lettuce tomato on a black plate"),
    ("club_sandwich",                  "a club sandwich triple decker with turkey on a black plate"),
    ("philly_cheesesteak_sandwich",    "a Philly cheesesteak sandwich with peppers and onions on a black plate"),
    ("french_dip_sandwich",            "a French dip roast beef sandwich with au jus on a black plate"),
    ("grilled_veggie_wrap",            "a grilled vegetable wrap on a black plate"),
    ("lentil_soup_bowl",               "a bowl of hearty lentil soup on a black plate"),
    ("minestrone_soup_bowl",           "a bowl of minestrone soup with vegetables on a black plate"),
    ("clam_chowder_bowl",              "New England clam chowder in a bread bowl on a black plate"),
    ("french_onion_soup_bowl",         "French onion soup with melted cheese on top in a bowl"),
    ("tomato_bisque_bowl",             "creamy tomato bisque soup in a bowl on a black plate"),
    ("lays_classic_chips",             "a bag of Lay's Classic potato chips on a black plate"),
    ("pringles_original",              "Pringles original chips in a can on a black plate"),
    ("ritz_crackers",                  "Ritz crackers on a black plate"),
    ("wheat_thins",                    "Wheat Thins crackers on a black plate"),
    ("babybel_cheese",                 "Babybel mini cheese wheel with red wax on a black plate"),
    ("kombucha_ginger_lemon",          "a bottle of ginger lemon kombucha on a black plate"),
    ("beet_juice",                     "a glass of fresh red beet juice on a black plate"),
    ("celery_juice",                   "a glass of fresh green celery juice on a black plate"),
    ("golden_milk_turmeric_latte",     "a cup of golden milk turmeric latte on a black plate"),
    ("tiramisu_slice",                 "a slice of tiramisu Italian dessert with cocoa on a black plate"),
    ("gelato_scoop",                   "a scoop of Italian gelato in a cup on a black plate"),
    ("churros",                        "churros with cinnamon sugar and chocolate sauce on a black plate"),
    ("beignets",                       "New Orleans beignets with powdered sugar on a black plate"),
    ("funnel_cake",                    "a funnel cake with powdered sugar on a black plate"),
    ("soft_pretzel_large",             "a large soft pretzel with coarse salt on a black plate"),
    ("strawberry_cheesecake_slice",    "a slice of strawberry cheesecake on a black plate"),
]

STYLE_SUFFIX = ", professional food photography, top-down angle, clean white background, studio lighting, 8k, sharp focus"


def build_workflow(prompt_text):
    seed = int(time.time() * 1000) % (2**32)
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "flux1-schnell-fp8-e4m3fn.safetensors",
                "weight_dtype": "fp8_e4m3fn",
            },
        },
        "2": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": "clip_l.safetensors",
                "clip_name2": "t5xxl_fp8_e4m3fn.safetensors",
                "type": "flux",
            },
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "ae.safetensors"},
        },
        "4": {
            "class_type": "CLIPTextEncodeFlux",
            "inputs": {
                "clip_l": prompt_text,
                "t5xxl": prompt_text,
                "guidance": 3.5,
                "clip": ["2", 0],
            },
        },
        "5": {
            "class_type": "CLIPTextEncodeFlux",
            "inputs": {
                "clip_l": "",
                "t5xxl": "",
                "guidance": 3.5,
                "clip": ["2", 0],
            },
        },
        "6": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 512, "height": 512, "batch_size": 1},
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["7", 0], "vae": ["3", 0]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "food_gen", "images": ["8", 0]},
        },
    }


def queue_prompt(workflow):
    payload = json.dumps({"prompt": workflow}).encode("utf-8")
    req = urllib.request.Request(
        f"{COMFY_URL}/prompt", data=payload,
        headers={"Content-Type": "application/json"}
    )
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())["prompt_id"]


def wait_for_completion(prompt_id, timeout=180):
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = urllib.request.urlopen(f"{COMFY_URL}/history/{prompt_id}")
            history = json.loads(resp.read())
            if prompt_id in history:
                return history[prompt_id]
        except Exception:
            pass
        time.sleep(1)
    raise TimeoutError(f"Prompt {prompt_id} timed out after {timeout}s")


def get_image(history):
    outputs = history.get("outputs", {})
    for node_id, node_out in outputs.items():
        if "images" in node_out:
            for img_info in node_out["images"]:
                filename = img_info["filename"]
                subfolder = img_info.get("subfolder", "")
                params = urllib.parse.urlencode(
                    {"filename": filename, "subfolder": subfolder, "type": "output"}
                )
                resp = urllib.request.urlopen(f"{COMFY_URL}/view?{params}")
                return resp.read()
    return None


def main():
    try:
        urllib.request.urlopen(f"{COMFY_URL}/system_stats")
    except urllib.error.URLError:
        print(f"ERROR: ComfyUI not reachable at {COMFY_URL}")
        print("Start ComfyUI first, then re-run this script.")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    already_done = sum(
        1 for fname, _ in FOODS
        if os.path.exists(os.path.join(OUTPUT_DIR, f"{fname}.png"))
    )
    remaining = len(FOODS) - already_done
    print(f"Total: {len(FOODS)} | Already done: {already_done} | Remaining: {remaining}")

    done = 0
    for i, (filename, desc) in enumerate(FOODS, 1):
        out_path = os.path.join(OUTPUT_DIR, f"{filename}.png")
        if os.path.exists(out_path):
            continue

        done += 1
        prompt = desc + STYLE_SUFFIX
        print(f"[{done}/{remaining}] {filename}.png")

        workflow = build_workflow(prompt)
        prompt_id = queue_prompt(workflow)
        history = wait_for_completion(prompt_id)
        img_data = get_image(history)

        if img_data:
            with open(out_path, "wb") as f:
                f.write(img_data)
            print(f"         Saved! ({len(img_data)//1024} KB)")
        else:
            print("         FAILED - no image in output")

    print(f"\nDone! All images in: {os.path.abspath(OUTPUT_DIR)}")


if __name__ == "__main__":
    main()
