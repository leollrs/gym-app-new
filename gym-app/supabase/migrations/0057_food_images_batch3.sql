-- Food images batch 3 — 49 more specific images

-- ═══════════════════════════════════════════════════════════
-- FRUITS (more specific than generic banana.jpg / berries.jpg)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/mango.jpg' WHERE name ILIKE '%Mango%' AND name NOT ILIKE '%Mangú%';
UPDATE food_items SET image_url = '/foods/grapes.jpg' WHERE name ILIKE '%Grape%' OR name ILIKE '%Uvas%';
UPDATE food_items SET image_url = '/foods/watermelon.jpg' WHERE name ILIKE '%Watermelon%' OR name ILIKE '%Sandía%';
UPDATE food_items SET image_url = '/foods/pineapple.jpg' WHERE name ILIKE '%Pineapple%' OR name ILIKE '%Piña%' AND name NOT ILIKE '%Colada%';
UPDATE food_items SET image_url = '/foods/strawberry.jpg' WHERE name ILIKE '%Strawberr%' OR name ILIKE '%Fresa%';
UPDATE food_items SET image_url = '/foods/coconut.jpg' WHERE name ILIKE '%Coconut%' OR name ILIKE '%Coco %' OR name ILIKE '%Besitos de Coco%' OR name ILIKE '%Coquito%';
UPDATE food_items SET image_url = '/foods/papaya.jpg' WHERE name ILIKE '%Papaya%' OR name ILIKE '%Lechoza%' AND name NOT ILIKE '%Dulce%';

-- ═══════════════════════════════════════════════════════════
-- VEGETABLES (more specific than generic broccoli/salad/tomato)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/mushroom.jpg' WHERE name ILIKE '%Mushroom%' OR name ILIKE '%Champiñón%';
UPDATE food_items SET image_url = '/foods/pepper.jpg' WHERE name ILIKE '%Pepper%' OR name ILIKE '%Pimiento%' AND name NOT ILIKE '%Dr Pepper%';
UPDATE food_items SET image_url = '/foods/carrot.jpg' WHERE name ILIKE '%Carrot%' OR name ILIKE '%Zanahoria%';
UPDATE food_items SET image_url = '/foods/spinach.jpg' WHERE name ILIKE '%Spinach%' OR name ILIKE '%Espinaca%';
UPDATE food_items SET image_url = '/foods/asparagus.jpg' WHERE name ILIKE '%Asparagus%' OR name ILIKE '%Espárrago%';
UPDATE food_items SET image_url = '/foods/cauliflower.jpg' WHERE name ILIKE '%Cauliflower%' OR name ILIKE '%Coliflor%';
UPDATE food_items SET image_url = '/foods/brussels_sprouts.jpg' WHERE name ILIKE '%Brussels%' OR name ILIKE '%Coles de Bruselas%';
UPDATE food_items SET image_url = '/foods/green_beans.jpg' WHERE name ILIKE '%Green Bean%' OR name ILIKE '%Habichuela Verde%' OR name ILIKE '%Snap Peas%';
UPDATE food_items SET image_url = '/foods/zucchini.jpg' WHERE name ILIKE '%Zucchini%' OR name ILIKE '%Calabacín%';
UPDATE food_items SET image_url = '/foods/cucumber.jpg' WHERE name ILIKE '%Cucumber%' OR name ILIKE '%Pepino%';
UPDATE food_items SET image_url = '/foods/onion.jpg' WHERE name ILIKE '%Onion%' OR name ILIKE '%Cebolla%';
UPDATE food_items SET image_url = '/foods/celery.jpg' WHERE name ILIKE '%Celery%' OR name ILIKE '%Apio%';
UPDATE food_items SET image_url = '/foods/cabbage.jpg' WHERE name ILIKE '%Cabbage%' OR name ILIKE '%Repollo%';

-- ═══════════════════════════════════════════════════════════
-- PROTEINS (more specific than generic chicken/ground_beef)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/turkey.jpg' WHERE name ILIKE '%Turkey%' OR name ILIKE '%Pavo%' AND name NOT ILIKE '%Ground Turkey%';
UPDATE food_items SET image_url = '/foods/tilapia.jpg' WHERE name ILIKE '%Tilapia%';
UPDATE food_items SET image_url = '/foods/cod_fish.jpg' WHERE name ILIKE '%Cod %' OR name ILIKE '%Bacalao%' AND name NOT ILIKE '%Bacalaíto%';
UPDATE food_items SET image_url = '/foods/tofu.jpg' WHERE name ILIKE '%Tofu%' OR name ILIKE '%Tempeh%' OR name ILIKE '%Seitan%';
UPDATE food_items SET image_url = '/foods/bison_steak.jpg' WHERE name ILIKE '%Bison%' OR name ILIKE '%Venison%';

-- ═══════════════════════════════════════════════════════════
-- LEGUMES (more specific than generic beans.jpg / nuts.jpg)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/chickpeas.jpg' WHERE name ILIKE '%Chickpea%' OR name ILIKE '%Garbanzo%';
UPDATE food_items SET image_url = '/foods/lentils.jpg' WHERE name ILIKE '%Lentil%' OR name ILIKE '%Lenteja%';
UPDATE food_items SET image_url = '/foods/hummus.jpg' WHERE name ILIKE '%Hummus%';
UPDATE food_items SET image_url = '/foods/edamame.jpg' WHERE name ILIKE '%Edamame%';

-- ═══════════════════════════════════════════════════════════
-- DAIRY (more specific than generic milk.jpg / cheese.jpg)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/cottage_cheese.jpg' WHERE name ILIKE '%Cottage%' OR name ILIKE '%Requesón%';
UPDATE food_items SET image_url = '/foods/butter.jpg' WHERE name ILIKE '%Butter%' OR name ILIKE '%Mantequilla%' AND name NOT ILIKE '%Peanut Butter%' AND name NOT ILIKE '%Almond Butter%' AND name NOT ILIKE '%Butter Chicken%';

-- ═══════════════════════════════════════════════════════════
-- BAKED GOODS (more specific than generic bread.jpg / donut.jpg)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/muffin.jpg' WHERE name ILIKE '%Muffin%' AND name NOT ILIKE '%McMuffin%';
UPDATE food_items SET image_url = '/foods/cinnamon_roll.jpg' WHERE name ILIKE '%Cinnamon Roll%';
UPDATE food_items SET image_url = '/foods/biscuit.jpg' WHERE name ILIKE '%Biscuit%';

-- ═══════════════════════════════════════════════════════════
-- GRAINS (more specific than generic bread.jpg / oatmeal.jpg)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/granola.jpg' WHERE name ILIKE '%Granola%' OR name ILIKE '%Overnight Oats%';
UPDATE food_items SET image_url = '/foods/naan.jpg' WHERE name ILIKE '%Naan%';
UPDATE food_items SET image_url = '/foods/pita.jpg' WHERE name ILIKE '%Pita%';
UPDATE food_items SET image_url = '/foods/tortilla.jpg' WHERE name ILIKE '%Tortilla%' AND name NOT ILIKE '%Tortilla de Huevo%';

-- ═══════════════════════════════════════════════════════════
-- SNACKS (more specific than generic fries.jpg)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/chips.jpg' WHERE name ILIKE '%Chips%' OR name ILIKE '%Doritos%' OR name ILIKE '%Cheez-It%' OR name ILIKE '%Goldfish%' OR name ILIKE '%Veggie Straw%';
UPDATE food_items SET image_url = '/foods/popcorn.jpg' WHERE name ILIKE '%Popcorn%' OR name ILIKE '%SkinnyPop%';
UPDATE food_items SET image_url = '/foods/pretzel.jpg' WHERE name ILIKE '%Pretzel%';
UPDATE food_items SET image_url = '/foods/jerky.jpg' WHERE name ILIKE '%Jerky%' OR name ILIKE '%Cecina%';
UPDATE food_items SET image_url = '/foods/crackers.jpg' WHERE name ILIKE '%Cracker%' OR name ILIKE '%Rice Cake%' OR name ILIKE '%Galleta%' AND name NOT ILIKE '%Graham%';
UPDATE food_items SET image_url = '/foods/rice_cake.jpg' WHERE name ILIKE '%Rice Cake%';

-- ═══════════════════════════════════════════════════════════
-- CONDIMENTS (more specific than generic olive_oil.jpg)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/honey.jpg' WHERE name ILIKE '%Honey%' OR name ILIKE '%Miel%' OR name ILIKE '%Syrup%' OR name ILIKE '%Sirope%';
UPDATE food_items SET image_url = '/foods/salsa.jpg' WHERE name ILIKE '%Salsa%' OR name ILIKE '%Hot Sauce%' OR name ILIKE '%Sriracha%' OR name ILIKE '%Pico%';
UPDATE food_items SET image_url = '/foods/ketchup_mustard.jpg' WHERE name ILIKE '%Ketchup%' OR name ILIKE '%Mustard%' OR name ILIKE '%BBQ%';

-- ═══════════════════════════════════════════════════════════
-- ASIAN DISHES (more specific than generic arroz_con_pollo.jpg)
-- ═══════════════════════════════════════════════════════════
UPDATE food_items SET image_url = '/foods/teriyaki_chicken.jpg' WHERE name ILIKE '%Teriyaki%' OR name ILIKE '%General Tso%' OR name ILIKE '%Kung Pao%';
UPDATE food_items SET image_url = '/foods/orange_chicken.jpg' WHERE name ILIKE '%Orange Chicken%' OR name ILIKE '%Beijing%';
