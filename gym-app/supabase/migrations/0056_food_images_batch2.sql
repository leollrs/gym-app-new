-- Food images batch 2 — more specific category images

-- PR & Caribbean specific
UPDATE food_items SET image_url = '/foods/pernil.jpg' WHERE name ILIKE '%Pernil%' OR name ILIKE '%Lechón%' OR name ILIKE '%Carne Frita%';
UPDATE food_items SET image_url = '/foods/empanada.jpg' WHERE name ILIKE '%Empanadilla%' OR name ILIKE '%Empanada%' OR name ILIKE '%Pastelito%' OR name ILIKE '%Alcapurria%' OR name ILIKE '%Bacalaíto%' OR name ILIKE '%Sorullito%' OR name ILIKE '%Relleno de Papa%' OR name ILIKE '%Papa Rellena%' OR name ILIKE '%Croqueta%' OR name ILIKE '%Samosa%';
UPDATE food_items SET image_url = '/foods/tostones2.jpg' WHERE name ILIKE '%Tostones%' OR name ILIKE '%Amarillos%' OR name ILIKE '%Maduros%' OR name ILIKE '%Pionono%' OR name ILIKE '%Aranitas%' OR name ILIKE '%Tostón Relleno%' OR name ILIKE '%Mangú%' OR name ILIKE '%Mofongo%' OR name ILIKE '%Trifongo%' OR name ILIKE '%Pastelón%';
UPDATE food_items SET image_url = '/foods/tres_leches.jpg' WHERE name ILIKE '%Tres Leches%' OR name ILIKE '%Tembleque%' OR name ILIKE '%Flan%' OR name ILIKE '%Arroz con Dulce%' OR name ILIKE '%Dulce de Lechoza%' OR name ILIKE '%Habichuela con Dulce%' OR name ILIKE '%Besitos de Coco%';
UPDATE food_items SET image_url = '/foods/soup.jpg' WHERE name ILIKE '%Asopao%' OR name ILIKE '%Sancocho%' OR name ILIKE '%Sopa%' OR name ILIKE '%Caldo%' OR name ILIKE '%Pho%' OR name ILIKE '%Chili %';

-- International
UPDATE food_items SET image_url = '/foods/ramen.jpg' WHERE name ILIKE '%Ramen%';
UPDATE food_items SET image_url = '/foods/curry.jpg' WHERE name ILIKE '%Curry%' OR name ILIKE '%Tikka%' OR name ILIKE '%Butter Chicken%';
UPDATE food_items SET image_url = '/foods/gyro.jpg' WHERE name ILIKE '%Gyro%' OR name ILIKE '%Shawarma%' OR name ILIKE '%Falafel%';
UPDATE food_items SET image_url = '/foods/dumpling.jpg' WHERE name ILIKE '%Dumpling%' OR name ILIKE '%Spring Roll%' OR name ILIKE '%Egg Roll%' OR name ILIKE '%Satay%';
UPDATE food_items SET image_url = '/foods/fried_rice.jpg' WHERE name ILIKE '%Fried Rice%' OR name ILIKE '%Pad Thai%' OR name ILIKE '%Lo Mein%' OR name ILIKE '%Chow Mein%' OR name ILIKE '%Bibimbap%' OR name ILIKE '%Chofán%';
UPDATE food_items SET image_url = '/foods/wings.jpg' WHERE name ILIKE '%Wing%' OR name ILIKE '%Alitas%' OR name ILIKE '%Pica Pollo%';
UPDATE food_items SET image_url = '/foods/nachos.jpg' WHERE name ILIKE '%Nachos%';
UPDATE food_items SET image_url = '/foods/quesadilla.jpg' WHERE name ILIKE '%Quesadilla%';
UPDATE food_items SET image_url = '/foods/wrap.jpg' WHERE name ILIKE '%Wrap%' OR name ILIKE '%Cool Wrap%';

-- Breakfast specific
UPDATE food_items SET image_url = '/foods/pancakes.jpg' WHERE name ILIKE '%Pancake%' OR name ILIKE '%Panqueque%' OR name ILIKE '%Hotcake%';
UPDATE food_items SET image_url = '/foods/waffle.jpg' WHERE name ILIKE '%Waffle%';
UPDATE food_items SET image_url = '/foods/french_toast.jpg' WHERE name ILIKE '%French Toast%';
UPDATE food_items SET image_url = '/foods/cereal.jpg' WHERE name ILIKE '%Cheerios%' OR name ILIKE '%Flakes%' OR name ILIKE '%Crunch%' OR name ILIKE '%Loops%' OR name ILIKE '%Charms%' OR name ILIKE '%Special K%' OR name ILIKE '%Raisin Bran%';
UPDATE food_items SET image_url = '/foods/bagel.jpg' WHERE name ILIKE '%Bagel%';
UPDATE food_items SET image_url = '/foods/croissant.jpg' WHERE name ILIKE '%Croissant%';
UPDATE food_items SET image_url = '/foods/avocado_toast.jpg' WHERE name ILIKE '%Avocado%' OR name ILIKE '%Aguacate%';
UPDATE food_items SET image_url = '/foods/yogurt_bowl.jpg' WHERE name ILIKE '%Yogurt%' OR name ILIKE '%Yogur%' OR name ILIKE '%Parfait%';

-- Meats specific
UPDATE food_items SET image_url = '/foods/pork_chop.jpg' WHERE name ILIKE '%Pork Chop%' OR name ILIKE '%Pork Tenderloin%' OR name ILIKE '%Chuleta%';
UPDATE food_items SET image_url = '/foods/lamb.jpg' WHERE name ILIKE '%Lamb%' OR name ILIKE '%Cordero%';
UPDATE food_items SET image_url = '/foods/shrimp2.jpg' WHERE name ILIKE '%Shrimp%' OR name ILIKE '%Camarones%';
UPDATE food_items SET image_url = '/foods/lobster.jpg' WHERE name ILIKE '%Lobster%' OR name ILIKE '%Langosta%' OR name ILIKE '%Crab%' OR name ILIKE '%Cangrejo%';
UPDATE food_items SET image_url = '/foods/hot_dog.jpg' WHERE name ILIKE '%Hot Dog%';

-- Desserts specific
UPDATE food_items SET image_url = '/foods/brownie.jpg' WHERE name ILIKE '%Brownie%';
UPDATE food_items SET image_url = '/foods/cheesecake.jpg' WHERE name ILIKE '%Cheesecake%' OR name ILIKE '%Pie %';

-- Drinks specific
UPDATE food_items SET image_url = '/foods/latte.jpg' WHERE name ILIKE '%Latte%' OR name ILIKE '%Macchiato%' OR name ILIKE '%Frappuccino%' OR name ILIKE '%Mocha%' OR name ILIKE '%Cold Brew%' OR name ILIKE '%Café con Leche%' OR name ILIKE '%Chai%' OR name ILIKE '%Matcha%';
UPDATE food_items SET image_url = '/foods/energy_drink.jpg' WHERE name ILIKE '%Monster%' OR name ILIKE '%Red Bull%' OR name ILIKE '%Celsius%' OR name ILIKE '%Body Armor%' OR name ILIKE '%Gatorade%' OR name ILIKE '%Powerade%';

-- Snacks specific
UPDATE food_items SET image_url = '/foods/protein_bar.jpg' WHERE name ILIKE '%Protein Bar%' OR name ILIKE '%Quest%' OR name ILIKE '%RXBar%' OR name ILIKE '%ONE Bar%' OR name ILIKE '%Clif Bar%' OR name ILIKE '%Kind%' OR name ILIKE '%Larabar%' OR name ILIKE '%Barra%';
UPDATE food_items SET image_url = '/foods/trail_mix.jpg' WHERE name ILIKE '%Trail Mix%' OR name ILIKE '%Mixed Nuts%' OR name ILIKE '%Nueces Mixtas%';
UPDATE food_items SET image_url = '/foods/corn.jpg' WHERE name ILIKE '%Corn%' AND name NOT ILIKE '%Tortilla%';

-- PR bakery
UPDATE food_items SET image_url = '/foods/croissant.jpg' WHERE name ILIKE '%Mallorca%' OR name ILIKE '%Quesito%' OR name ILIKE '%Pastelillo%' OR name ILIKE '%Brazo Gitano%' OR name ILIKE '%Bizcocho%' OR name ILIKE '%Mantecadito%' OR name ILIKE '%Polvorón%' OR name ILIKE '%Pan Sobao%';
