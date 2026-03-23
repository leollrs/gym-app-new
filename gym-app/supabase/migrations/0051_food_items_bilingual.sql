-- Add Spanish name column to food_items for bilingual search
ALTER TABLE food_items ADD COLUMN IF NOT EXISTS name_es TEXT;

-- Create index for Spanish name search
CREATE INDEX IF NOT EXISTS idx_food_items_name_es ON food_items USING gin(to_tsvector('spanish', coalesce(name_es, '')));

-- ═══════════════════════════════════════════════════════════
-- Update ALL food items with Spanish translations
-- ═══════════════════════════════════════════════════════════

-- ── PROTEINS ──
UPDATE food_items SET name_es = 'Pechuga de Pollo (cocida)' WHERE name = 'Chicken Breast (cooked)';
UPDATE food_items SET name_es = 'Muslo de Pollo (cocido)' WHERE name = 'Chicken Thigh (cooked)';
UPDATE food_items SET name_es = 'Pavo Molido (93% magro)' WHERE name = 'Ground Turkey (93% lean)';
UPDATE food_items SET name_es = 'Carne Molida (90% magra)' WHERE name = 'Ground Beef (90% lean)';
UPDATE food_items SET name_es = 'Carne Molida (80% magra)' WHERE name = 'Ground Beef (80% lean)';
UPDATE food_items SET name_es = 'Filete de Salmón (cocido)' WHERE name = 'Salmon Fillet (cooked)';
UPDATE food_items SET name_es = 'Atún (enlatado en agua)' WHERE name = 'Tuna (canned in water)';
UPDATE food_items SET name_es = 'Camarones (cocidos)' WHERE name = 'Shrimp (cooked)';
UPDATE food_items SET name_es = 'Tilapia (cocida)' WHERE name = 'Tilapia (cooked)';
UPDATE food_items SET name_es = 'Lomo de Cerdo (cocido)' WHERE name = 'Pork Tenderloin (cooked)';
UPDATE food_items SET name_es = 'Bistec — Solomillo (cocido)' WHERE name = 'Steak — Sirloin (cooked)';
UPDATE food_items SET name_es = 'Bistec — Ribeye (cocido)' WHERE name = 'Steak — Ribeye (cooked)';
UPDATE food_items SET name_es = 'Pechuga de Pavo (deli)' WHERE name = 'Turkey Breast (deli)';
UPDATE food_items SET name_es = 'Tocineta (cocida)' WHERE name = 'Bacon (cooked)';
UPDATE food_items SET name_es = 'Salchicha de Cerdo' WHERE name = 'Sausage Link (pork)';

-- ── EGGS & DAIRY ──
UPDATE food_items SET name_es = 'Huevo (entero, grande)' WHERE name = 'Egg (whole, large)';
UPDATE food_items SET name_es = 'Clara de Huevo' WHERE name = 'Egg White';
UPDATE food_items SET name_es = 'Yogur Griego (natural, 0%)' WHERE name = 'Greek Yogurt (plain, 0%)';
UPDATE food_items SET name_es = 'Yogur Griego (natural, 2%)' WHERE name = 'Greek Yogurt (plain, 2%)';
UPDATE food_items SET name_es = 'Requesón (2%)' WHERE name = 'Cottage Cheese (2%)';
UPDATE food_items SET name_es = 'Leche Entera' WHERE name = 'Milk (whole)';
UPDATE food_items SET name_es = 'Leche (2%)' WHERE name = 'Milk (2%)';
UPDATE food_items SET name_es = 'Leche Descremada' WHERE name = 'Milk (skim)';
UPDATE food_items SET name_es = 'Queso Cheddar' WHERE name = 'Cheese — Cheddar';
UPDATE food_items SET name_es = 'Queso Mozzarella' WHERE name = 'Cheese — Mozzarella';
UPDATE food_items SET name_es = 'Mantequilla' WHERE name = 'Butter';
UPDATE food_items SET name_es = 'Queso Crema' WHERE name = 'Cream Cheese';

-- ── GRAINS & STARCHES ──
UPDATE food_items SET name_es = 'Arroz Blanco (cocido)' WHERE name = 'White Rice (cooked)';
UPDATE food_items SET name_es = 'Arroz Integral (cocido)' WHERE name = 'Brown Rice (cooked)';
UPDATE food_items SET name_es = 'Arroz Jazmín (cocido)' WHERE name = 'Jasmine Rice (cooked)';
UPDATE food_items SET name_es = 'Quinoa (cocida)' WHERE name = 'Quinoa (cooked)';
UPDATE food_items SET name_es = 'Pasta (cocida)' WHERE name = 'Pasta (cooked)';
UPDATE food_items SET name_es = 'Pan Blanco' WHERE name = 'Bread — White';
UPDATE food_items SET name_es = 'Pan Integral' WHERE name = 'Bread — Whole Wheat';
UPDATE food_items SET name_es = 'Tortilla de Harina (8")' WHERE name = 'Tortilla — Flour (8")';
UPDATE food_items SET name_es = 'Tortilla de Maíz' WHERE name = 'Tortilla — Corn';
UPDATE food_items SET name_es = 'Avena (seca)' WHERE name = 'Oatmeal (dry)';
UPDATE food_items SET name_es = 'Bagel (natural)' WHERE name = 'Bagel (plain)';
UPDATE food_items SET name_es = 'Papa al Horno (mediana)' WHERE name = 'Potato (baked, medium)';
UPDATE food_items SET name_es = 'Batata al Horno (mediana)' WHERE name = 'Sweet Potato (baked, medium)';

-- ── FRUITS ──
UPDATE food_items SET name_es = 'Guineo / Banana' WHERE name = 'Banana';
UPDATE food_items SET name_es = 'Manzana' WHERE name = 'Apple';
UPDATE food_items SET name_es = 'China / Naranja' WHERE name = 'Orange';
UPDATE food_items SET name_es = 'Arándanos' WHERE name = 'Blueberries';
UPDATE food_items SET name_es = 'Fresas' WHERE name = 'Strawberries';
UPDATE food_items SET name_es = 'Uvas' WHERE name = 'Grapes';
UPDATE food_items SET name_es = 'Aguacate' WHERE name = 'Avocado';
UPDATE food_items SET name_es = 'Mango' WHERE name = 'Mango';
UPDATE food_items SET name_es = 'Sandía' WHERE name = 'Watermelon';
UPDATE food_items SET name_es = 'Piña' WHERE name = 'Pineapple';
UPDATE food_items SET name_es = 'Melocotón / Durazno' WHERE name = 'Peach';
UPDATE food_items SET name_es = 'Ciruela' WHERE name = 'Plum';
UPDATE food_items SET name_es = 'Kiwi' WHERE name = 'Kiwi';
UPDATE food_items SET name_es = 'Granada' WHERE name = 'Pomegranate (seeds)';
UPDATE food_items SET name_es = 'Higos (frescos)' WHERE name = 'Figs (fresh)';
UPDATE food_items SET name_es = 'Dátiles (Medjool)' WHERE name = 'Dates (Medjool)';
UPDATE food_items SET name_es = 'Arándanos Secos' WHERE name = 'Dried Cranberries';
UPDATE food_items SET name_es = 'Pasas' WHERE name = 'Raisins';
UPDATE food_items SET name_es = 'Frambuesas' WHERE name = 'Raspberries';
UPDATE food_items SET name_es = 'Moras' WHERE name = 'Blackberries';
UPDATE food_items SET name_es = 'Melón' WHERE name = 'Cantaloupe (cubed)';
UPDATE food_items SET name_es = 'Melón Verde' WHERE name = 'Honeydew (cubed)';

-- ── VEGETABLES ──
UPDATE food_items SET name_es = 'Brócoli (cocido)' WHERE name = 'Broccoli (cooked)';
UPDATE food_items SET name_es = 'Espinaca (cruda)' WHERE name = 'Spinach (raw)';
UPDATE food_items SET name_es = 'Ensalada Verde Mixta' WHERE name = 'Mixed Salad Greens';
UPDATE food_items SET name_es = 'Zanahoria (cruda)' WHERE name = 'Carrots (raw)';
UPDATE food_items SET name_es = 'Pimiento / Ají' WHERE name = 'Bell Pepper';
UPDATE food_items SET name_es = 'Tomate' WHERE name = 'Tomato';
UPDATE food_items SET name_es = 'Pepinillo / Pepino' WHERE name = 'Cucumber';
UPDATE food_items SET name_es = 'Habichuelas Tiernas (cocidas)' WHERE name = 'Green Beans (cooked)';
UPDATE food_items SET name_es = 'Espárragos (cocidos)' WHERE name = 'Asparagus (cooked)';
UPDATE food_items SET name_es = 'Maíz (cocido)' WHERE name = 'Corn (cooked)';
UPDATE food_items SET name_es = 'Champiñones (crudos)' WHERE name = 'Mushrooms (raw)';
UPDATE food_items SET name_es = 'Cebolla (cruda)' WHERE name = 'Onion (raw)';
UPDATE food_items SET name_es = 'Calabacín (cocido)' WHERE name = 'Zucchini (cooked)';
UPDATE food_items SET name_es = 'Col Rizada / Kale (cruda)' WHERE name = 'Kale (raw, chopped)';
UPDATE food_items SET name_es = 'Coliflor (cruda)' WHERE name = 'Cauliflower (raw)';
UPDATE food_items SET name_es = 'Coles de Bruselas (cocidas)' WHERE name = 'Brussels Sprouts (cooked)';
UPDATE food_items SET name_es = 'Berenjena (cocida)' WHERE name = 'Eggplant (cooked)';
UPDATE food_items SET name_es = 'Alcachofa (cocida)' WHERE name = 'Artichoke (medium, cooked)';
UPDATE food_items SET name_es = 'Remolacha (cocida)' WHERE name = 'Beets (cooked, sliced)';
UPDATE food_items SET name_es = 'Repollo (crudo)' WHERE name = 'Cabbage (raw, shredded)';
UPDATE food_items SET name_es = 'Apio' WHERE name = 'Celery (raw)';
UPDATE food_items SET name_es = 'Rábanos' WHERE name = 'Radishes (raw, sliced)';
UPDATE food_items SET name_es = 'Guisantes / Snap Peas' WHERE name = 'Snap Peas (raw)';

-- ── LEGUMES & NUTS ──
UPDATE food_items SET name_es = 'Habichuelas Negras (cocidas)' WHERE name = 'Black Beans (cooked)';
UPDATE food_items SET name_es = 'Garbanzos (cocidos)' WHERE name = 'Chickpeas (cooked)';
UPDATE food_items SET name_es = 'Lentejas (cocidas)' WHERE name = 'Lentils (cooked)';
UPDATE food_items SET name_es = 'Mantequilla de Maní' WHERE name = 'Peanut Butter';
UPDATE food_items SET name_es = 'Mantequilla de Almendra' WHERE name = 'Almond Butter';
UPDATE food_items SET name_es = 'Almendras' WHERE name = 'Almonds';
UPDATE food_items SET name_es = 'Nueces' WHERE name = 'Walnuts';
UPDATE food_items SET name_es = 'Anacardos / Cashews' WHERE name = 'Cashews';
UPDATE food_items SET name_es = 'Nueces Mixtas' WHERE name = 'Mixed Nuts';
UPDATE food_items SET name_es = 'Pistachos' WHERE name = 'Pistachios';
UPDATE food_items SET name_es = 'Nueces de Macadamia' WHERE name = 'Macadamia Nuts';
UPDATE food_items SET name_es = 'Pacanas' WHERE name = 'Pecans';
UPDATE food_items SET name_es = 'Piñones' WHERE name = 'Pine Nuts';
UPDATE food_items SET name_es = 'Semillas de Girasol' WHERE name = 'Sunflower Seeds (shelled)';
UPDATE food_items SET name_es = 'Semillas de Calabaza' WHERE name = 'Pumpkin Seeds (shelled)';
UPDATE food_items SET name_es = 'Semillas de Chía' WHERE name = 'Chia Seeds';
UPDATE food_items SET name_es = 'Linaza Molida' WHERE name = 'Flax Seeds (ground)';
UPDATE food_items SET name_es = 'Corazones de Cáñamo' WHERE name = 'Hemp Hearts';

-- ── SUPPLEMENTS ──
UPDATE food_items SET name_es = 'Batida de Proteína Whey' WHERE name = 'Whey Protein Shake';
UPDATE food_items SET name_es = 'Batida de Proteína Caseína' WHERE name = 'Casein Protein Shake';
UPDATE food_items SET name_es = 'Batida para Masa Muscular' WHERE name = 'Mass Gainer Shake';
UPDATE food_items SET name_es = 'Barra de Proteína (promedio)' WHERE name = 'Protein Bar (average)';

-- ── OILS & FATS ──
UPDATE food_items SET name_es = 'Aceite de Oliva' WHERE name = 'Olive Oil';
UPDATE food_items SET name_es = 'Aceite de Coco' WHERE name = 'Coconut Oil';
UPDATE food_items SET name_es = 'Spray de Cocina (PAM)' WHERE name = 'Cooking Spray (PAM)';

-- ── CONDIMENTS ──
UPDATE food_items SET name_es = 'Miel' WHERE name = 'Honey';
UPDATE food_items SET name_es = 'Salsa de Soya' WHERE name = 'Soy Sauce';
UPDATE food_items SET name_es = 'Salsa Picante' WHERE name = 'Hot Sauce';
UPDATE food_items SET name_es = 'Kétchup' WHERE name = 'Ketchup';
UPDATE food_items SET name_es = 'Mostaza' WHERE name = 'Mustard';
UPDATE food_items SET name_es = 'Aderezo Ranch' WHERE name = 'Ranch Dressing';
UPDATE food_items SET name_es = 'Salsa (pico de gallo)' WHERE name = 'Salsa';
UPDATE food_items SET name_es = 'Hummus' WHERE name = 'Hummus';
UPDATE food_items SET name_es = 'Guacamole' WHERE name = 'Guacamole';
UPDATE food_items SET name_es = 'Salsa BBQ' WHERE name = 'BBQ Sauce';
UPDATE food_items SET name_es = 'Mayonesa' WHERE name = 'Mayonnaise';

-- ── DRINKS ──
UPDATE food_items SET name_es = 'Agua' WHERE name = 'Water';
UPDATE food_items SET name_es = 'Café Negro' WHERE name = 'Black Coffee';
UPDATE food_items SET name_es = 'Jugo de China / Naranja' WHERE name = 'Orange Juice';
UPDATE food_items SET name_es = 'Leche de Almendra (sin azúcar)' WHERE name = 'Almond Milk (unsweetened)';
UPDATE food_items SET name_es = 'Leche de Avena' WHERE name = 'Oat Milk';

-- ── COMMON MEALS ──
UPDATE food_items SET name_es = 'Bowl de Pollo y Arroz' WHERE name = 'Chicken & Rice Bowl';
UPDATE food_items SET name_es = 'Batida de Proteína' WHERE name = 'Protein Smoothie';
UPDATE food_items SET name_es = 'Sándwich de Pavo' WHERE name = 'Turkey Sandwich';
UPDATE food_items SET name_es = 'Bistec con Papas' WHERE name = 'Steak & Potatoes';
UPDATE food_items SET name_es = 'Salmón con Vegetales' WHERE name = 'Salmon & Veggies';
UPDATE food_items SET name_es = 'Desayuno de Huevo y Tostada' WHERE name = 'Egg & Toast Breakfast';
UPDATE food_items SET name_es = 'Avena Nocturna' WHERE name = 'Overnight Oats';
UPDATE food_items SET name_es = 'Ensalada de Atún' WHERE name = 'Tuna Salad';
UPDATE food_items SET name_es = 'Bowl de Burrito' WHERE name = 'Burrito Bowl';
UPDATE food_items SET name_es = 'Parfait de Yogur Griego' WHERE name = 'Greek Yogurt Parfait';

-- ── FISH & SEAFOOD ──
UPDATE food_items SET name_es = 'Bacalao (horneado)' WHERE name = 'Cod (baked)';
UPDATE food_items SET name_es = 'Halibut (horneado)' WHERE name = 'Halibut (baked)';
UPDATE food_items SET name_es = 'Sardinas (enlatadas en aceite)' WHERE name = 'Sardines (canned in oil)';
UPDATE food_items SET name_es = 'Bagre (horneado)' WHERE name = 'Catfish (baked)';
UPDATE food_items SET name_es = 'Dorado / Mahi-Mahi (horneado)' WHERE name = 'Mahi-Mahi (baked)';
UPDATE food_items SET name_es = 'Carne de Cangrejo (enlatada)' WHERE name = 'Crab Meat (canned)';
UPDATE food_items SET name_es = 'Langosta (al vapor)' WHERE name = 'Lobster (steamed)';

-- ── MEAT CUTS ──
UPDATE food_items SET name_es = 'Brisket de Res (magro, cocido)' WHERE name = 'Beef Brisket (lean, cooked)';
UPDATE food_items SET name_es = 'Chuleta de Cordero (cocida)' WHERE name = 'Lamb Chop (cooked)';
UPDATE food_items SET name_es = 'Chuleta de Ternera (cocida)' WHERE name = 'Veal Cutlet (cooked)';
UPDATE food_items SET name_es = 'Hamburguesa de Pavo (93% magra)' WHERE name = 'Turkey Burger Patty (93% lean)';
UPDATE food_items SET name_es = 'Hamburguesa de Bisonte' WHERE name = 'Bison Burger Patty';
UPDATE food_items SET name_es = 'Venado (asado)' WHERE name = 'Venison (roasted)';
UPDATE food_items SET name_es = 'Chuleta de Cerdo (con hueso, cocida)' WHERE name = 'Pork Chop (bone-in, cooked)';
UPDATE food_items SET name_es = 'Cordero Molido (cocido)' WHERE name = 'Lamb (ground, cooked)';

-- ── PLANT PROTEINS ──
UPDATE food_items SET name_es = 'Tofu (firme)' WHERE name = 'Tofu (firm)';
UPDATE food_items SET name_es = 'Tempeh' WHERE name = 'Tempeh';
UPDATE food_items SET name_es = 'Seitán' WHERE name = 'Seitan';
UPDATE food_items SET name_es = 'Edamame (sin cáscara)' WHERE name = 'Edamame (shelled)';

-- ── GRAINS ──
UPDATE food_items SET name_es = 'Cuscús (cocido)' WHERE name = 'Couscous (cooked)';
UPDATE food_items SET name_es = 'Trigo Bulgur (cocido)' WHERE name = 'Bulgur Wheat (cooked)';
UPDATE food_items SET name_es = 'Farro (cocido)' WHERE name = 'Farro (cooked)';
UPDATE food_items SET name_es = 'Cebada (cocida)' WHERE name = 'Barley (cooked)';
UPDATE food_items SET name_es = 'Arroz Salvaje (cocido)' WHERE name = 'Wild Rice (cooked)';

-- ── BEANS ──
UPDATE food_items SET name_es = 'Habichuelas Coloradas (cocidas)' WHERE name = 'Kidney Beans (cooked)';
UPDATE food_items SET name_es = 'Habichuelas Pintas (cocidas)' WHERE name = 'Pinto Beans (cooked)';
UPDATE food_items SET name_es = 'Habichuelas Navy (cocidas)' WHERE name = 'Navy Beans (cooked)';
UPDATE food_items SET name_es = 'Habichuelas Refritas' WHERE name = 'Refried Beans';

-- ── DESSERTS ──
UPDATE food_items SET name_es = 'Helado de Vainilla' WHERE name = 'Vanilla Ice Cream';
UPDATE food_items SET name_es = 'Helado de Chocolate' WHERE name = 'Chocolate Ice Cream';
UPDATE food_items SET name_es = 'Yogur Helado (vainilla)' WHERE name = 'Frozen Yogurt (vanilla)';
UPDATE food_items SET name_es = 'Brownie (casero)' WHERE name = 'Brownie (homemade)';
UPDATE food_items SET name_es = 'Galleta de Chispas de Chocolate (grande)' WHERE name = 'Chocolate Chip Cookie (large)';
UPDATE food_items SET name_es = 'Cheesecake (1 rebanada)' WHERE name = 'Cheesecake (1 slice)';
UPDATE food_items SET name_es = 'Pie de Manzana (1 rebanada)' WHERE name = 'Apple Pie (1 slice)';
UPDATE food_items SET name_es = 'Donut Glaseado' WHERE name = 'Plain Glazed Donut';
UPDATE food_items SET name_es = 'Rollo de Canela (grande)' WHERE name = 'Cinnamon Roll (large)';
UPDATE food_items SET name_es = 'Muffin de Arándano (panadería)' WHERE name = 'Blueberry Muffin (bakery)';
UPDATE food_items SET name_es = 'Panqueques (3 medianos)' WHERE name = 'Pancakes (plain, 3 medium)';
UPDATE food_items SET name_es = 'Waffles (2 redondos)' WHERE name = 'Waffles (plain, 2 round)';
UPDATE food_items SET name_es = 'Tostadas Francesas (2 rebanadas)' WHERE name = 'French Toast (2 slices)';
UPDATE food_items SET name_es = 'Chocolate Oscuro (70%)' WHERE name = 'Dark Chocolate (70%)';
UPDATE food_items SET name_es = 'Chocolate con Leche' WHERE name = 'Milk Chocolate';

-- ── INTERNATIONAL ──
UPDATE food_items SET name_es = 'Rollo California (6 piezas)' WHERE name = 'California Roll (6 pc)';
UPDATE food_items SET name_es = 'Rollo de Atún Picante (6 piezas)' WHERE name = 'Spicy Tuna Roll (6 pc)';
UPDATE food_items SET name_es = 'Rollo de Salmón (6 piezas)' WHERE name = 'Salmon Roll (6 pc)';
UPDATE food_items SET name_es = 'Pad Thai (pollo)' WHERE name = 'Pad Thai (chicken)';
UPDATE food_items SET name_es = 'Arroz Frito (para llevar)' WHERE name = 'Fried Rice (takeout)';
UPDATE food_items SET name_es = 'Lo Mein (pollo)' WHERE name = 'Lo Mein (chicken)';
UPDATE food_items SET name_es = 'Pollo General Tso' WHERE name = 'General Tso''s Chicken';
UPDATE food_items SET name_es = 'Pollo Tikka Masala' WHERE name = 'Chicken Tikka Masala';
UPDATE food_items SET name_es = 'Falafel (4 bolas)' WHERE name = 'Falafel (4 balls)';
UPDATE food_items SET name_es = 'Wrap de Shawarma de Pollo' WHERE name = 'Chicken Shawarma Wrap';
UPDATE food_items SET name_es = 'Gyro (cordero y res)' WHERE name = 'Gyro (lamb & beef)';
UPDATE food_items SET name_es = 'Pho (res, con fideos)' WHERE name = 'Pho (beef, with noodles)';
UPDATE food_items SET name_es = 'Ramen Instantáneo' WHERE name = 'Instant Ramen (1 packet)';
UPDATE food_items SET name_es = 'Ramen de Restaurante (tonkotsu)' WHERE name = 'Restaurant Ramen (tonkotsu)';
UPDATE food_items SET name_es = 'Bibimbap' WHERE name = 'Bibimbap';
UPDATE food_items SET name_es = 'Tamal de Cerdo' WHERE name = 'Pork Tamale';
UPDATE food_items SET name_es = 'Empanada de Carne' WHERE name = 'Beef Empanada';
UPDATE food_items SET name_es = 'Pupusa (queso)' WHERE name = 'Pupusa (cheese)';
UPDATE food_items SET name_es = 'Pollo Jerk (muslo)' WHERE name = 'Jerk Chicken (thigh)';
UPDATE food_items SET name_es = 'Curry de Pollo (tailandés verde)' WHERE name = 'Chicken Curry (Thai green)';
UPDATE food_items SET name_es = 'Curry de Pollo (japonés)' WHERE name = 'Chicken Curry (Japanese)';
UPDATE food_items SET name_es = 'Dumplings de Cerdo al Vapor (6 piezas)' WHERE name = 'Pork Dumplings (steamed, 6 pc)';
UPDATE food_items SET name_es = 'Dumplings de Cerdo Fritos (6 piezas)' WHERE name = 'Pork Dumplings (fried, 6 pc)';
UPDATE food_items SET name_es = 'Rollitos Primavera (2 piezas)' WHERE name = 'Vegetable Spring Rolls (2 pc)';
UPDATE food_items SET name_es = 'Rollitos de Huevo (2 piezas)' WHERE name = 'Pork Egg Rolls (2 pc)';
UPDATE food_items SET name_es = 'Bowl de Pollo Teriyaki' WHERE name = 'Chicken Teriyaki Bowl';
UPDATE food_items SET name_es = 'Pollo con Mantequilla (Butter Chicken)' WHERE name = 'Butter Chicken';
UPDATE food_items SET name_es = 'Curry de Cordero (vindaloo)' WHERE name = 'Lamb Curry (vindaloo)';
UPDATE food_items SET name_es = 'Samosa de Vegetales' WHERE name = 'Vegetable Samosa (1 pc)';
UPDATE food_items SET name_es = 'Satay de Pollo (4 palitos)' WHERE name = 'Chicken Satay (4 skewers)';

-- ── PR FOODS — already have Spanish names, add English translations to name_es as alternate search ──
-- For PR foods, name is already in Spanish. Set name_es = name so search works in both.
UPDATE food_items SET name_es = name WHERE name LIKE 'Arroz con%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Habichuelas%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Mofongo%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Asopao%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Pastel%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Sancocho%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Tostones%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Alcapurria%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Empanadilla%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Flan%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Tembleque%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Limber%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Piragua%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Coquito%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Pernil%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Lechón%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Pollo%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Carne%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Bistec%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Chuleta%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Chicharrón%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Mangú%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Tres%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Mallorca%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Pan %' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Café%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Malta%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Bacala%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Camarones%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Yuca%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Sorullito%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Relleno%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Cubano%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Ropa%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Vaca%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Medianoche%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Croquetas%' AND name_es IS NULL;
UPDATE food_items SET name_es = name WHERE name LIKE 'Arepas%' AND name_es IS NULL;

-- Set any remaining NULL name_es to the English name as fallback
UPDATE food_items SET name_es = name WHERE name_es IS NULL;
