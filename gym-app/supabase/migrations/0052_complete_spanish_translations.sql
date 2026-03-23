-- ═══════════════════════════════════════════════════════════
-- COMPLETE SPANISH TRANSLATIONS — All items missing from 0051
-- Fast food chains, packaged goods, branded items, candy,
-- condiments, and PR/Caribbean foods not caught by wildcards
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- McDONALD'S (28 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Big Mac' WHERE name = 'Big Mac' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Quarter Pounder con Queso' WHERE name = 'Quarter Pounder with Cheese' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'McChicken' WHERE name = 'McChicken' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Chicken McNuggets (4 piezas)' WHERE name = 'Chicken McNuggets (4 pc)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Chicken McNuggets (6 piezas)' WHERE name = 'Chicken McNuggets (6 pc)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Chicken McNuggets (10 piezas)' WHERE name = 'Chicken McNuggets (10 pc)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Chicken McNuggets (20 piezas)' WHERE name = 'Chicken McNuggets (20 pc)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Filet-O-Fish' WHERE name = 'Filet-O-Fish' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'McDouble' WHERE name = 'McDouble' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Egg McMuffin' WHERE name = 'Egg McMuffin' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Sausage McMuffin' WHERE name = 'Sausage McMuffin' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Sausage McMuffin con Huevo' WHERE name = 'Sausage McMuffin with Egg' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Hash Brown' WHERE name = 'Hash Brown' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Papas Fritas Grandes' WHERE name = 'Large Fries' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Papas Fritas Medianas' WHERE name = 'Medium Fries' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Papas Fritas Pequeñas' WHERE name = 'Small Fries' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Ensalada de Pollo a la Parrilla Southwest' WHERE name = 'Southwest Grilled Chicken Salad' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Rebanadas de Manzana' WHERE name = 'Apple Slices' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'McFlurry con Oreo (regular)' WHERE name = 'McFlurry with Oreo (regular)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'McFlurry con M&M (regular)' WHERE name = 'McFlurry with M&M (regular)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Hotcakes (3 panqueques)' WHERE name = 'Hotcakes' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Desayuno Grande con Hotcakes' WHERE name = 'Big Breakfast with Hotcakes' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Sándwich de Tocineta, Huevo y Queso en Biscuit' WHERE name = 'Bacon Egg & Cheese Biscuit' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Café Helado (mediano, sin azúcar)' WHERE name = 'Iced Coffee (medium, no sugar)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Batida de Chocolate (mediana)' WHERE name = 'Chocolate Shake (medium)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Batida de Vainilla (mediana)' WHERE name = 'Vanilla Shake (medium)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Double Quarter Pounder con Queso' WHERE name = 'Double Quarter Pounder with Cheese' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Sándwich de Pollo Crujiente' WHERE name = 'Crispy Chicken Sandwich' AND brand = 'McDonald''s';

-- ─────────────────────────────────────────────────────────
-- CHICK-FIL-A (22 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Sándwich Original de Pollo' WHERE name = 'Original Chicken Sandwich' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Sándwich de Pollo Picante' WHERE name = 'Spicy Chicken Sandwich' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Sándwich de Pollo a la Parrilla' WHERE name = 'Grilled Chicken Sandwich' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Nuggets de Pollo (8 piezas)' WHERE name = 'Chicken Nuggets (8 ct)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Nuggets de Pollo (12 piezas)' WHERE name = 'Chicken Nuggets (12 ct)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Nuggets a la Parrilla (8 piezas)' WHERE name = 'Grilled Nuggets (8 ct)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Papas Waffle (medianas)' WHERE name = 'Waffle Fries (medium)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Papas Waffle (grandes)' WHERE name = 'Waffle Fries (large)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Mac & Cheese (mediano)' WHERE name = 'Mac & Cheese (medium)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Biscuit de Pollo' WHERE name = 'Chicken Biscuit' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Ensalada Picante Southwest' WHERE name = 'Spicy Southwest Salad' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Wrap de Pollo a la Parrilla' WHERE name = 'Grilled Cool Wrap' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Tiras de Pollo (3 piezas)' WHERE name = 'Chick-n-Strips (3 ct)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Limonada Frappé (mediana)' WHERE name = 'Frosted Lemonade (medium)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Batida de Cookies & Cream (mediana)' WHERE name = 'Cookies & Cream Milkshake (medium)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Burrito de Desayuno con Hash Brown' WHERE name = 'Hash Brown Scramble Burrito' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Sopa de Tortilla de Pollo (mediana)' WHERE name = 'Chicken Tortilla Soup (medium)' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Ensalada Pequeña' WHERE name = 'Side Salad' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Ensalada Cobb' WHERE name = 'Cobb Salad' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Copa de Frutas' WHERE name = 'Fruit Cup' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Galleta de Chispas de Chocolate' WHERE name = 'Chocolate Chip Cookie' AND brand = 'Chick-fil-A';
UPDATE food_items SET name_es = 'Salsa Chick-fil-A' WHERE name = 'Chick-fil-A Sauce' AND brand = 'Chick-fil-A';

-- ─────────────────────────────────────────────────────────
-- CHIPOTLE (16 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Burrito de Pollo' WHERE name = 'Chicken Burrito' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Burrito de Bistec' WHERE name = 'Steak Burrito' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Bowl de Pollo' WHERE name = 'Chicken Bowl' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Bowl de Bistec' WHERE name = 'Steak Bowl' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Bowl de Carnitas' WHERE name = 'Carnitas Bowl' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Bowl de Sofritas' WHERE name = 'Sofritas Bowl' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Chips con Guacamole' WHERE name = 'Chips & Guacamole' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Chips con Queso Blanco' WHERE name = 'Chips & Queso Blanco' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Arroz Blanco con Cilantro y Limón' WHERE name = 'Cilantro-Lime White Rice' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Habichuelas Negras' WHERE name = 'Black Beans' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Habichuelas Pintas' WHERE name = 'Pinto Beans' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Quesadilla de Pollo' WHERE name = 'Chicken Quesadilla' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Tacos de Bistec (3)' WHERE name = 'Steak Tacos (3)' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Tacos de Pollo (3)' WHERE name = 'Chicken Tacos (3)' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Bowl de Barbacoa' WHERE name = 'Barbacoa Bowl' AND brand = 'Chipotle';
UPDATE food_items SET name_es = 'Bowl Vegetariano' WHERE name = 'Veggie Bowl' AND brand = 'Chipotle';

-- ─────────────────────────────────────────────────────────
-- SUBWAY (16 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Sub de Pavo de 6"' WHERE name = '6" Turkey Breast Sub' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Italian BMT de 6"' WHERE name = '6" Italian BMT' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Pollo Teriyaki de 6"' WHERE name = '6" Chicken Teriyaki' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Albóndigas Marinara de 6"' WHERE name = '6" Meatball Marinara' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Atún de 6"' WHERE name = '6" Tuna' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Veggie Delite de 6"' WHERE name = '6" Veggie Delite' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Bistec y Queso de 6"' WHERE name = '6" Steak & Cheese' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Italiano Picante de 6"' WHERE name = '6" Spicy Italian' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Pavo de Un Pie' WHERE name = 'Footlong Turkey Breast' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Italian BMT de Un Pie' WHERE name = 'Footlong Italian BMT' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Pollo Teriyaki de Un Pie' WHERE name = 'Footlong Chicken Teriyaki' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Galleta de Chispas de Chocolate' WHERE name = 'Chocolate Chip Cookie' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Pollo Rostizado de 6"' WHERE name = '6" Rotisserie Chicken' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Cold Cut Combo de 6"' WHERE name = '6" Cold Cut Combo' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Jamón Black Forest de 6"' WHERE name = '6" Black Forest Ham' AND brand = 'Subway';
UPDATE food_items SET name_es = 'Albóndigas Marinara de Un Pie' WHERE name = 'Footlong Meatball Marinara' AND brand = 'Subway';

-- ─────────────────────────────────────────────────────────
-- TACO BELL (17 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Taco Crujiente' WHERE name = 'Crunchy Taco' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Taco Suave' WHERE name = 'Soft Taco' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Taco Crujiente Supreme' WHERE name = 'Crunchy Taco Supreme' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Burrito Supreme (Res)' WHERE name = 'Burrito Supreme (Beef)' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Crunchwrap Supreme' WHERE name = 'Crunchwrap Supreme' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Quesadilla de Pollo' WHERE name = 'Chicken Quesadilla' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Quesadilla de Bistec' WHERE name = 'Steak Quesadilla' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Pizza Mexicana' WHERE name = 'Mexican Pizza' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Nachos BellGrande' WHERE name = 'Nachos BellGrande' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Cheesy Gordita Crunch' WHERE name = 'Cheesy Gordita Crunch' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Burrito de Habichuelas' WHERE name = 'Bean Burrito' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Chalupa Supreme (Res)' WHERE name = 'Chalupa Supreme (Beef)' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Burrito de 5 Capas' WHERE name = 'Beefy 5-Layer Burrito' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Doritos Locos Taco' WHERE name = 'Doritos Locos Taco' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Quesadilla de Queso' WHERE name = 'Cheese Quesadilla' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Burrito de Pollo' WHERE name = 'Chicken Burrito' AND brand = 'Taco Bell';
UPDATE food_items SET name_es = 'Nachos con Queso' WHERE name = 'Nachos & Cheese' AND brand = 'Taco Bell';

-- ─────────────────────────────────────────────────────────
-- WENDY'S (16 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Dave''s Single' WHERE name = 'Dave''s Single' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Dave''s Double' WHERE name = 'Dave''s Double' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Dave''s Triple' WHERE name = 'Dave''s Triple' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Baconator' WHERE name = 'Baconator' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Sándwich de Pollo Picante' WHERE name = 'Spicy Chicken Sandwich' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Jr. Cheeseburger' WHERE name = 'Jr. Cheeseburger' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Jr. Bacon Cheeseburger' WHERE name = 'Jr. Bacon Cheeseburger' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Nuggets (4 piezas)' WHERE name = 'Nuggets (4 ct)' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Nuggets (10 piezas)' WHERE name = 'Nuggets (10 ct)' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Papas Fritas Grandes' WHERE name = 'Large Fries' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Chili (pequeño)' WHERE name = 'Chili (small)' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Chili (grande)' WHERE name = 'Chili (large)' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Papa al Horno (sola)' WHERE name = 'Baked Potato (plain)' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Frosty — Chocolate (pequeño)' WHERE name = 'Frosty — Chocolate (small)' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Frosty — Vainilla (pequeño)' WHERE name = 'Frosty — Vanilla (small)' AND brand = 'Wendy''s';
UPDATE food_items SET name_es = 'Sándwich Clásico de Pollo' WHERE name = 'Classic Chicken Sandwich' AND brand = 'Wendy''s';

-- ─────────────────────────────────────────────────────────
-- BURGER KING (12 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Whopper' WHERE name = 'Whopper' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Whopper Jr' WHERE name = 'Whopper Jr' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Whopper con Queso' WHERE name = 'Whopper with Cheese' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Sándwich Original de Pollo' WHERE name = 'Original Chicken Sandwich' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Papas de Pollo (9 piezas)' WHERE name = 'Chicken Fries (9 pc)' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Aros de Cebolla (medianos)' WHERE name = 'Onion Rings (medium)' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Hamburguesa con Tocineta y Queso' WHERE name = 'Bacon Cheeseburger' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Doble Whopper' WHERE name = 'Double Whopper' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Impossible Whopper' WHERE name = 'Impossible Whopper' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Papas Fritas (medianas)' WHERE name = 'French Fries (medium)' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Chicken Jr' WHERE name = 'Chicken Jr' AND brand = 'Burger King';
UPDATE food_items SET name_es = 'Hash Browns (medianos)' WHERE name = 'Hash Browns (medium)' AND brand = 'Burger King';

-- ─────────────────────────────────────────────────────────
-- FIVE GUYS (8 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Hamburguesa con Queso' WHERE name = 'Cheeseburger' AND brand = 'Five Guys';
UPDATE food_items SET name_es = 'Hamburguesa Pequeña con Queso' WHERE name = 'Little Cheeseburger' AND brand = 'Five Guys';
UPDATE food_items SET name_es = 'Hamburguesa con Tocineta y Queso' WHERE name = 'Bacon Cheeseburger' AND brand = 'Five Guys';
UPDATE food_items SET name_es = 'Hamburguesa Pequeña con Tocineta y Queso' WHERE name = 'Little Bacon Cheeseburger' AND brand = 'Five Guys';
UPDATE food_items SET name_es = 'Papas Cajún (regular)' WHERE name = 'Cajun Fries (regular)' AND brand = 'Five Guys';
UPDATE food_items SET name_es = 'Papas Fritas Regulares' WHERE name = 'Regular Fries' AND brand = 'Five Guys';
UPDATE food_items SET name_es = 'Hot Dog' WHERE name = 'Hot Dog' AND brand = 'Five Guys';
UPDATE food_items SET name_es = 'Sándwich Vegetariano' WHERE name = 'Veggie Sandwich' AND brand = 'Five Guys';

-- ─────────────────────────────────────────────────────────
-- PANDA EXPRESS (12 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Pollo a la Naranja' WHERE name = 'Orange Chicken' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Res Estilo Beijing' WHERE name = 'Beijing Beef' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Pollo Kung Pao' WHERE name = 'Kung Pao Chicken' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Res con Brócoli' WHERE name = 'Broccoli Beef' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Arroz Frito' WHERE name = 'Fried Rice' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Chow Mein' WHERE name = 'Chow Mein' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Súper Vegetales' WHERE name = 'Super Greens' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Pollo con Habichuelas Tiernas' WHERE name = 'String Bean Chicken' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Pollo Teriyaki a la Parrilla' WHERE name = 'Grilled Teriyaki Chicken' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Camarones con Nuez y Miel' WHERE name = 'Honey Walnut Shrimp' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Pollo con Champiñones' WHERE name = 'Mushroom Chicken' AND brand = 'Panda Express';
UPDATE food_items SET name_es = 'Arroz Blanco al Vapor' WHERE name = 'Steamed White Rice' AND brand = 'Panda Express';

-- ─────────────────────────────────────────────────────────
-- POPEYES (10 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Sándwich Clásico de Pollo' WHERE name = 'Classic Chicken Sandwich' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Sándwich de Pollo Picante' WHERE name = 'Spicy Chicken Sandwich' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Pechuga de Pollo (suave)' WHERE name = 'Chicken Breast (mild)' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Muslo de Pollo (suave)' WHERE name = 'Chicken Thigh (mild)' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Papas Cajún (regular)' WHERE name = 'Cajun Fries (regular)' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Arroz con Habichuelas Rojas (regular)' WHERE name = 'Red Beans & Rice (regular)' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Biscuit' WHERE name = 'Biscuit' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Tenders de Pollo (3 piezas, suave)' WHERE name = '3pc Chicken Tenders (mild)' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Puré de Papa con Gravy' WHERE name = 'Mashed Potatoes & Gravy' AND brand = 'Popeyes';
UPDATE food_items SET name_es = 'Ensalada de Col (regular)' WHERE name = 'Coleslaw (regular)' AND brand = 'Popeyes';

-- ─────────────────────────────────────────────────────────
-- STARBUCKS (17 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Frappuccino de Caramelo Grande' WHERE name = 'Grande Caramel Frappuccino' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Caffè Latte Grande' WHERE name = 'Grande Caffè Latte' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Caffè Mocha Grande' WHERE name = 'Grande Caffè Mocha' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Café Pike Place (grande)' WHERE name = 'Pike Place Brewed Coffee (grande)' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Macchiato de Caramelo Helado Grande' WHERE name = 'Grande Iced Caramel Macchiato' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Cake Pop (cumpleaños)' WHERE name = 'Cake Pop (birthday cake)' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Sándwich de Tocineta y Gouda' WHERE name = 'Bacon Gouda Breakfast Sandwich' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Wrap de Espinaca, Feta y Clara de Huevo' WHERE name = 'Spinach Feta & Egg White Wrap' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Sándwich Impossible de Desayuno' WHERE name = 'Impossible Breakfast Sandwich' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Croissant de Mantequilla' WHERE name = 'Butter Croissant' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Muffin de Arándanos' WHERE name = 'Blueberry Muffin' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Pan de Guineo con Nueces' WHERE name = 'Banana Nut Bread' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Caja de Proteína (Huevos y Queso)' WHERE name = 'Protein Box (Eggs & Cheese)' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Cold Brew con Crema de Vainilla Grande' WHERE name = 'Grande Vanilla Sweet Cream Cold Brew' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Matcha Latte Grande' WHERE name = 'Grande Matcha Latte' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Chai Tea Latte Grande' WHERE name = 'Grande Chai Tea Latte' AND brand = 'Starbucks';
UPDATE food_items SET name_es = 'Brownie de Doble Chocolate' WHERE name = 'Double Chocolate Brownie' AND brand = 'Starbucks';

-- ─────────────────────────────────────────────────────────
-- DUNKIN' (12 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Café Helado Mediano (crema y azúcar)' WHERE name = 'Medium Iced Coffee (cream & sugar)' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Café Helado Mediano (negro)' WHERE name = 'Medium Iced Coffee (black)' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Donut Glaseado' WHERE name = 'Glazed Donut' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Donut Boston Kreme' WHERE name = 'Boston Kreme Donut' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Donut de Chocolate' WHERE name = 'Chocolate Frosted Donut' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Croissant de Tocineta, Huevo y Queso' WHERE name = 'Bacon Egg & Cheese Croissant' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Bagel de Tocineta, Huevo y Queso' WHERE name = 'Bacon Egg & Cheese on Bagel' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Bagel con Queso Crema' WHERE name = 'Plain Bagel with Cream Cheese' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Hash Browns (6 piezas)' WHERE name = 'Hash Browns (6 pc)' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Munchkins (5 piezas)' WHERE name = 'Munchkins Donut Holes (5 pc)' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Wrap de Salchicha, Huevo y Queso' WHERE name = 'Sausage Egg & Cheese Wake-Up Wrap' AND brand = 'Dunkin''';
UPDATE food_items SET name_es = 'Latte Caliente Mediano' WHERE name = 'Medium Hot Latte' AND brand = 'Dunkin''';

-- ─────────────────────────────────────────────────────────
-- PIZZA — Pizza Hut, Domino's, Papa John's (14 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Pizza de Queso (1 rebanada, mediana)' WHERE name = 'Hand-Tossed Cheese Pizza (1 slice, medium)' AND brand = 'Pizza Hut';
UPDATE food_items SET name_es = 'Pizza de Pepperoni (1 rebanada, mediana)' WHERE name = 'Hand-Tossed Pepperoni Pizza (1 slice, medium)' AND brand = 'Pizza Hut';
UPDATE food_items SET name_es = 'Pizza Supreme (1 rebanada, mediana)' WHERE name = 'Hand-Tossed Supreme Pizza (1 slice, medium)' AND brand = 'Pizza Hut';
UPDATE food_items SET name_es = 'Palitos de Pan (1)' WHERE name = 'Breadsticks (1 stick)' AND brand = 'Pizza Hut';
UPDATE food_items SET name_es = 'Pan de Ajo (2 piezas)' WHERE name = 'Garlic Bread (2 pieces)' AND brand = 'Pizza Hut';
UPDATE food_items SET name_es = 'Alitas sin Hueso (8 piezas)' WHERE name = 'Bone-Out Wings (8 pc)' AND brand = 'Pizza Hut';
UPDATE food_items SET name_es = 'Pizza de Queso (1 rebanada, mediana)' WHERE name = 'Hand-Tossed Cheese (1 slice, medium)' AND brand = 'Domino''s';
UPDATE food_items SET name_es = 'Pizza de Pepperoni (1 rebanada, mediana)' WHERE name = 'Hand-Tossed Pepperoni (1 slice, medium)' AND brand = 'Domino''s';
UPDATE food_items SET name_es = 'Torciditos de Canela (2 piezas)' WHERE name = 'Cinnamon Bread Twists (2 pc)' AND brand = 'Domino''s';
UPDATE food_items SET name_es = 'Alitas sin Hueso (8 piezas)' WHERE name = 'Boneless Wings (8 pc)' AND brand = 'Domino''s';
UPDATE food_items SET name_es = 'Pizza de Queso (1 rebanada, grande)' WHERE name = 'Original Crust Cheese (1 slice, large)' AND brand = 'Papa John''s';
UPDATE food_items SET name_es = 'Pizza de Pepperoni (1 rebanada, grande)' WHERE name = 'Original Crust Pepperoni (1 slice, large)' AND brand = 'Papa John''s';
UPDATE food_items SET name_es = 'Nudos de Ajo (4 piezas)' WHERE name = 'Garlic Knots (4 pc)' AND brand = 'Papa John''s';
UPDATE food_items SET name_es = 'Palitos de Pan (2 piezas)' WHERE name = 'Breadsticks (2 pc)' AND brand = 'Papa John''s';

-- ─────────────────────────────────────────────────────────
-- CASUAL DINING — Olive Garden, Applebee's, Chili's, TGI Friday's (18 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Pollo Alfredo' WHERE name = 'Chicken Alfredo' AND brand = 'Olive Garden';
UPDATE food_items SET name_es = 'Tour de Italia' WHERE name = 'Tour of Italy' AND brand = 'Olive Garden';
UPDATE food_items SET name_es = 'Palito de Pan (1)' WHERE name = 'Breadstick (1)' AND brand = 'Olive Garden';
UPDATE food_items SET name_es = 'Ensalada de la Casa (sin aderezo)' WHERE name = 'House Salad (no dressing)' AND brand = 'Olive Garden';
UPDATE food_items SET name_es = 'Pollo a la Parmesana' WHERE name = 'Chicken Parmigiana' AND brand = 'Olive Garden';
UPDATE food_items SET name_es = 'Fettuccine Alfredo' WHERE name = 'Fettuccine Alfredo' AND brand = 'Olive Garden';
UPDATE food_items SET name_es = 'Hamburguesa Clásica' WHERE name = 'Classic Burger' AND brand = 'Applebee''s';
UPDATE food_items SET name_es = 'Alitas sin Hueso (clásicas)' WHERE name = 'Boneless Wings (classic)' AND brand = 'Applebee''s';
UPDATE food_items SET name_es = 'Canasta de Tenders de Pollo' WHERE name = 'Chicken Tenders Basket' AND brand = 'Applebee''s';
UPDATE food_items SET name_es = 'Papas Fritas Cargadas' WHERE name = 'Loaded Fries' AND brand = 'Applebee''s';
UPDATE food_items SET name_es = 'Hamburguesa Oldtimer con Queso' WHERE name = 'Oldtimer with Cheese Burger' AND brand = 'Chili''s';
UPDATE food_items SET name_es = 'Crispers de Pollo Originales' WHERE name = 'Original Chicken Crispers' AND brand = 'Chili''s';
UPDATE food_items SET name_es = 'Costillitas Baby Back (rack completo)' WHERE name = 'Baby Back Ribs (full rack)' AND brand = 'Chili''s';
UPDATE food_items SET name_es = 'Quesadillas de Pollo, Tocineta y Ranch' WHERE name = 'Chicken Bacon Ranch Quesadillas' AND brand = 'Chili''s';
UPDATE food_items SET name_es = 'Alitas Búfalo Clásicas' WHERE name = 'Classic Buffalo Wings' AND brand = 'Chili''s';
UPDATE food_items SET name_es = 'Pasta Cajún con Camarones y Pollo' WHERE name = 'Cajun Shrimp & Chicken Pasta' AND brand = 'TGI Friday''s';
UPDATE food_items SET name_es = 'Hamburguesa Friday''s' WHERE name = 'Fridays Burger' AND brand = 'TGI Friday''s';
UPDATE food_items SET name_es = 'Tiras de Pollo Sesame Jack' WHERE name = 'Sesame Jack Chicken Strips' AND brand = 'TGI Friday''s';

-- ─────────────────────────────────────────────────────────
-- PROTEIN BARS (8 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Barra de Masa de Galleta con Chispas de Chocolate' WHERE name = 'Chocolate Chip Cookie Dough Bar' AND brand = 'Quest';
UPDATE food_items SET name_es = 'Barra de Birthday Cake' WHERE name = 'Birthday Cake Bar' AND brand = 'Quest';
UPDATE food_items SET name_es = 'Barra de Chocolate y Sal de Mar' WHERE name = 'Chocolate Sea Salt Bar' AND brand = 'RXBar';
UPDATE food_items SET name_es = 'Barra de Maní con Chocolate' WHERE name = 'Peanut Butter Chocolate Bar' AND brand = 'RXBar';
UPDATE food_items SET name_es = 'Barra de Birthday Cake' WHERE name = 'Birthday Cake Bar' AND brand = 'ONE Bar';
UPDATE food_items SET name_es = 'Barra de Maní Crujiente' WHERE name = 'Crunchy Peanut Butter Bar' AND brand = 'Clif Bar';
UPDATE food_items SET name_es = 'Chocolate Oscuro, Nueces y Sal de Mar' WHERE name = 'Dark Chocolate Nuts & Sea Salt' AND brand = 'Kind';
UPDATE food_items SET name_es = 'Barra de Maní con Chispas de Chocolate' WHERE name = 'Peanut Butter Chocolate Chip Bar' AND brand = 'Larabar';

-- ─────────────────────────────────────────────────────────
-- CEREALS (8 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Cheerios' WHERE name = 'Cheerios' AND brand = 'General Mills';
UPDATE food_items SET name_es = 'Frosted Flakes' WHERE name = 'Frosted Flakes' AND brand = 'Kellogg''s';
UPDATE food_items SET name_es = 'Special K Original' WHERE name = 'Special K Original' AND brand = 'Kellogg''s';
UPDATE food_items SET name_es = 'Raisin Bran' WHERE name = 'Raisin Bran' AND brand = 'Kellogg''s';
UPDATE food_items SET name_es = 'Lucky Charms' WHERE name = 'Lucky Charms' AND brand = 'General Mills';
UPDATE food_items SET name_es = 'Cinnamon Toast Crunch' WHERE name = 'Cinnamon Toast Crunch' AND brand = 'General Mills';
UPDATE food_items SET name_es = 'Honey Nut Cheerios' WHERE name = 'Honey Nut Cheerios' AND brand = 'General Mills';
UPDATE food_items SET name_es = 'Froot Loops' WHERE name = 'Froot Loops' AND brand = 'Kellogg''s';

-- ─────────────────────────────────────────────────────────
-- SNACKS (14 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Doritos Nacho Cheese' WHERE name = 'Nacho Cheese Doritos' AND brand = 'Frito-Lay';
UPDATE food_items SET name_es = 'Doritos Cool Ranch' WHERE name = 'Cool Ranch Doritos' AND brand = 'Frito-Lay';
UPDATE food_items SET name_es = 'Cheez-Its Originales' WHERE name = 'Original Cheez-Its' AND brand = 'Sunshine';
UPDATE food_items SET name_es = 'Goldfish de Cheddar' WHERE name = 'Cheddar Goldfish' AND brand = 'Pepperidge Farm';
UPDATE food_items SET name_es = 'Pretzels Duros' WHERE name = 'Hard Pretzels' AND brand IS NULL;
UPDATE food_items SET name_es = 'Galletas de Arroz con Poca Sal' WHERE name = 'Lightly Salted Rice Cakes' AND brand = 'Quaker';
UPDATE food_items SET name_es = 'Palomitas de Cine (mediana)' WHERE name = 'Movie Theater Popcorn (medium)' AND brand IS NULL;
UPDATE food_items SET name_es = 'Palomitas SkinnyPop (original)' WHERE name = 'Skinny Pop (original)' AND brand = 'SkinnyPop';
UPDATE food_items SET name_es = 'Mezcla de Frutos Secos' WHERE name = 'Trail Mix' AND brand IS NULL;
UPDATE food_items SET name_es = 'Cecina Original' WHERE name = 'Original Beef Jerky' AND brand = 'Jack Link''s';
UPDATE food_items SET name_es = 'Cecina Teriyaki' WHERE name = 'Teriyaki Beef Jerky' AND brand = 'Jack Link''s';
UPDATE food_items SET name_es = 'Chips de Cheddar y Crema Agria' WHERE name = 'Cheddar & Sour Cream Chips' AND brand = 'Lay''s';
UPDATE food_items SET name_es = 'Galletas de Maní (6 piezas)' WHERE name = 'Peanut Butter Crackers (6 ct)' AND brand = 'Lance';
UPDATE food_items SET name_es = 'Veggie Straws (original)' WHERE name = 'Veggie Straws (original)' AND brand = 'Sensible Portions';

-- ─────────────────────────────────────────────────────────
-- FROZEN MEALS (12 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Pollo Alfredo' WHERE name = 'Chicken Alfredo' AND brand = 'Lean Cuisine';
UPDATE food_items SET name_es = 'Pollo Rostizado con Hierbas' WHERE name = 'Herb Roasted Chicken' AND brand = 'Lean Cuisine';
UPDATE food_items SET name_es = 'Pollo Alfredo Café Steamers' WHERE name = 'Café Steamers Chicken Alfredo' AND brand = 'Healthy Choice';
UPDATE food_items SET name_es = 'Power Bowl Fajita de Pollo' WHERE name = 'Power Bowl Chicken Fajita' AND brand = 'Healthy Choice';
UPDATE food_items SET name_es = 'Hot Pocket de Pizza de Queso' WHERE name = 'Cheese Pizza Pocket' AND brand = 'Hot Pockets';
UPDATE food_items SET name_es = 'Hot Pocket de Pizza de Pepperoni' WHERE name = 'Pepperoni Pizza Pocket' AND brand = 'Hot Pockets';
UPDATE food_items SET name_es = 'Pizza de Queso DiGiorno (1 rebanada)' WHERE name = 'DiGiorno Cheese Pizza (1 slice)' AND brand = 'DiGiorno';
UPDATE food_items SET name_es = 'Pizza de Pepperoni DiGiorno (1 rebanada)' WHERE name = 'DiGiorno Pepperoni Pizza (1 slice)' AND brand = 'DiGiorno';
UPDATE food_items SET name_es = 'Pizza Rolls (6 piezas)' WHERE name = 'Pizza Rolls (6 ct)' AND brand = 'Totino''s';
UPDATE food_items SET name_es = 'Pizza de Pepperoni (1/2 pizza)' WHERE name = 'Party Pizza (pepperoni, 1/2 pizza)' AND brand = 'Totino''s';
UPDATE food_items SET name_es = 'Burrito de Habichuelas y Queso' WHERE name = 'Burrito (bean & cheese)' AND brand = 'Amy''s';
UPDATE food_items SET name_es = 'Comida de Enchiladas de Queso' WHERE name = 'Cheese Enchilada Meal' AND brand = 'Amy''s';

-- ─────────────────────────────────────────────────────────
-- BREADS & BAKERY (8 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = '21 Granos y Semillas' WHERE name = '21 Whole Grains and Seeds' AND brand = 'Dave''s Killer Bread';
UPDATE food_items SET name_es = 'Good Seed' WHERE name = 'Good Seed' AND brand = 'Dave''s Killer Bread';
UPDATE food_items SET name_es = 'Pan Germinado Ezekiel 4:9' WHERE name = 'Ezekiel 4:9 Sprouted Bread' AND brand = 'Food for Life';
UPDATE food_items SET name_es = 'Muffin Inglés (integral)' WHERE name = 'English Muffin (whole wheat)' AND brand IS NULL;
UPDATE food_items SET name_es = 'Pan Pita (blanco, 6.5")' WHERE name = 'Pita Bread (white, 6.5")' AND brand IS NULL;
UPDATE food_items SET name_es = 'Pan Naan' WHERE name = 'Naan Bread' AND brand IS NULL;
UPDATE food_items SET name_es = 'Croissant (grande)' WHERE name = 'Croissant (large)' AND brand IS NULL;
UPDATE food_items SET name_es = 'Pan de Hamburguesa' WHERE name = 'Hamburger Bun' AND brand IS NULL;

-- ─────────────────────────────────────────────────────────
-- DAIRY — BRANDED (8 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Leche 2% Fairlife' WHERE name = 'Fairlife 2% Milk' AND brand = 'Fairlife';
UPDATE food_items SET name_es = 'Leche Sin Grasa Fairlife' WHERE name = 'Fairlife Fat Free Milk' AND brand = 'Fairlife';
UPDATE food_items SET name_es = 'Yogur Griego de Vainilla' WHERE name = 'Vanilla Greek Yogurt' AND brand = 'Chobani';
UPDATE food_items SET name_es = 'Yogur de Fresa' WHERE name = 'Strawberry Yogurt' AND brand = 'Yoplait';
UPDATE food_items SET name_es = 'Queso en Tira Light' WHERE name = 'Light String Cheese' AND brand IS NULL;
UPDATE food_items SET name_es = 'Requesón (4%, cuajada grande)' WHERE name = 'Cottage Cheese (4%, large curd)' AND brand IS NULL;
UPDATE food_items SET name_es = 'Queso Parmesano (rallado)' WHERE name = 'Parmesan Cheese (grated)' AND brand IS NULL;
UPDATE food_items SET name_es = 'Queso Suizo (rebanada)' WHERE name = 'Swiss Cheese (slice)' AND brand IS NULL;

-- ─────────────────────────────────────────────────────────
-- DRINKS — Sports, Energy, Protein Shakes (14 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Gatorade Zero' WHERE name = 'Gatorade Zero' AND brand = 'Gatorade';
UPDATE food_items SET name_es = 'Body Armor Lyte' WHERE name = 'Lyte' AND brand = 'Body Armor';
UPDATE food_items SET name_es = 'Monster Energy Original (lata verde)' WHERE name = 'Original (green can)' AND brand = 'Monster Energy';
UPDATE food_items SET name_es = 'Monster Zero Ultra' WHERE name = 'Zero Ultra' AND brand = 'Monster Energy';
UPDATE food_items SET name_es = 'Red Bull Original (8.4 oz)' WHERE name = 'Original (8.4 oz)' AND brand = 'Red Bull';
UPDATE food_items SET name_es = 'Red Bull Sin Azúcar (8.4 oz)' WHERE name = 'Sugar Free (8.4 oz)' AND brand = 'Red Bull';
UPDATE food_items SET name_es = 'Celsius Naranja Burbujeante' WHERE name = 'Sparkling Orange' AND brand = 'Celsius';
UPDATE food_items SET name_es = 'Batida de Proteína de Chocolate' WHERE name = 'Chocolate Protein Shake' AND brand = 'Fairlife';
UPDATE food_items SET name_es = 'Batida de Proteína de Vainilla' WHERE name = 'Vanilla Protein Shake' AND brand = 'Fairlife';
UPDATE food_items SET name_es = 'Batida de Proteína de Chocolate' WHERE name = 'Chocolate Protein Shake' AND brand = 'Premier Protein';
UPDATE food_items SET name_es = 'Batida de Proteína de Vainilla' WHERE name = 'Vanilla Protein Shake' AND brand = 'Premier Protein';
UPDATE food_items SET name_es = 'Batida Genuine (chocolate)' WHERE name = 'Genuine Shake (chocolate)' AND brand = 'Muscle Milk';
UPDATE food_items SET name_es = 'Body Armor (fresa banana)' WHERE name = 'Body Armor (strawberry banana)' AND brand = 'Body Armor';
UPDATE food_items SET name_es = 'Powerade Zero' WHERE name = 'Powerade Zero' AND brand = 'Powerade';

-- ─────────────────────────────────────────────────────────
-- CONDIMENTS & EXTRAS from 0049 (8 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Sriracha' WHERE name = 'Sriracha' AND brand IS NULL;
UPDATE food_items SET name_es = 'Vinagreta Balsámica' WHERE name = 'Balsamic Vinaigrette' AND brand IS NULL;
UPDATE food_items SET name_es = 'Aderezo Italiano' WHERE name = 'Italian Dressing' AND brand IS NULL;
UPDATE food_items SET name_es = 'Aderezo César' WHERE name = 'Caesar Dressing' AND brand IS NULL;
UPDATE food_items SET name_es = 'Salsa Teriyaki' WHERE name = 'Teriyaki Sauce' AND brand IS NULL;
UPDATE food_items SET name_es = 'Sirope de Maple' WHERE name = 'Maple Syrup' AND brand IS NULL;
UPDATE food_items SET name_es = 'Mermelada / Jalea' WHERE name = 'Jam / Jelly' AND brand IS NULL;
UPDATE food_items SET name_es = 'Nutella' WHERE name = 'Nutella' AND brand = 'Ferrero';

-- ─────────────────────────────────────────────────────────
-- CANDY & SNACK BARS (11 items from desserts in 0049)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Barra Snickers' WHERE name = 'Snickers Bar' AND brand = 'Mars';
UPDATE food_items SET name_es = 'Kit Kat (4 dedos)' WHERE name = 'Kit Kat (4-finger)' AND brand = 'Nestlé';
UPDATE food_items SET name_es = 'Reese''s (2 piezas)' WHERE name = 'Reese''s Peanut Butter Cups (2 ct)' AND brand = 'Hershey''s';
UPDATE food_items SET name_es = 'M&M''s (maní, 1.74 oz)' WHERE name = 'M&M''s (peanut, 1.74 oz)' AND brand = 'Mars';
UPDATE food_items SET name_es = 'Skittles (original, 2.17 oz)' WHERE name = 'Skittles (original, 2.17 oz)' AND brand = 'Mars';
UPDATE food_items SET name_es = 'Galletas Oreo (3 piezas)' WHERE name = 'Oreo Cookies (3 ct)' AND brand = 'Nabisco';
UPDATE food_items SET name_es = 'Galletas Chips Ahoy (3 piezas)' WHERE name = 'Chips Ahoy Cookies (3 ct)' AND brand = 'Nabisco';
UPDATE food_items SET name_es = 'Rice Krispies Treat' WHERE name = 'Rice Krispies Treat' AND brand = 'Kellogg''s';
UPDATE food_items SET name_es = 'Pop-Tart (fresa glaseada, 1 pastelillo)' WHERE name = 'Pop-Tart (frosted strawberry, 1 pastry)' AND brand = 'Kellogg''s';
UPDATE food_items SET name_es = 'Ben & Jerry''s (Chocolate Fudge Brownie)' WHERE name = 'Pint of Ben & Jerry''s (Chocolate Fudge Brownie)' AND brand = 'Ben & Jerry''s';
UPDATE food_items SET name_es = 'Halo Top (Vainilla)' WHERE name = 'Halo Top (Vanilla Bean)' AND brand = 'Halo Top';

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL FAST FOOD (10 items)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Double-Double (frita en mostaza)' WHERE name = 'Double-Double (mustard fried)' AND brand = 'In-N-Out';
UPDATE food_items SET name_es = 'Hamburguesa con Queso (estilo proteína)' WHERE name = 'Cheeseburger (protein style)' AND brand = 'In-N-Out';
UPDATE food_items SET name_es = 'Papas Estilo Animal' WHERE name = 'Animal Style Fries' AND brand = 'In-N-Out';
UPDATE food_items SET name_es = 'Taco Crujiente' WHERE name = 'Crunchy Taco' AND brand = 'Del Taco';
UPDATE food_items SET name_es = 'Slider Original' WHERE name = 'Original Slider' AND brand = 'White Castle';
UPDATE food_items SET name_es = 'Combo de 6 McNuggets (mediano)' WHERE name = '6pc Chicken McNuggets Meal (medium)' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Hamburguesa Bacon Clubhouse' WHERE name = 'Bacon Clubhouse Burger' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Pollo a la Parrilla Deluxe' WHERE name = 'Grilled Chicken Deluxe' AND brand = 'McDonald''s';
UPDATE food_items SET name_es = 'Bowl de Burrito de Pollo' WHERE name = 'Chicken Burrito Bowl' AND brand = 'Qdoba';
UPDATE food_items SET name_es = 'Roast Beef Clásico (original)' WHERE name = 'Original Roast Beef (classic)' AND brand = 'Arby''s';

-- ─────────────────────────────────────────────────────────
-- BEYOND MEAT & IMPOSSIBLE (branded plant proteins)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Hamburguesa Beyond Meat' WHERE name = 'Beyond Meat Burger Patty' AND brand = 'Beyond Meat';
UPDATE food_items SET name_es = 'Hamburguesa Impossible' WHERE name = 'Impossible Burger Patty' AND brand = 'Impossible Foods';

-- ─────────────────────────────────────────────────────────
-- TAHINI (supplements/condiments area)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Tahini (pasta de sésamo)' WHERE name = 'Tahini (sesame paste)' AND brand IS NULL;

-- ─────────────────────────────────────────────────────────
-- NAAN (international, restaurant version)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Pan Naan (restaurante)' WHERE name = 'Naan Bread (restaurant)' AND brand IS NULL;

-- ─────────────────────────────────────────────────────────
-- AREPAS (international)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Arepas (queso)' WHERE name = 'Arepas (cheese)' AND brand IS NULL;

-- ─────────────────────────────────────────────────────────
-- CREATINE & BCAA (supplements not in 0051)
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Creatina Monohidrato' WHERE name = 'Creatine Monohydrate';
UPDATE food_items SET name_es = 'BCAA en Polvo' WHERE name = 'BCAA Powder';

-- ─────────────────────────────────────────────────────────
-- DRINKS from 0048 not in 0051
-- ─────────────────────────────────────────────────────────
UPDATE food_items SET name_es = 'Coca-Cola' WHERE name = 'Coca-Cola' AND brand IS NULL;
UPDATE food_items SET name_es = 'Diet Coke' WHERE name = 'Diet Coke' AND brand IS NULL;
UPDATE food_items SET name_es = 'Gatorade' WHERE name = 'Gatorade' AND brand IS NULL;

-- ─────────────────────────────────────────────────────────
-- PR/CARIBBEAN FOODS — Items not caught by 0051 wildcards
-- These are already in Spanish; set name_es = name
-- ─────────────────────────────────────────────────────────

-- Arroz
UPDATE food_items SET name_es = 'Pegao (Arroz Crujiente)' WHERE name = 'Pegao (Crispy Rice)';

-- Habichuelas
UPDATE food_items SET name_es = 'Gandules Guisados' WHERE name = 'Gandules Guisados';

-- Mariscos
UPDATE food_items SET name_es = 'Camarones al Ajillo' WHERE name = 'Camarones al Ajillo';
UPDATE food_items SET name_es = 'Pescado Frito (pescado entero frito)' WHERE name = 'Pescado Frito (whole fried fish)';
UPDATE food_items SET name_es = 'Ensalada de Pulpo' WHERE name = 'Ensalada de Pulpo';
UPDATE food_items SET name_es = 'Serenata de Bacalao (ensalada de bacalao)' WHERE name = 'Serenata de Bacalao (cod salad)';

-- Mofongo & Tostones
UPDATE food_items SET name_es = 'Trifongo' WHERE name = 'Trifongo';
UPDATE food_items SET name_es = 'Aranitas de Plátano (frituras de plátano)' WHERE name = 'Aranitas de Plátano (plantain fritters)';
UPDATE food_items SET name_es = 'Pionono (aro de plátano maduro)' WHERE name = 'Pionono (sweet plantain ring)';
UPDATE food_items SET name_es = 'Tostón Relleno' WHERE name = 'Tostón Relleno';

-- Sopas
UPDATE food_items SET name_es = 'Sopa de Plátano' WHERE name = 'Sopa de Plátano';
UPDATE food_items SET name_es = 'Caldo de Res' WHERE name = 'Caldo de Res';
UPDATE food_items SET name_es = 'Sopa de Salchichón' WHERE name = 'Sopa de Salchichón';

-- Viandas & Sides
UPDATE food_items SET name_es = 'Batata / Boniato (hervida)' WHERE name = 'Batata / Boniato (boiled sweet potato)';
UPDATE food_items SET name_es = 'Guineo Verde Hervido' WHERE name = 'Guineo Verde Hervido (boiled green banana)';
UPDATE food_items SET name_es = 'Plátano Hervido' WHERE name = 'Plátano Hervido (boiled plantain)';
UPDATE food_items SET name_es = 'Ensalada de Coditos' WHERE name = 'Ensalada de Coditos (macaroni salad)';
UPDATE food_items SET name_es = 'Ensalada de Papa' WHERE name = 'Ensalada de Papa (potato salad)';

-- Pastelón & Pasteles
UPDATE food_items SET name_es = 'Lasagna Boricua' WHERE name = 'Lasagna Boricua';

-- Desayuno
UPDATE food_items SET name_es = 'Huevos Revueltos con Jamón' WHERE name = 'Huevos Revueltos con Jamón';
UPDATE food_items SET name_es = 'Tortilla de Huevo (tortilla española)' WHERE name = 'Tortilla de Huevo (Spanish omelette)';
UPDATE food_items SET name_es = 'Avena (estilo puertorriqueño)' WHERE name = 'Avena (oatmeal, Puerto Rican style)';
UPDATE food_items SET name_es = 'Majarete (pudín de maíz)' WHERE name = 'Majarete (corn pudding)';
UPDATE food_items SET name_es = 'Panqueques con Sirope' WHERE name = 'Panqueques con Sirope';

-- Panadería
UPDATE food_items SET name_es = 'Quesito (pastelillo de queso crema)' WHERE name = 'Quesito (cream cheese pastry)';
UPDATE food_items SET name_es = 'Brazo Gitano (bizcocho enrollado)' WHERE name = 'Brazo Gitano (jelly roll cake)';
UPDATE food_items SET name_es = 'Bizcocho de Ron' WHERE name = 'Bizcocho de Ron (rum cake)';
UPDATE food_items SET name_es = 'Mantecaditos (galletas de manteca)' WHERE name = 'Mantecaditos (shortbread cookies)';
UPDATE food_items SET name_es = 'Polvorón' WHERE name = 'Polvorón';

-- Postres
UPDATE food_items SET name_es = 'Besitos de Coco' WHERE name = 'Besitos de Coco (coconut kisses)';
UPDATE food_items SET name_es = 'Dulce de Lechoza (postre de papaya)' WHERE name = 'Dulce de Lechoza (papaya dessert)';
UPDATE food_items SET name_es = 'Arroz con Coco' WHERE name = 'Arroz con Coco';

-- Bebidas
UPDATE food_items SET name_es = 'Jugo de Parcha (maracuyá)' WHERE name = 'Jugo de Parcha (passion fruit)';
UPDATE food_items SET name_es = 'Jugo de Guayaba' WHERE name = 'Jugo de Guayaba (guava)';
UPDATE food_items SET name_es = 'Jugo de Acerola' WHERE name = 'Jugo de Acerola';
UPDATE food_items SET name_es = 'Morir Soñando' WHERE name = 'Morir Soñando';
UPDATE food_items SET name_es = 'Medalla Light (cerveza)' WHERE name = 'Medalla Light (beer)';
UPDATE food_items SET name_es = 'Piña Colada' WHERE name = 'Piña Colada';

-- Pollo Tropical / Local Chains
UPDATE food_items SET name_es = 'TropiChop (pollo, arroz blanco, habichuelas)' WHERE name = 'TropiChop (chicken, white rice, beans)' AND brand = 'Pollo Tropical';
UPDATE food_items SET name_es = 'Cuarto de Pollo (carne oscura)' WHERE name = 'Quarter Chicken (dark meat)' AND brand = 'Pollo Tropical';
UPDATE food_items SET name_es = 'Cuarto de Pollo (carne blanca)' WHERE name = 'Quarter Chicken (white meat)' AND brand = 'Pollo Tropical';
UPDATE food_items SET name_es = 'Arroz Moro' WHERE name = 'Moro Rice' AND brand = 'Pollo Tropical';
UPDATE food_items SET name_es = 'Maduros' WHERE name = 'Sweet Plantains' AND brand = 'Pollo Tropical';
UPDATE food_items SET name_es = 'Quesadilla de Pollo' WHERE name = 'Chicken Quesadilla' AND brand = 'Pollo Tropical';
UPDATE food_items SET name_es = 'Pica Pollo (pollo frito, 2 piezas)' WHERE name = 'Pica Pollo (fried chicken, 2 pc)';
UPDATE food_items SET name_es = 'Yaroa de Pollo (papas cargadas con pollo)' WHERE name = 'Yaroa de Pollo (chicken loaded fries)';

-- Dominicano / Caribbean Crossover
UPDATE food_items SET name_es = 'Chimichurri Burger (dominicana)' WHERE name = 'Chimichurri Burger (Dominican)';
UPDATE food_items SET name_es = 'Moro de Habichuelas Negras' WHERE name = 'Moro de Habichuelas Negras';
UPDATE food_items SET name_es = 'Moro de Gandules' WHERE name = 'Moro de Gandules';
UPDATE food_items SET name_es = 'Pastelitos Dominicanos (pollo)' WHERE name = 'Pastelitos Dominicanos (chicken)';
UPDATE food_items SET name_es = 'Habichuela con Dulce' WHERE name = 'Habichuela con Dulce';
UPDATE food_items SET name_es = 'Concón (arroz crujiente, dominicano)' WHERE name = 'Concón (crispy rice, Dominican)';
UPDATE food_items SET name_es = 'Chofán (arroz frito dominicano)' WHERE name = 'Chofán (Dominican fried rice)';

-- Cuban & Other Caribbean
UPDATE food_items SET name_es = 'Sándwich Cubano' WHERE name = 'Cubano Sandwich';
UPDATE food_items SET name_es = 'Ropa Vieja' WHERE name = 'Ropa Vieja';
UPDATE food_items SET name_es = 'Vaca Frita' WHERE name = 'Vaca Frita';
UPDATE food_items SET name_es = 'Sándwich Medianoche' WHERE name = 'Medianoche Sandwich';
UPDATE food_items SET name_es = 'Croquetas de Jamón (4)' WHERE name = 'Croquetas de Jamón (4)';
UPDATE food_items SET name_es = 'Empanada de Carne' WHERE name = 'Empanada de Carne';
UPDATE food_items SET name_es = 'Arepas de Queso' WHERE name = 'Arepas de Queso';

-- Dominican items already caught by wildcards but ensuring proper translation
UPDATE food_items SET name_es = 'Mangú (plátano majado)' WHERE name = 'Mangú (mashed plantain)';
UPDATE food_items SET name_es = 'Tres Golpes (mangú, huevo, salami, queso)' WHERE name = 'Tres Golpes (mangú, huevo, salami, queso)';
UPDATE food_items SET name_es = 'Sancocho Dominicano (7 carnes)' WHERE name = 'Sancocho Dominicano (7 meats)';

-- PR items with parenthetical English that wildcards caught but deserve cleaner translations
UPDATE food_items SET name_es = 'Papa Rellena' WHERE name = 'Papa Rellena';
UPDATE food_items SET name_es = 'Relleno de Papa (bola de papa rellena de carne)' WHERE name = 'Relleno de Papa (meat stuffed potato ball)';
UPDATE food_items SET name_es = 'Amarillos / Maduros (plátanos maduros)' WHERE name = 'Amarillos / Maduros (sweet plantains)';
UPDATE food_items SET name_es = 'Sopa de Pollo con Fideos' WHERE name = 'Sopa de Pollo con Fideos';
UPDATE food_items SET name_es = 'Bacalao Guisado (guiso de bacalao)' WHERE name = 'Bacalao Guisado (salt cod stew)';
UPDATE food_items SET name_es = 'Chuleta Kan Kan (chuleta de cerdo frita)' WHERE name = 'Chuleta Kan Kan (fried pork chop)';
UPDATE food_items SET name_es = 'Churrasco (falda de res)' WHERE name = 'Churrasco (skirt steak)';
UPDATE food_items SET name_es = 'Pollo a la Brasa (cuarto)' WHERE name = 'Pollo a la Brasa (quarter)';
UPDATE food_items SET name_es = 'Carne Frita (masitas de cerdo)' WHERE name = 'Carne Frita (fried pork chunks)';
UPDATE food_items SET name_es = 'Mofongo de Yuca' WHERE name = 'Mofongo de Yuca';
UPDATE food_items SET name_es = 'Pastelillo de Guayaba' WHERE name = 'Pastelillo de Guayaba';
UPDATE food_items SET name_es = 'Pastelillo de Guayaba y Queso' WHERE name = 'Pastelillo de Guayaba y Queso';
UPDATE food_items SET name_es = 'Limber de Parcha (maracuyá)' WHERE name = 'Limber de Parcha (passion fruit)';
