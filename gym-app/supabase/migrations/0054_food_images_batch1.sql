-- Food images batch 1 — 47 category images from Unsplash
-- Maps all 669 food items to downloaded images in /foods/

-- Proteins
UPDATE food_items SET image_url = '/foods/chicken_breast.jpg' WHERE image_url IS NULL AND (name ILIKE '%Chicken Breast%' OR name ILIKE '%Pechuga%' OR name ILIKE '%Pollo Guisado%' OR name ILIKE '%Pollo Frito%' OR name ILIKE '%Pollo a la Brasa%' OR name ILIKE '%Chicharrón%' OR name ILIKE '%Pork%' OR name ILIKE '%Pernil%' OR name ILIKE '%Lechón%' OR name ILIKE '%Chuleta%' OR name ILIKE '%Jerk Chicken%');
UPDATE food_items SET image_url = '/foods/chicken_thigh.jpg' WHERE image_url IS NULL AND (name ILIKE '%Chicken Thigh%' OR name ILIKE '%Muslo de Pollo%');
UPDATE food_items SET image_url = '/foods/ground_beef.jpg' WHERE image_url IS NULL AND (name ILIKE '%Ground Beef%' OR name ILIKE '%Ground Turkey%' OR name ILIKE '%Carne Molida%' OR name ILIKE '%Carne Guisada%' OR name ILIKE '%Carne Frita%' OR name ILIKE '%Lamb%' OR name ILIKE '%Veal%' OR name ILIKE '%Bison%' OR name ILIKE '%Venison%' OR name ILIKE '%Ropa Vieja%' OR name ILIKE '%Vaca Frita%');
UPDATE food_items SET image_url = '/foods/salmon.jpg' WHERE image_url IS NULL AND (name ILIKE '%Salmon%' OR name ILIKE '%Salmón%' OR name ILIKE '%Halibut%' OR name ILIKE '%Cod %' OR name ILIKE '%Bacalao%' OR name ILIKE '%Tilapia%' OR name ILIKE '%Catfish%' OR name ILIKE '%Mahi%' OR name ILIKE '%Pescado%' OR name ILIKE '%Sardine%' OR name ILIKE '%Lobster%' OR name ILIKE '%Langosta%');
UPDATE food_items SET image_url = '/foods/tuna.jpg' WHERE image_url IS NULL AND (name ILIKE '%Tuna%' OR name ILIKE '%Atún%');
UPDATE food_items SET image_url = '/foods/shrimp.jpg' WHERE image_url IS NULL AND (name ILIKE '%Shrimp%' OR name ILIKE '%Camarones%' OR name ILIKE '%Crab%' OR name ILIKE '%Cangrejo%' OR name ILIKE '%Pulpo%');
UPDATE food_items SET image_url = '/foods/steak.jpg' WHERE image_url IS NULL AND (name ILIKE '%Steak%' OR name ILIKE '%Sirloin%' OR name ILIKE '%Ribeye%' OR name ILIKE '%Bistec%' OR name ILIKE '%Churrasco%' OR name ILIKE '%Brisket%');
UPDATE food_items SET image_url = '/foods/bacon.jpg' WHERE image_url IS NULL AND (name ILIKE '%Bacon%' OR name ILIKE '%Tocineta%' OR name ILIKE '%Sausage%' OR name ILIKE '%Salchicha%' OR name ILIKE '%Turkey Breast (deli)%');

-- Eggs & Dairy
UPDATE food_items SET image_url = '/foods/egg.jpg' WHERE image_url IS NULL AND (name ILIKE 'Egg %' OR name ILIKE '%Huevo%' OR name ILIKE '%Egg White%' OR name ILIKE '%Tortilla de Huevo%');
UPDATE food_items SET image_url = '/foods/greek_yogurt.jpg' WHERE image_url IS NULL AND (name ILIKE '%Yogurt%' OR name ILIKE '%Yogur%');
UPDATE food_items SET image_url = '/foods/milk.jpg' WHERE image_url IS NULL AND (name ILIKE 'Milk%' OR name ILIKE '%Fairlife%Milk%' OR name ILIKE '%Leche%' OR name ILIKE '%Almond Milk%' OR name ILIKE '%Oat Milk%' OR name ILIKE '%Butter%' OR name ILIKE '%Mantequilla%' OR name ILIKE '%Cream Cheese%' OR name ILIKE '%Queso Crema%' OR name ILIKE '%Cottage%' OR name ILIKE '%Requesón%');
UPDATE food_items SET image_url = '/foods/cheese.jpg' WHERE image_url IS NULL AND (name ILIKE '%Cheese%' OR name ILIKE '%Queso%' OR name ILIKE '%Mozzarella%' OR name ILIKE '%Cheddar%' OR name ILIKE '%Swiss%' OR name ILIKE '%Parmesan%');

-- Grains
UPDATE food_items SET image_url = '/foods/rice.jpg' WHERE image_url IS NULL AND (name ILIKE '%Rice%' OR name ILIKE '%Arroz%' OR name ILIKE '%Pegao%' OR name ILIKE '%Concón%');
UPDATE food_items SET image_url = '/foods/quinoa.jpg' WHERE image_url IS NULL AND (name ILIKE '%Quinoa%' OR name ILIKE '%Couscous%' OR name ILIKE '%Bulgur%' OR name ILIKE '%Farro%' OR name ILIKE '%Barley%' OR name ILIKE '%Wild Rice%');
UPDATE food_items SET image_url = '/foods/pasta.jpg' WHERE image_url IS NULL AND (name ILIKE '%Pasta%' OR name ILIKE '%Alfredo%' OR name ILIKE '%Fettuccine%' OR name ILIKE '%Lo Mein%' OR name ILIKE '%Chow Mein%' OR name ILIKE '%Mac & Cheese%' OR name ILIKE '%Ensalada de Coditos%');
UPDATE food_items SET image_url = '/foods/bread.jpg' WHERE image_url IS NULL AND (name ILIKE '%Bread%' OR name ILIKE '%Pan %' OR name ILIKE '%Pan Sobao%' OR name ILIKE '%Bagel%' OR name ILIKE '%Tortilla%' OR name ILIKE '%Naan%' OR name ILIKE '%Pita%' OR name ILIKE '%Mallorca%' OR name ILIKE '%Croissant%' OR name ILIKE '%Bun%' OR name ILIKE '%Biscuit%');
UPDATE food_items SET image_url = '/foods/oatmeal.jpg' WHERE image_url IS NULL AND (name ILIKE '%Oatmeal%' OR name ILIKE '%Avena%' OR name ILIKE '%Cheerios%' OR name ILIKE '%Flakes%' OR name ILIKE '%Crunch%' OR name ILIKE '%Loops%' OR name ILIKE '%Charms%' OR name ILIKE '%Special K%' OR name ILIKE '%Raisin Bran%' OR name ILIKE '%Overnight Oats%');
UPDATE food_items SET image_url = '/foods/potato.jpg' WHERE image_url IS NULL AND (name ILIKE '%Potato%' OR name ILIKE '%Papa %' OR name ILIKE '%Hash Brown%' OR name ILIKE '%Yuca%');
UPDATE food_items SET image_url = '/foods/sweet_potato.jpg' WHERE image_url IS NULL AND (name ILIKE '%Sweet Potato%' OR name ILIKE '%Batata%' OR name ILIKE '%Boniato%');

-- Fruits
UPDATE food_items SET image_url = '/foods/banana.jpg' WHERE image_url IS NULL AND (name ILIKE '%Banana%' OR name ILIKE '%Guineo%' OR name ILIKE '%Mango%' OR name ILIKE '%Peach%' OR name ILIKE '%Plum%' OR name ILIKE '%Kiwi%' OR name ILIKE '%Melon%' OR name ILIKE '%Grapes%' OR name ILIKE '%Uvas%' OR name ILIKE '%Pineapple%' OR name ILIKE '%Piña%' OR name ILIKE '%Watermelon%' OR name ILIKE '%Sandía%' OR name ILIKE '%Figs%' OR name ILIKE '%Dates%' OR name ILIKE '%Pomegranate%');
UPDATE food_items SET image_url = '/foods/apple.jpg' WHERE image_url IS NULL AND (name ILIKE '%Apple%' OR name ILIKE '%Manzana%') AND name NOT ILIKE '%Pineapple%';
UPDATE food_items SET image_url = '/foods/orange.jpg' WHERE image_url IS NULL AND (name ILIKE '%Orange%' OR name ILIKE '%Naranja%' OR name ILIKE '%China /%') AND name NOT ILIKE '%Chicken%';
UPDATE food_items SET image_url = '/foods/berries.jpg' WHERE image_url IS NULL AND (name ILIKE '%berries%' OR name ILIKE '%berry%' OR name ILIKE '%Fresa%' OR name ILIKE '%Mora%' OR name ILIKE '%Frambuesa%' OR name ILIKE '%Arándano%' OR name ILIKE '%Raisins%' OR name ILIKE '%Pasas%' OR name ILIKE '%Cranberries%');
UPDATE food_items SET image_url = '/foods/avocado.jpg' WHERE image_url IS NULL AND (name ILIKE '%Avocado%' OR name ILIKE '%Aguacate%' OR name ILIKE '%Guacamole%');

-- Vegetables
UPDATE food_items SET image_url = '/foods/broccoli.jpg' WHERE image_url IS NULL AND (name ILIKE '%Broccoli%' OR name ILIKE '%Brussels%' OR name ILIKE '%Cauliflower%' OR name ILIKE '%Asparagus%' OR name ILIKE '%Espárrago%' OR name ILIKE '%Corn%' OR name ILIKE '%Maíz%' OR name ILIKE '%Green Bean%' OR name ILIKE '%Artichoke%' OR name ILIKE '%Eggplant%' OR name ILIKE '%Snap Peas%' OR name ILIKE '%Zucchini%');
UPDATE food_items SET image_url = '/foods/salad.jpg' WHERE image_url IS NULL AND (name ILIKE '%Salad%' OR name ILIKE '%Ensalada%' OR name ILIKE '%Spinach%' OR name ILIKE '%Espinaca%' OR name ILIKE '%Kale%' OR name ILIKE '%Greens%' OR name ILIKE '%Cabbage%' OR name ILIKE '%Repollo%' OR name ILIKE '%Celery%' OR name ILIKE '%Apio%');
UPDATE food_items SET image_url = '/foods/tomato.jpg' WHERE image_url IS NULL AND (name ILIKE '%Tomato%' OR name ILIKE '%Tomate%' OR name ILIKE '%Pepper%' OR name ILIKE '%Pimiento%' OR name ILIKE '%Cucumber%' OR name ILIKE '%Pepino%' OR name ILIKE '%Onion%' OR name ILIKE '%Cebolla%' OR name ILIKE '%Mushroom%' OR name ILIKE '%Champiñón%' OR name ILIKE '%Radish%' OR name ILIKE '%Beet%' OR name ILIKE '%Carrot%' OR name ILIKE '%Zanahoria%');

-- Legumes & Nuts
UPDATE food_items SET image_url = '/foods/beans.jpg' WHERE image_url IS NULL AND (name ILIKE '%Bean%' OR name ILIKE '%Habichuela%' OR name ILIKE '%Lentil%' OR name ILIKE '%Chickpea%' OR name ILIKE '%Garbanzo%' OR name ILIKE '%Gandules%' OR name ILIKE '%Edamame%' OR name ILIKE '%Tofu%' OR name ILIKE '%Tempeh%' OR name ILIKE '%Seitan%');
UPDATE food_items SET image_url = '/foods/nuts.jpg' WHERE image_url IS NULL AND (name ILIKE '%Almond%' OR name ILIKE '%Walnut%' OR name ILIKE '%Cashew%' OR name ILIKE '%Pistachio%' OR name ILIKE '%Pecan%' OR name ILIKE '%Macadamia%' OR name ILIKE '%Seeds%' OR name ILIKE '%Semilla%' OR name ILIKE '%Nuez%' OR name ILIKE '%Nueces%' OR name ILIKE '%Trail Mix%' OR name ILIKE '%Tahini%' OR name ILIKE '%Hemp%' OR name ILIKE '%Chia%' OR name ILIKE '%Flax%' OR name ILIKE '%Pine Nut%');
UPDATE food_items SET image_url = '/foods/peanut_butter.jpg' WHERE image_url IS NULL AND (name ILIKE '%Peanut Butter%' OR name ILIKE '%Almond Butter%' OR name ILIKE '%Mantequilla de Maní%' OR name ILIKE '%Nutella%');

-- Supplements & Oils
UPDATE food_items SET image_url = '/foods/protein_shake.jpg' WHERE image_url IS NULL AND (name ILIKE '%Protein%' OR name ILIKE '%Whey%' OR name ILIKE '%Casein%' OR name ILIKE '%Mass Gainer%' OR name ILIKE '%BCAA%' OR name ILIKE '%Creatine%' OR name ILIKE '%Muscle Milk%' OR name ILIKE '%Premier%');
UPDATE food_items SET image_url = '/foods/olive_oil.jpg' WHERE image_url IS NULL AND (name ILIKE '%Oil%' OR name ILIKE '%Aceite%' OR name ILIKE '%Cooking Spray%' OR name ILIKE '%Honey%' OR name ILIKE '%Miel%');

-- Coffee & Drinks
UPDATE food_items SET image_url = '/foods/coffee.jpg' WHERE image_url IS NULL AND (name ILIKE '%Coffee%' OR name ILIKE '%Latte%' OR name ILIKE '%Café%' OR name ILIKE '%Mocha%' OR name ILIKE '%Frappuccino%' OR name ILIKE '%Macchiato%' OR name ILIKE '%Cold Brew%' OR name ILIKE '%Chai%' OR name ILIKE '%Matcha%' OR name ILIKE '%Pike Place%');
UPDATE food_items SET image_url = '/foods/smoothie.jpg' WHERE image_url IS NULL AND (name ILIKE '%Smoothie%' OR name ILIKE '%Batida%' OR name ILIKE '%Shake%' OR name ILIKE '%Frosty%' OR name ILIKE '%McFlurry%' OR name ILIKE '%Juice%' OR name ILIKE '%Jugo%' OR name ILIKE '%Gatorade%' OR name ILIKE '%Powerade%' OR name ILIKE '%Monster%' OR name ILIKE '%Red Bull%' OR name ILIKE '%Celsius%' OR name ILIKE '%Body Armor%' OR name ILIKE '%Coca-Cola%' OR name ILIKE '%Diet Coke%' OR name ILIKE '%Malta%' OR name ILIKE '%Water%' OR name ILIKE '%Agua%' OR name ILIKE '%Medalla%' OR name ILIKE '%Coquito%' OR name ILIKE '%Piña Colada%' OR name ILIKE '%Morir Soñando%' OR name ILIKE '%Frosted Lemonade%');

-- Fast Food — Burgers
UPDATE food_items SET image_url = '/foods/burger.jpg' WHERE image_url IS NULL AND (name ILIKE '%Big Mac%' OR name ILIKE '%Whopper%' OR name ILIKE '%Burger%' OR name ILIKE '%Quarter Pounder%' OR name ILIKE '%McDouble%' OR name ILIKE '%Baconator%' OR name ILIKE '%Dave''s%' OR name ILIKE '%Hamburguesa%' OR name ILIKE '%Slider%' OR name ILIKE '%Chimichurri Burger%' OR name ILIKE '%Double-Double%' OR name ILIKE '%Impossible Whopper%' OR name ILIKE '%Hot Dog%');

-- Chicken items
UPDATE food_items SET image_url = '/foods/chicken_nuggets.jpg' WHERE image_url IS NULL AND (name ILIKE '%Nugget%' OR name ILIKE '%McNugget%' OR name ILIKE '%Tender%' OR name ILIKE '%Strip%' OR name ILIKE '%Chicken Fries%' OR name ILIKE '%Crisper%' OR name ILIKE '%Wing%' OR name ILIKE '%Alitas%' OR name ILIKE '%Pica Pollo%');

-- Sandwiches
UPDATE food_items SET image_url = '/foods/sandwich.jpg' WHERE image_url IS NULL AND (name ILIKE '%Sandwich%' OR name ILIKE '%Sándwich%' OR name ILIKE '%Wrap%' OR name ILIKE '%Sub %' OR name ILIKE '%Cubano%' OR name ILIKE '%Medianoche%' OR name ILIKE '%McChicken%' OR name ILIKE '%Filet-O-Fish%' OR name ILIKE '%McMuffin%' OR name ILIKE '%Arby%' OR name ILIKE '%Chicken Jr%' OR name ILIKE '%Grilled Cool%');

-- Fries
UPDATE food_items SET image_url = '/foods/fries.jpg' WHERE image_url IS NULL AND (name ILIKE '%Fries%' OR name ILIKE '%Papas Fritas%' OR name ILIKE '%Onion Ring%' OR name ILIKE '%Waffle Fries%' OR name ILIKE '%Cajun Fries%' OR name ILIKE '%Animal Style%' OR name ILIKE '%Yaroa%' OR name ILIKE '%Loaded Fries%');

-- Pizza
UPDATE food_items SET image_url = '/foods/pizza.jpg' WHERE image_url IS NULL AND (name ILIKE '%Pizza%' OR name ILIKE '%Breadstick%' OR name ILIKE '%Garlic Bread%' OR name ILIKE '%Garlic Knot%' OR name ILIKE '%Hot Pocket%');

-- Tacos & Mexican
UPDATE food_items SET image_url = '/foods/taco.jpg' WHERE image_url IS NULL AND (name ILIKE '%Taco%' OR name ILIKE '%Chalupa%' OR name ILIKE '%Gordita%' OR name ILIKE '%Nachos%' OR name ILIKE '%Doritos Locos%' OR name ILIKE '%Crunchwrap%' OR name ILIKE '%Mexican Pizza%');
UPDATE food_items SET image_url = '/foods/burrito.jpg' WHERE image_url IS NULL AND (name ILIKE '%Burrito%' OR name ILIKE '%Quesadilla%' OR name ILIKE '%Bowl%' OR name ILIKE '%TropiChop%' OR name ILIKE '%Chipotle%');

-- Sushi & Asian
UPDATE food_items SET image_url = '/foods/sushi.jpg' WHERE image_url IS NULL AND (name ILIKE '%Roll%' OR name ILIKE '%Sushi%' OR name ILIKE '%Satay%' OR name ILIKE '%Dumpling%' OR name ILIKE '%Spring Roll%' OR name ILIKE '%Egg Roll%');

-- International
UPDATE food_items SET image_url = '/foods/arroz_con_pollo.jpg' WHERE image_url IS NULL AND (name ILIKE '%Pad Thai%' OR name ILIKE '%Fried Rice%' OR name ILIKE '%Bibimbap%' OR name ILIKE '%Curry%' OR name ILIKE '%Tikka%' OR name ILIKE '%Ramen%' OR name ILIKE '%Pho%' OR name ILIKE '%Teriyaki%' OR name ILIKE '%General Tso%' OR name ILIKE '%Kung Pao%' OR name ILIKE '%Orange Chicken%' OR name ILIKE '%Beijing%' OR name ILIKE '%Asopao%' OR name ILIKE '%Sancocho%' OR name ILIKE '%Sopa%' OR name ILIKE '%Caldo%');

-- PR Frituras & Plantain
UPDATE food_items SET image_url = '/foods/plantain.jpg' WHERE image_url IS NULL AND (name ILIKE '%Tostones%' OR name ILIKE '%Amarillos%' OR name ILIKE '%Maduros%' OR name ILIKE '%Plantain%' OR name ILIKE '%Plátano%' OR name ILIKE '%Mangú%' OR name ILIKE '%Mofongo%' OR name ILIKE '%Trifongo%' OR name ILIKE '%Pionono%' OR name ILIKE '%Aranitas%' OR name ILIKE '%Tostón Relleno%' OR name ILIKE '%Pastelón%' OR name ILIKE '%Pasteles%' OR name ILIKE '%Alcapurria%' OR name ILIKE '%Bacalaíto%' OR name ILIKE '%Empanadilla%' OR name ILIKE '%Sorullito%' OR name ILIKE '%Relleno de Papa%' OR name ILIKE '%Papa Rellena%' OR name ILIKE '%Croqueta%' OR name ILIKE '%Empanada%' OR name ILIKE '%Pastelito%' OR name ILIKE '%Tamale%' OR name ILIKE '%Pupusa%' OR name ILIKE '%Arepa%' OR name ILIKE '%Samosa%' OR name ILIKE '%Falafel%' OR name ILIKE '%Gyro%' OR name ILIKE '%Shawarma%' OR name ILIKE '%Serenata%');

-- Desserts
UPDATE food_items SET image_url = '/foods/donut.jpg' WHERE image_url IS NULL AND (name ILIKE '%Donut%' OR name ILIKE '%Munchkin%' OR name ILIKE '%Cinnamon Roll%' OR name ILIKE '%Muffin%' OR name ILIKE '%Cake Pop%' OR name ILIKE '%Brownie%' OR name ILIKE '%Cake%' OR name ILIKE '%Bizcocho%' OR name ILIKE '%Brazo Gitano%' OR name ILIKE '%Quesito%' OR name ILIKE '%Pastelillo%' OR name ILIKE '%Pancake%' OR name ILIKE '%Panqueque%' OR name ILIKE '%Waffle%' OR name ILIKE '%French Toast%' OR name ILIKE '%Hotcakes%' OR name ILIKE '%Pie %' OR name ILIKE '%Cheesecake%' OR name ILIKE '%Tres Leches%' OR name ILIKE '%Majarete%');
UPDATE food_items SET image_url = '/foods/ice_cream.jpg' WHERE image_url IS NULL AND (name ILIKE '%Ice Cream%' OR name ILIKE '%Helado%' OR name ILIKE '%Frozen Yogurt%' OR name ILIKE '%Halo Top%' OR name ILIKE '%Ben & Jerry%' OR name ILIKE '%Tembleque%' OR name ILIKE '%Flan%' OR name ILIKE '%Limber%' OR name ILIKE '%Piragua%' OR name ILIKE '%Dulce de Lechoza%' OR name ILIKE '%Besitos de Coco%' OR name ILIKE '%Habichuela con Dulce%');
UPDATE food_items SET image_url = '/foods/cookie.jpg' WHERE image_url IS NULL AND (name ILIKE '%Cookie%' OR name ILIKE '%Galleta%' OR name ILIKE '%Oreo%' OR name ILIKE '%Chips Ahoy%' OR name ILIKE '%Mantecadito%' OR name ILIKE '%Polvorón%' OR name ILIKE '%Snickers%' OR name ILIKE '%Kit Kat%' OR name ILIKE '%Reese%' OR name ILIKE '%M&M%' OR name ILIKE '%Skittles%' OR name ILIKE '%Rice Krispies%' OR name ILIKE '%Pop-Tart%' OR name ILIKE '%Chocolate%');

-- Snacks
UPDATE food_items SET image_url = '/foods/fries.jpg' WHERE image_url IS NULL AND (name ILIKE '%Doritos%' OR name ILIKE '%Cheez-It%' OR name ILIKE '%Goldfish%' OR name ILIKE '%Pretzel%' OR name ILIKE '%Chips%' OR name ILIKE '%Popcorn%' OR name ILIKE '%Veggie Straw%' OR name ILIKE '%Cracker%' OR name ILIKE '%Rice Cake%' OR name ILIKE '%Jerky%' OR name ILIKE '%Cecina%' OR name ILIKE '%SkinnyPop%');

-- Frozen meals
UPDATE food_items SET image_url = '/foods/pasta.jpg' WHERE image_url IS NULL AND (name ILIKE '%Lean Cuisine%' OR name ILIKE '%Healthy Choice%' OR name ILIKE '%Amy''s%' OR name ILIKE '%Totino%' OR name ILIKE '%DiGiorno%' OR name ILIKE '%Pizza Roll%');

-- Condiments & sauces — use olive oil
UPDATE food_items SET image_url = '/foods/olive_oil.jpg' WHERE image_url IS NULL AND (name ILIKE '%Sauce%' OR name ILIKE '%Salsa%' OR name ILIKE '%Dressing%' OR name ILIKE '%Ketchup%' OR name ILIKE '%Mustard%' OR name ILIKE '%Mayo%' OR name ILIKE '%Sriracha%' OR name ILIKE '%Soy Sauce%' OR name ILIKE '%Hot Sauce%' OR name ILIKE '%BBQ%' OR name ILIKE '%Hummus%' OR name ILIKE '%Ranch%' OR name ILIKE '%Vinaigrette%' OR name ILIKE '%Syrup%' OR name ILIKE '%Sirope%' OR name ILIKE '%Jam%' OR name ILIKE '%Mermelada%' OR name ILIKE '%Teriyaki%');

-- Protein bars
UPDATE food_items SET image_url = '/foods/protein_shake.jpg' WHERE image_url IS NULL AND (name ILIKE '%Bar%' OR name ILIKE '%Quest%' OR name ILIKE '%RXBar%' OR name ILIKE '%ONE Bar%' OR name ILIKE '%Clif%' OR name ILIKE '%Kind%' OR name ILIKE '%Larabar%' OR name ILIKE '%Barra%');

-- Beyond/Impossible
UPDATE food_items SET image_url = '/foods/burger.jpg' WHERE image_url IS NULL AND (name ILIKE '%Beyond%' OR name ILIKE '%Impossible%');

-- Catch-all: anything still null
UPDATE food_items SET image_url = '/foods/salad.jpg' WHERE image_url IS NULL;
