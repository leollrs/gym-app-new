-- Migration 0064: Expand food database to ~1000 items
-- ~354 new foods across new fast food chains, international cuisines,
-- supplements, breakfast, proteins, drinks, snacks, produce, dairy, and more.

INSERT INTO food_items (name, brand, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) VALUES

-- ─────────────────────────────────────────────────────────────────────────────
-- KFC (10)
-- ─────────────────────────────────────────────────────────────────────────────
('KFC Original Recipe Chicken Breast', 'KFC', 1, 'piece', 390, 39, 11, 21, 0),
('KFC Extra Crispy Chicken Breast', 'KFC', 1, 'piece', 530, 37, 22, 33, 1),
('KFC Spicy Chicken Sandwich', 'KFC', 1, 'sandwich', 480, 27, 47, 19, 2),
('KFC Famous Bowl', 'KFC', 1, 'bowl', 710, 26, 86, 28, 6),
('KFC Mac & Cheese', 'KFC', 1, 'individual', 200, 7, 24, 9, 1),
('KFC Mashed Potatoes with Gravy', 'KFC', 1, 'serving', 160, 3, 27, 5, 2),
('KFC Coleslaw', 'KFC', 1, 'serving', 170, 1, 22, 9, 2),
('KFC Biscuit', 'KFC', 1, 'biscuit', 180, 4, 24, 8, 1),
('KFC Chicken Pot Pie', 'KFC', 1, 'pie', 790, 29, 69, 45, 4),
('KFC Popcorn Nuggets', 'KFC', 1, 'serving', 400, 20, 27, 24, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- Shake Shack (7)
-- ─────────────────────────────────────────────────────────────────────────────
('ShackBurger', 'Shake Shack', 1, 'burger', 530, 27, 40, 30, 2),
('SmokeShack', 'Shake Shack', 1, 'burger', 590, 31, 40, 34, 2),
('Chick''n Shack', 'Shake Shack', 1, 'sandwich', 590, 33, 52, 27, 3),
('Cheese Fries', 'Shake Shack', 1, 'serving', 490, 12, 53, 26, 4),
('Crinkle Cut Fries', 'Shake Shack', 1, 'serving', 420, 6, 56, 20, 4),
('Frozen Custard (Vanilla)', 'Shake Shack', 1, 'cup', 400, 8, 52, 18, 0),
('Shack Stack', 'Shake Shack', 1, 'burger', 720, 34, 50, 43, 3),

-- ─────────────────────────────────────────────────────────────────────────────
-- Wingstop (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Bone-In Wings (6 pc)', 'Wingstop', 6, 'pieces', 500, 38, 8, 35, 0),
('Boneless Wings (6 pc)', 'Wingstop', 6, 'pieces', 450, 30, 30, 22, 1),
('Seasoned Fries', 'Wingstop', 1, 'serving', 370, 5, 52, 16, 4),
('Lemon Pepper Wings (6 pc)', 'Wingstop', 6, 'pieces', 540, 38, 10, 38, 1),
('Mango Habanero Wings (6 pc)', 'Wingstop', 6, 'pieces', 510, 36, 18, 34, 1),
('Garlic Parmesan Wings (6 pc)', 'Wingstop', 6, 'pieces', 560, 37, 6, 43, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- Jack in the Box (7)
-- ─────────────────────────────────────────────────────────────────────────────
('Jumbo Jack', 'Jack in the Box', 1, 'burger', 600, 24, 51, 34, 3),
('Sourdough Jack', 'Jack in the Box', 1, 'burger', 710, 29, 53, 43, 3),
('Ultimate Cheeseburger', 'Jack in the Box', 1, 'burger', 830, 36, 53, 52, 3),
('Spicy Crispy Chicken Sandwich', 'Jack in the Box', 1, 'sandwich', 560, 25, 57, 25, 3),
('Egg Rolls (3 pc)', 'Jack in the Box', 3, 'pieces', 200, 7, 25, 8, 2),
('Tacos (2 pc)', 'Jack in the Box', 2, 'tacos', 340, 12, 32, 18, 4),
('Loaded Curly Fries', 'Jack in the Box', 1, 'serving', 590, 16, 58, 33, 5),

-- ─────────────────────────────────────────────────────────────────────────────
-- Panera Bread (9)
-- ─────────────────────────────────────────────────────────────────────────────
('Broccoli Cheddar Soup (Bread Bowl)', 'Panera Bread', 1, 'bowl', 800, 30, 113, 26, 7),
('Broccoli Cheddar Soup (Cup)', 'Panera Bread', 1, 'cup', 250, 9, 25, 13, 3),
('Chicken Noodle Soup', 'Panera Bread', 1, 'bowl', 130, 9, 18, 2, 1),
('Turkey Sandwich on Sourdough', 'Panera Bread', 1, 'sandwich', 560, 35, 65, 16, 4),
('Chicken Caesar Salad', 'Panera Bread', 1, 'salad', 430, 38, 17, 24, 3),
('Greek Salad', 'Panera Bread', 1, 'salad', 370, 9, 30, 25, 5),
('Cinnamon Crunch Bagel', 'Panera Bread', 1, 'bagel', 420, 10, 80, 8, 3),
('Chocolate Chip Cookie', 'Panera Bread', 1, 'cookie', 440, 5, 63, 19, 2),
('Bacon Egg & Cheese on Brioche', 'Panera Bread', 1, 'sandwich', 570, 27, 46, 30, 2),

-- ─────────────────────────────────────────────────────────────────────────────
-- Raising Cane's (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Box Combo', 'Raising Cane''s', 1, 'combo', 1000, 52, 90, 46, 4),
('3 Finger Combo', 'Raising Cane''s', 1, 'combo', 760, 39, 73, 34, 3),
('Caniac Combo', 'Raising Cane''s', 1, 'combo', 1270, 67, 116, 57, 6),
('Crinkle Fries', 'Raising Cane''s', 1, 'serving', 290, 4, 43, 12, 3),
('Texas Toast', 'Raising Cane''s', 1, 'slice', 160, 4, 21, 7, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- Dairy Queen (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Oreo Blizzard (Medium)', 'Dairy Queen', 1, 'cup', 690, 13, 105, 24, 1),
('Dilly Bar', 'Dairy Queen', 1, 'bar', 210, 3, 24, 12, 0),
('Chicken Strip Basket (4 pc)', 'Dairy Queen', 1, 'basket', 1020, 47, 99, 45, 5),
('Double Cheeseburger', 'Dairy Queen', 1, 'burger', 500, 30, 32, 28, 2),
('Soft Serve Cone (Medium)', 'Dairy Queen', 1, 'cone', 340, 7, 52, 11, 0),
('Peanut Butter Cookie Dough Blizzard (Medium)', 'Dairy Queen', 1, 'cup', 1000, 19, 141, 42, 2),

-- ─────────────────────────────────────────────────────────────────────────────
-- Jersey Mike's (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Original Italian Sub (Regular)', 'Jersey Mike''s', 1, 'sub', 750, 36, 78, 32, 4),
('Turkey & Provolone Sub (Regular)', 'Jersey Mike''s', 1, 'sub', 620, 40, 73, 18, 4),
('Club Sub (Regular)', 'Jersey Mike''s', 1, 'sub', 660, 45, 73, 20, 4),
('Philly Cheesesteak Sub (Regular)', 'Jersey Mike''s', 1, 'sub', 700, 42, 75, 26, 4),
('BLT Sub (Regular)', 'Jersey Mike''s', 1, 'sub', 550, 22, 67, 21, 4),

-- ─────────────────────────────────────────────────────────────────────────────
-- Jimmy John's (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Turkey Tom', 'Jimmy John''s', 1, 'sandwich', 500, 30, 62, 15, 3),
('The Vito', 'Jimmy John''s', 1, 'sandwich', 640, 30, 62, 28, 3),
('The Pepe', 'Jimmy John''s', 1, 'sandwich', 560, 34, 62, 19, 3),
('Slim 5 Tuna Salad', 'Jimmy John''s', 1, 'sandwich', 520, 24, 62, 18, 3),
('Beach Club', 'Jimmy John''s', 1, 'sandwich', 590, 35, 63, 22, 4),

-- ─────────────────────────────────────────────────────────────────────────────
-- Sonic (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Sonic Cheeseburger', 'Sonic', 1, 'burger', 620, 28, 46, 36, 2),
('Footlong Chili Cheese Coney', 'Sonic', 1, 'hot dog', 690, 27, 52, 43, 4),
('Tater Tots (Medium)', 'Sonic', 1, 'serving', 360, 4, 47, 18, 4),
('Corn Dog', 'Sonic', 1, 'corn dog', 200, 5, 22, 10, 1),
('Cherry Limeade (Medium)', 'Sonic', 1, 'drink', 240, 0, 63, 0, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- Whataburger (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Whataburger', 'Whataburger', 1, 'burger', 590, 25, 61, 26, 3),
('Double Meat Whataburger', 'Whataburger', 1, 'burger', 820, 44, 62, 42, 3),
('Spicy Chicken Sandwich', 'Whataburger', 1, 'sandwich', 530, 28, 55, 22, 3),
('Onion Rings (Medium)', 'Whataburger', 1, 'serving', 420, 6, 52, 21, 3),
('Apple Pie', 'Whataburger', 1, 'pie', 230, 2, 36, 9, 1),
('Chocolate Shake (Medium)', 'Whataburger', 1, 'shake', 700, 14, 103, 25, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- Zaxby's (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Signature Sandwich', 'Zaxby''s', 1, 'sandwich', 610, 32, 58, 27, 3),
('Chicken Fingerz Plate', 'Zaxby''s', 1, 'plate', 900, 48, 84, 38, 5),
('Wings & Things', 'Zaxby''s', 1, 'platter', 920, 55, 65, 46, 4),
('Zaxby''s Crinkle Fries', 'Zaxby''s', 1, 'serving', 380, 5, 52, 17, 4),
('House Zalad with Grilled Chicken', 'Zaxby''s', 1, 'salad', 430, 40, 26, 19, 5),

-- ─────────────────────────────────────────────────────────────────────────────
-- Culver's (5)
-- ─────────────────────────────────────────────────────────────────────────────
('ButterBurger (Single)', 'Culver''s', 1, 'burger', 410, 23, 37, 18, 2),
('Double ButterBurger with Cheese', 'Culver''s', 1, 'burger', 670, 39, 38, 39, 2),
('Wisconsin Cheese Curds', 'Culver''s', 1, 'serving', 570, 19, 40, 38, 1),
('Vanilla Fresh Frozen Custard', 'Culver''s', 1, 'scoop', 300, 6, 38, 14, 0),
('North Atlantic Cod Fish Sandwich', 'Culver''s', 1, 'sandwich', 560, 26, 56, 25, 3),

-- ─────────────────────────────────────────────────────────────────────────────
-- IHOP (8)
-- ─────────────────────────────────────────────────────────────────────────────
('Original Buttermilk Pancakes (3)', 'IHOP', 3, 'pancakes', 490, 11, 89, 11, 3),
('New York Cheesecake Pancakes', 'IHOP', 1, 'plate', 840, 16, 128, 31, 3),
('Stuffed French Toast', 'IHOP', 1, 'plate', 990, 20, 138, 43, 4),
('Bacon Omelette', 'IHOP', 1, 'omelette', 580, 35, 11, 45, 1),
('Belgian Waffle', 'IHOP', 1, 'waffle', 590, 11, 82, 24, 3),
('Harvest Grain ''N Nut Pancakes (3)', 'IHOP', 3, 'pancakes', 540, 16, 76, 21, 7),
('Big Steak Omelette', 'IHOP', 1, 'omelette', 1000, 56, 61, 59, 5),
('Chicken & Waffles', 'IHOP', 1, 'plate', 1050, 48, 91, 52, 4),

-- ─────────────────────────────────────────────────────────────────────────────
-- Denny's (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Grand Slam', 'Denny''s', 1, 'meal', 760, 36, 65, 39, 4),
('Moons Over My Hammy', 'Denny''s', 1, 'sandwich', 680, 39, 57, 31, 3),
('Pancakes (4)', 'Denny''s', 4, 'pancakes', 520, 13, 97, 11, 3),
('Country Fried Steak', 'Denny''s', 1, 'plate', 870, 32, 71, 51, 5),
('Scrambler', 'Denny''s', 1, 'plate', 680, 38, 44, 39, 4),
('Avocado Toast', 'Denny''s', 1, 'plate', 380, 12, 44, 18, 8),

-- ─────────────────────────────────────────────────────────────────────────────
-- Texas Roadhouse (6)
-- ─────────────────────────────────────────────────────────────────────────────
('6 oz Sirloin', 'Texas Roadhouse', 1, 'steak', 250, 35, 3, 11, 0),
('Baby Back Ribs (Half Rack)', 'Texas Roadhouse', 1, 'serving', 740, 55, 28, 46, 1),
('Fresh-Baked Dinner Rolls (2)', 'Texas Roadhouse', 2, 'rolls', 360, 10, 60, 10, 2),
('Fresh Seasoned Green Beans', 'Texas Roadhouse', 1, 'side', 80, 2, 10, 4, 3),
('Loaded Sweet Potato', 'Texas Roadhouse', 1, 'side', 570, 7, 107, 13, 8),
('Grilled Salmon', 'Texas Roadhouse', 1, 'fillet', 340, 44, 4, 17, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- Red Lobster (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Cheddar Bay Biscuit', 'Red Lobster', 1, 'biscuit', 150, 3, 16, 8, 0),
('Lobster Tail (8 oz)', 'Red Lobster', 1, 'tail', 230, 30, 0, 12, 0),
('Shrimp Scampi', 'Red Lobster', 1, 'plate', 500, 32, 34, 26, 2),
('Admiral''s Feast', 'Red Lobster', 1, 'plate', 1200, 55, 110, 58, 7),
('New England Clam Chowder', 'Red Lobster', 1, 'cup', 200, 8, 22, 9, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- Outback Steakhouse (4)
-- ─────────────────────────────────────────────────────────────────────────────
('6 oz Outback Special Sirloin', 'Outback Steakhouse', 1, 'steak', 320, 39, 4, 16, 0),
('Bloomin'' Onion', 'Outback Steakhouse', 1, 'appetizer', 1950, 22, 177, 123, 14),
('Grilled Salmon', 'Outback Steakhouse', 1, 'fillet', 460, 47, 12, 24, 1),
('Victoria''s Filet (6 oz)', 'Outback Steakhouse', 1, 'steak', 420, 44, 3, 26, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- Little Caesars (4)
-- ─────────────────────────────────────────────────────────────────────────────
('Hot-N-Ready Pepperoni Pizza Slice', 'Little Caesars', 1, 'slice', 280, 12, 31, 12, 2),
('Hot-N-Ready Cheese Pizza Slice', 'Little Caesars', 1, 'slice', 250, 11, 30, 9, 2),
('Crazy Bread', 'Little Caesars', 1, 'stick', 100, 3, 16, 3, 1),
('Deep Deep Dish Pepperoni Pizza Slice', 'Little Caesars', 1, 'slice', 360, 15, 36, 17, 2),

-- ─────────────────────────────────────────────────────────────────────────────
-- Checkers / Rally's (2)
-- ─────────────────────────────────────────────────────────────────────────────
('Big Buford Double Cheeseburger', 'Checkers', 1, 'burger', 700, 37, 46, 40, 3),
('Seasoned Fries (Medium)', 'Checkers', 1, 'serving', 400, 5, 54, 18, 4),

-- ─────────────────────────────────────────────────────────────────────────────
-- Casual Dining (8)
-- ─────────────────────────────────────────────────────────────────────────────
('Gourmet Cheeseburger', 'Red Robin', 1, 'burger', 760, 39, 64, 37, 3),
('Steak Fries', 'Red Robin', 1, 'serving', 440, 6, 67, 16, 5),
('Chicken Fried Chicken', 'Cracker Barrel', 1, 'plate', 720, 45, 56, 32, 3),
('Buttermilk Biscuit', 'Cracker Barrel', 1, 'biscuit', 160, 4, 24, 6, 1),
('Zuppa Toscana Soup', 'Olive Garden', 1, 'bowl', 220, 12, 18, 11, 1),
('Tiramisu', 'Olive Garden', 1, 'serving', 470, 6, 60, 23, 1),
('Classic Waffle', 'Waffle House', 1, 'waffle', 340, 7, 52, 12, 2),
('Double Cheeseburger', 'Cook Out', 1, 'burger', 690, 36, 46, 40, 3),

-- ─────────────────────────────────────────────────────────────────────────────
-- KOREAN (10)
-- ─────────────────────────────────────────────────────────────────────────────
('Korean Beef Bulgogi', NULL, 150, 'g', 280, 24, 12, 14, 1),
('Korean Galbi (Short Ribs)', NULL, 150, 'g', 380, 28, 6, 27, 0),
('Korean Samgyeopsal (Pork Belly)', NULL, 150, 'g', 410, 25, 0, 34, 0),
('Tteokbokki', NULL, 200, 'g', 300, 8, 54, 6, 2),
('Japchae', NULL, 200, 'g', 270, 9, 42, 7, 3),
('Korean Fried Chicken (4 pc)', NULL, 4, 'pieces', 450, 28, 24, 28, 1),
('Kimchi', NULL, 100, 'g', 35, 2, 6, 0.5, 2),
('Korean Bibim Cold Noodles', NULL, 300, 'g', 380, 12, 68, 7, 4),
('Sundubu Jjigae (Soft Tofu Stew)', NULL, 300, 'g', 200, 14, 10, 11, 2),
('Doenjang Jjigae', NULL, 300, 'g', 160, 10, 12, 7, 3),

-- ─────────────────────────────────────────────────────────────────────────────
-- FILIPINO (8)
-- ─────────────────────────────────────────────────────────────────────────────
('Chicken Adobo (Filipino)', NULL, 200, 'g', 360, 32, 5, 23, 1),
('Pork Sinigang', NULL, 400, 'g', 320, 28, 18, 14, 4),
('Kare-Kare', NULL, 300, 'g', 420, 28, 18, 27, 4),
('Lechon Kawali (Crispy Pork Belly)', NULL, 150, 'g', 520, 26, 8, 44, 0),
('Pancit Bihon', NULL, 250, 'g', 310, 16, 48, 5, 3),
('Lumpia Shanghai (6 pc)', NULL, 6, 'pieces', 270, 14, 22, 14, 2),
('Sinangag (Filipino Garlic Rice)', NULL, 200, 'g', 270, 5, 52, 5, 1),
('Halo-Halo', NULL, 1, 'cup', 340, 5, 68, 7, 2),

-- ─────────────────────────────────────────────────────────────────────────────
-- BRAZILIAN (7)
-- ─────────────────────────────────────────────────────────────────────────────
('Açaí Bowl', NULL, 300, 'g', 380, 8, 56, 14, 8),
('Pão de Queijo (3 pc)', NULL, 3, 'pieces', 250, 7, 36, 9, 1),
('Coxinha', NULL, 1, 'piece', 290, 14, 30, 13, 2),
('Churrasco Picanha', NULL, 200, 'g', 440, 42, 0, 30, 0),
('Feijoada', NULL, 350, 'g', 500, 30, 42, 22, 10),
('Farofa', NULL, 60, 'g', 230, 4, 36, 8, 3),
('Brigadeiro (2 pc)', NULL, 2, 'pieces', 160, 2, 28, 5, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- MEXICAN HOME COOKING (8)
-- ─────────────────────────────────────────────────────────────────────────────
('Birria Tacos (3)', NULL, 3, 'tacos', 580, 36, 52, 22, 4),
('Enchiladas Rojas (3)', NULL, 3, 'enchiladas', 520, 28, 52, 22, 6),
('Pozole Rojo', NULL, 400, 'g', 340, 26, 38, 8, 6),
('Chilaquiles Rojos', NULL, 300, 'g', 420, 16, 54, 17, 5),
('Elote (Mexican Street Corn)', NULL, 1, 'ear', 280, 5, 38, 13, 4),
('Carne Asada Plate', NULL, 1, 'plate', 680, 48, 52, 26, 6),
('Tamale (Pork, Red Chile)', NULL, 1, 'tamale', 285, 12, 36, 11, 4),
('Menudo', NULL, 400, 'g', 200, 20, 14, 6, 2),

-- ─────────────────────────────────────────────────────────────────────────────
-- ETHIOPIAN (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Injera', NULL, 100, 'g', 170, 5, 34, 1, 2),
('Doro Wat', NULL, 250, 'g', 320, 28, 12, 18, 3),
('Ethiopian Tibs', NULL, 200, 'g', 310, 30, 8, 18, 2),
('Misir (Red Lentil Stew)', NULL, 200, 'g', 200, 10, 30, 5, 8),
('Ethiopian Combination Platter', NULL, 1, 'platter', 750, 32, 82, 30, 12),

-- ─────────────────────────────────────────────────────────────────────────────
-- PERUVIAN (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Ceviche Peruano', NULL, 250, 'g', 180, 22, 14, 4, 2),
('Lomo Saltado', NULL, 350, 'g', 520, 32, 42, 22, 5),
('Ají de Gallina', NULL, 300, 'g', 420, 28, 28, 20, 3),
('Causa Limeña', NULL, 200, 'g', 290, 10, 42, 10, 3),
('Anticuchos (Beef Heart Skewers, 3)', NULL, 3, 'skewers', 250, 28, 6, 13, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- COLOMBIAN (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Bandeja Paisa', NULL, 1, 'plate', 1100, 62, 94, 46, 18),
('Arepa Colombiana', NULL, 1, 'arepa', 200, 5, 38, 4, 2),
('Sancocho Colombiano', NULL, 400, 'g', 320, 24, 32, 10, 5),
('Changua (Colombian Milk Soup)', NULL, 300, 'g', 180, 12, 14, 8, 1),
('Ajiaco Colombiano', NULL, 400, 'g', 300, 22, 34, 8, 5),
('Sobrebarriga', NULL, 200, 'g', 320, 34, 8, 17, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- VENEZUELAN (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Pabellón Criollo', NULL, 1, 'plate', 600, 32, 74, 18, 10),
('Cachapas', NULL, 2, 'cachapas', 380, 10, 62, 12, 4),
('Hallacas', NULL, 1, 'hallaca', 350, 14, 46, 12, 4),
('Caraotas Negras', NULL, 200, 'g', 200, 10, 34, 2, 8),
('Tequeños (4 pc)', NULL, 4, 'pieces', 320, 10, 36, 16, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- TURKISH / GREEK (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Döner Kebab', NULL, 1, 'wrap', 580, 32, 58, 22, 4),
('Lahmacun', NULL, 1, 'piece', 340, 16, 46, 10, 3),
('Menemen (Turkish Egg Dish)', NULL, 250, 'g', 280, 16, 12, 18, 3),
('Spanakopita', NULL, 1, 'piece', 260, 8, 22, 16, 2),
('Moussaka', NULL, 350, 'g', 420, 22, 30, 24, 4),
('Baklava (2 pieces)', NULL, 2, 'pieces', 320, 4, 42, 16, 2),

-- ─────────────────────────────────────────────────────────────────────────────
-- THAI EXTRA (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Massaman Curry', NULL, 350, 'g', 450, 26, 36, 22, 4),
('Som Tam (Green Papaya Salad)', NULL, 200, 'g', 130, 4, 22, 4, 4),
('Khao Man Gai', NULL, 1, 'plate', 520, 32, 62, 14, 2),
('Mango Sticky Rice', NULL, 1, 'serving', 360, 5, 72, 8, 3),
('Tom Kha Gai', NULL, 300, 'g', 250, 18, 10, 16, 2),

-- ─────────────────────────────────────────────────────────────────────────────
-- VIETNAMESE EXTRA (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Bún Bò Huế', NULL, 1, 'bowl', 480, 28, 58, 14, 3),
('Bánh Mì Sandwich', NULL, 1, 'sandwich', 440, 24, 54, 14, 3),
('Cơm Tấm (Broken Rice with Grilled Pork)', NULL, 1, 'plate', 580, 32, 66, 18, 3),
('Bún Chả', NULL, 1, 'bowl', 420, 26, 46, 14, 3),
('Chè Ba Màu', NULL, 1, 'cup', 260, 5, 52, 5, 4),

-- ─────────────────────────────────────────────────────────────────────────────
-- INDIAN EXTRA (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Chicken Biryani', NULL, 350, 'g', 520, 32, 62, 16, 3),
('Dal Makhani', NULL, 250, 'g', 280, 12, 32, 12, 8),
('Chana Masala', NULL, 250, 'g', 260, 12, 38, 7, 9),
('Palak Paneer', NULL, 250, 'g', 290, 12, 14, 21, 4),
('Garlic Naan', NULL, 1, 'piece', 200, 6, 34, 5, 2),
('Samosa Chaat', NULL, 1, 'serving', 380, 10, 54, 14, 6),

-- ─────────────────────────────────────────────────────────────────────────────
-- JAPANESE EXTRA (4)
-- ─────────────────────────────────────────────────────────────────────────────
('Tonkatsu (Breaded Pork Cutlet)', NULL, 200, 'g', 460, 30, 30, 24, 2),
('Oyakodon', NULL, 1, 'bowl', 520, 28, 68, 14, 2),
('Takoyaki (6 pc)', NULL, 6, 'pieces', 300, 12, 38, 12, 2),
('Mochi Ice Cream (3 pc)', NULL, 3, 'pieces', 300, 4, 60, 7, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- SUPPLEMENTS (10)
-- ─────────────────────────────────────────────────────────────────────────────
('Pre-Workout Powder', NULL, 1, 'scoop', 20, 0, 4, 0, 0),
('Fish Oil Softgel', NULL, 1, 'softgel', 15, 0, 0, 1.5, 0),
('Collagen Peptides', NULL, 10, 'g', 38, 9, 0, 0, 0),
('Vitamin D3 (2000 IU)', NULL, 1, 'capsule', 5, 0, 0, 0.5, 0),
('L-Glutamine Powder', NULL, 5, 'g', 20, 5, 0, 0, 0),
('ZMA Supplement', NULL, 3, 'capsules', 15, 0, 1, 0, 0),
('Magnesium Glycinate', NULL, 2, 'capsules', 10, 0, 1, 0, 0),
('Electrolyte Powder', NULL, 1, 'packet', 25, 0, 6, 0, 0),
('Omega-3 Fish Oil (1000mg)', NULL, 1, 'softgel', 15, 0, 0, 1.5, 0),
('Ashwagandha (600mg)', NULL, 1, 'capsule', 5, 0, 1, 0, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- BREAKFAST EXTRAS (10)
-- ─────────────────────────────────────────────────────────────────────────────
('Eggs Benedict', NULL, 1, 'plate', 620, 28, 38, 40, 2),
('Açaí Bowl', NULL, 1, 'bowl', 380, 8, 56, 14, 8),
('Berry Smoothie Bowl', NULL, 1, 'bowl', 340, 10, 62, 7, 8),
('Quiche Lorraine (1 slice)', NULL, 1, 'slice', 440, 16, 26, 30, 1),
('Crepes Plain (2)', NULL, 2, 'crepes', 280, 9, 40, 9, 1),
('Granola Bowl with Milk', NULL, 1, 'bowl', 380, 12, 62, 10, 5),
('Biscuits and Gravy', NULL, 1, 'plate', 550, 16, 58, 28, 2),
('Bagel with Lox & Cream Cheese', NULL, 1, 'bagel', 470, 22, 54, 18, 3),
('Shakshuka', NULL, 1, 'serving', 300, 18, 20, 16, 4),
('Breakfast Quesadilla', NULL, 1, 'quesadilla', 480, 24, 42, 24, 3),

-- ─────────────────────────────────────────────────────────────────────────────
-- MORE PROTEINS (10)
-- ─────────────────────────────────────────────────────────────────────────────
('Duck Breast (roasted)', NULL, 150, 'g', 320, 34, 0, 20, 0),
('Goat Meat (stewed)', NULL, 150, 'g', 230, 28, 4, 11, 1),
('Rabbit (roasted)', NULL, 150, 'g', 270, 34, 0, 14, 0),
('Swordfish Steak (grilled)', NULL, 150, 'g', 250, 34, 0, 12, 0),
('Rainbow Trout (baked)', NULL, 150, 'g', 230, 30, 0, 12, 0),
('Atlantic Mackerel (baked)', NULL, 150, 'g', 280, 28, 0, 18, 0),
('Pan-Seared Scallops', NULL, 150, 'g', 190, 26, 8, 6, 0),
('Raw Oysters (6)', NULL, 6, 'oysters', 80, 8, 6, 2, 0),
('Steamed Clams', NULL, 150, 'g', 170, 22, 10, 4, 0),
('Steamed Mussels', NULL, 150, 'g', 170, 20, 8, 4, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- DRINKS (14)
-- ─────────────────────────────────────────────────────────────────────────────
('Sprite (12 oz can)', 'Sprite', 1, 'can', 140, 0, 38, 0, 0),
('Sweet Iced Tea (16 oz)', NULL, 1, 'glass', 130, 0, 34, 0, 0),
('Unsweetened Iced Tea (16 oz)', NULL, 1, 'glass', 5, 0, 0, 0, 0),
('Prime Hydration Drink', 'Prime', 1, 'bottle', 25, 2, 5, 0, 0),
('Coconut Water', 'Vita Coco', 330, 'ml', 60, 0, 15, 0, 0),
('Chocolate Milk (8 oz)', NULL, 1, 'glass', 190, 8, 30, 5, 1),
('Heineken Beer (12 oz)', 'Heineken', 1, 'bottle', 142, 1, 11, 0, 0),
('Corona Beer (12 oz)', 'Corona', 1, 'bottle', 148, 1, 14, 0, 0),
('Red Wine (5 oz glass)', NULL, 1, 'glass', 125, 0, 4, 0, 0),
('White Wine (5 oz glass)', NULL, 1, 'glass', 121, 0, 4, 0, 0),
('Tequila Shot (1.5 oz)', NULL, 1, 'shot', 97, 0, 0, 0, 0),
('Vodka Shot (1.5 oz)', NULL, 1, 'shot', 97, 0, 0, 0, 0),
('Rum and Coke', NULL, 1, 'glass', 210, 0, 24, 0, 0),
('White Claw Hard Seltzer', 'White Claw', 1, 'can', 100, 0, 2, 0, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- SNACKS (12)
-- ─────────────────────────────────────────────────────────────────────────────
('Protein Chips (Ranch)', 'Quest', 32, 'g', 140, 18, 6, 5, 1),
('PopCorners White Cheddar', 'PopCorners', 28, 'g', 120, 2, 20, 4, 1),
('Nature Valley Crunchy Bar', 'Nature Valley', 1, 'bar', 190, 4, 28, 7, 2),
('Nutri-Grain Strawberry Bar', 'Nutri-Grain', 1, 'bar', 120, 2, 24, 3, 1),
('Pirate''s Booty White Cheddar', 'Pirate''s Booty', 28, 'g', 130, 2, 19, 5, 0),
('Gummy Bears', NULL, 30, 'g', 100, 2, 24, 0, 0),
('Sour Patch Kids', NULL, 30, 'g', 110, 0, 28, 0, 0),
('Swedish Fish', NULL, 30, 'g', 100, 0, 25, 0, 0),
('Starburst Original', NULL, 40, 'g', 160, 0, 34, 3, 0),
('Haribo Gold-Bears', 'Haribo', 30, 'g', 100, 2, 23, 0, 0),
('Hi-Chew Strawberry', 'Hi-Chew', 32, 'g', 130, 0, 28, 2, 0),
('Takis Fuego', NULL, 28, 'g', 140, 2, 18, 7, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- VEGETABLES (12)
-- ─────────────────────────────────────────────────────────────────────────────
('Bok Choy (cooked)', NULL, 100, 'g', 20, 2, 3, 0.3, 2),
('Arugula (raw)', NULL, 100, 'g', 25, 3, 4, 0.7, 2),
('Butternut Squash (roasted)', NULL, 150, 'g', 82, 2, 22, 0.2, 3),
('Acorn Squash (roasted)', NULL, 150, 'g', 80, 2, 22, 0.1, 4),
('Nopales / Cactus Paddles (grilled)', NULL, 100, 'g', 25, 2, 5, 0.1, 3),
('Jicama (raw)', NULL, 100, 'g', 38, 1, 9, 0.1, 5),
('Swiss Chard (cooked)', NULL, 100, 'g', 35, 3, 7, 0.1, 4),
('Watercress (raw)', NULL, 100, 'g', 11, 2, 1, 0.1, 0.5),
('Turnip (cooked)', NULL, 100, 'g', 35, 1, 8, 0.1, 2),
('Parsnip (roasted)', NULL, 100, 'g', 75, 1, 18, 0.3, 5),
('Leek (cooked)', NULL, 100, 'g', 54, 1, 13, 0.3, 2),
('Fennel (raw)', NULL, 100, 'g', 31, 1, 7, 0.2, 3),

-- ─────────────────────────────────────────────────────────────────────────────
-- FRUITS (12)
-- ─────────────────────────────────────────────────────────────────────────────
('Dragon Fruit', NULL, 150, 'g', 75, 1.5, 17, 0.4, 3),
('Papaya (fresh)', NULL, 150, 'g', 65, 0.7, 16, 0.4, 2),
('Guava (fresh)', NULL, 100, 'g', 68, 2.6, 14, 1, 5),
('Passion Fruit', NULL, 100, 'g', 97, 2.2, 23, 0.7, 10),
('Lychee (fresh)', NULL, 100, 'g', 66, 0.8, 17, 0.4, 1),
('Star Fruit / Carambola', NULL, 100, 'g', 31, 1, 7, 0.3, 3),
('Jackfruit (fresh)', NULL, 150, 'g', 113, 2, 29, 0.4, 2),
('Persimmon (fresh)', NULL, 100, 'g', 81, 0.7, 21, 0.4, 4),
('Kumquat', NULL, 100, 'g', 71, 2, 16, 1, 6),
('Blood Orange', NULL, 130, 'g', 62, 1, 15, 0.2, 3),
('Tamarind', NULL, 50, 'g', 115, 1.4, 30, 0.3, 1),
('Longan (fresh)', NULL, 100, 'g', 60, 1.3, 15, 0.1, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- DAIRY (10)
-- ─────────────────────────────────────────────────────────────────────────────
('Sour Cream (full fat)', NULL, 30, 'g', 60, 1, 1.5, 5.5, 0),
('Heavy Whipping Cream', NULL, 15, 'ml', 51, 0.4, 0.4, 5.4, 0),
('Half & Half', NULL, 30, 'ml', 39, 0.9, 1.3, 3.4, 0),
('Kefir (plain)', NULL, 240, 'ml', 150, 9, 12, 5, 0),
('Brie Cheese', NULL, 30, 'g', 100, 6, 0.1, 8.4, 0),
('Blue Cheese (crumbled)', NULL, 30, 'g', 100, 6, 0.7, 8, 0),
('Gouda Cheese', NULL, 30, 'g', 101, 7, 0.6, 8, 0),
('Feta Cheese (crumbled)', NULL, 30, 'g', 80, 4, 1.2, 6.5, 0),
('Ricotta Cheese', NULL, 60, 'g', 100, 7, 3.5, 6.5, 0),
('Mascarpone Cheese', NULL, 30, 'g', 120, 2, 1, 12, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- CEREALS / GRAINS (10)
-- ─────────────────────────────────────────────────────────────────────────────
('Granola (plain)', NULL, 60, 'g', 270, 6, 40, 9, 4),
('Grape Nuts Cereal', 'Post', 58, 'g', 200, 6, 48, 1, 7),
('Kashi GO Cereal', 'Kashi', 55, 'g', 180, 9, 38, 4, 8),
('Cap''n Crunch', 'Cap''n Crunch', 40, 'g', 150, 2, 34, 2, 1),
('Cocoa Puffs', 'General Mills', 36, 'g', 140, 2, 30, 2, 1),
('Polenta (cooked)', NULL, 200, 'g', 130, 3, 28, 0.6, 1),
('Grits (cooked)', NULL, 240, 'g', 140, 3, 31, 0.5, 1),
('Millet (cooked)', NULL, 200, 'g', 174, 5, 36, 1.5, 2),
('Udon Noodles (cooked)', NULL, 200, 'g', 210, 7, 43, 1, 2),
('Soba Noodles (cooked)', NULL, 200, 'g', 190, 9, 38, 0.5, 3),

-- ─────────────────────────────────────────────────────────────────────────────
-- PROTEIN BARS / SHAKES (8)
-- ─────────────────────────────────────────────────────────────────────────────
('Barebells Chocolate Dough Bar', 'Barebells', 55, 'g', 196, 20, 20, 5, 1),
('Grenade Carb Killa Bar', 'Grenade', 60, 'g', 208, 23, 18, 5, 7),
('Built Bar Chocolate', 'Built Bar', 57, 'g', 170, 17, 22, 4, 5),
('Ghost Protein Bar', 'Ghost', 60, 'g', 200, 20, 22, 6, 5),
('Core Power Elite Shake (Chocolate)', 'Core Power', 355, 'ml', 230, 42, 7, 5, 0),
('BSN Syntha-6 Protein Shake', 'BSN', 44, 'g', 200, 22, 15, 6, 5),
('Orgain Plant Protein Shake', 'Orgain', 330, 'ml', 180, 16, 25, 5, 2),
('Vega Sport Premium Protein', 'Vega', 43, 'g', 160, 30, 5, 3, 2),

-- ─────────────────────────────────────────────────────────────────────────────
-- CONDIMENTS / SAUCES (8)
-- ─────────────────────────────────────────────────────────────────────────────
('Worcestershire Sauce', NULL, 5, 'ml', 5, 0, 1.4, 0, 0),
('Fish Sauce', NULL, 5, 'ml', 5, 0.8, 0.5, 0, 0),
('Oyster Sauce', NULL, 15, 'g', 30, 0.4, 7, 0.1, 0),
('Hoisin Sauce', NULL, 15, 'g', 35, 0.7, 7, 0.5, 0.4),
('Miso Paste (white)', NULL, 15, 'g', 30, 2, 4.5, 0.6, 0.5),
('Gochujang (Korean Chili Paste)', NULL, 15, 'g', 45, 1, 9, 0.5, 0.5),
('Chimichurri Sauce', NULL, 30, 'g', 80, 0.5, 1.5, 8, 0.5),
('Red Curry Paste', NULL, 15, 'g', 30, 1, 4, 1, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- MISC GRAINS / BREADS (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Rice Noodles (cooked)', NULL, 200, 'g', 192, 2.8, 44, 0.4, 1),
('Egg Noodles (cooked)', NULL, 200, 'g', 220, 8, 40, 3, 2),
('Cream of Rice', NULL, 230, 'g', 130, 3, 29, 0, 0),
('Sourdough Bread', NULL, 1, 'slice', 90, 4, 18, 0.5, 1),
('Cornbread', NULL, 60, 'g', 190, 3, 28, 8, 1),
('Focaccia', NULL, 60, 'g', 170, 4, 24, 7, 1),

-- ─────────────────────────────────────────────────────────────────────────────
-- SANDWICHES / MEALS (6)
-- ─────────────────────────────────────────────────────────────────────────────
('Grilled Cheese Sandwich', NULL, 1, 'sandwich', 400, 14, 36, 22, 2),
('BLT Sandwich', NULL, 1, 'sandwich', 440, 18, 40, 22, 3),
('Club Sandwich', NULL, 1, 'sandwich', 580, 34, 52, 24, 4),
('Philly Cheesesteak Sandwich', NULL, 1, 'sandwich', 640, 36, 54, 28, 3),
('French Dip Sandwich', NULL, 1, 'sandwich', 540, 38, 46, 18, 2),
('Grilled Veggie Wrap', NULL, 1, 'wrap', 380, 12, 52, 14, 6),

-- ─────────────────────────────────────────────────────────────────────────────
-- SOUPS (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Lentil Soup', NULL, 350, 'g', 230, 12, 38, 3, 10),
('Minestrone Soup', NULL, 350, 'g', 180, 8, 30, 4, 6),
('New England Clam Chowder', NULL, 350, 'g', 320, 12, 28, 18, 2),
('French Onion Soup', NULL, 350, 'g', 340, 14, 38, 14, 3),
('Tomato Bisque', NULL, 350, 'g', 240, 4, 28, 12, 3),

-- ─────────────────────────────────────────────────────────────────────────────
-- PACKAGED SNACKS (5)
-- ─────────────────────────────────────────────────────────────────────────────
('Lay''s Classic Chips', 'Lay''s', 28, 'g', 160, 2, 15, 10, 1),
('Pringles Original', 'Pringles', 28, 'g', 150, 1, 16, 9, 0),
('Ritz Crackers (5)', 'Ritz', 5, 'crackers', 80, 1, 10, 4, 0),
('Wheat Thins (handful)', 'Wheat Thins', 29, 'g', 140, 2, 22, 5, 1),
('Babybel Mini Cheese', 'Babybel', 21, 'g', 70, 5, 0, 5, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- HEALTH DRINKS (4)
-- ─────────────────────────────────────────────────────────────────────────────
('Ginger Lemon Kombucha', NULL, 355, 'ml', 60, 0, 14, 0, 0),
('Fresh Beet Juice', NULL, 240, 'ml', 110, 2, 26, 0, 1),
('Fresh Celery Juice', NULL, 240, 'ml', 40, 2, 8, 0, 1),
('Golden Milk Turmeric Latte', NULL, 240, 'ml', 120, 3, 18, 5, 0),

-- ─────────────────────────────────────────────────────────────────────────────
-- DESSERTS EXTRA (7)
-- ─────────────────────────────────────────────────────────────────────────────
('Tiramisu (1 slice)', NULL, 1, 'slice', 440, 7, 50, 22, 1),
('Gelato (1 scoop)', NULL, 100, 'g', 200, 4, 30, 8, 0),
('Churros (3)', NULL, 3, 'churros', 360, 5, 52, 16, 2),
('Beignets (3)', NULL, 3, 'pieces', 350, 5, 50, 15, 1),
('Funnel Cake', NULL, 1, 'serving', 440, 7, 58, 20, 2),
('Large Soft Pretzel', NULL, 1, 'pretzel', 390, 10, 80, 3, 3),
('Strawberry Cheesecake (1 slice)', NULL, 1, 'slice', 480, 8, 58, 24, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE image_url for all new foods
-- ─────────────────────────────────────────────────────────────────────────────

-- KFC
UPDATE food_items SET image_url = '/foods/kfc_original_chicken_breast.png' WHERE name = 'KFC Original Recipe Chicken Breast';
UPDATE food_items SET image_url = '/foods/kfc_extra_crispy_breast.png' WHERE name = 'KFC Extra Crispy Chicken Breast';
UPDATE food_items SET image_url = '/foods/kfc_spicy_chicken_sandwich.png' WHERE name = 'KFC Spicy Chicken Sandwich';
UPDATE food_items SET image_url = '/foods/kfc_famous_bowl.png' WHERE name = 'KFC Famous Bowl';
UPDATE food_items SET image_url = '/foods/kfc_mac_cheese.png' WHERE name = 'KFC Mac & Cheese';
UPDATE food_items SET image_url = '/foods/kfc_mashed_potatoes_gravy.png' WHERE name = 'KFC Mashed Potatoes with Gravy';
UPDATE food_items SET image_url = '/foods/kfc_coleslaw.png' WHERE name = 'KFC Coleslaw';
UPDATE food_items SET image_url = '/foods/kfc_biscuit.png' WHERE name = 'KFC Biscuit';
UPDATE food_items SET image_url = '/foods/kfc_chicken_pot_pie.png' WHERE name = 'KFC Chicken Pot Pie';
UPDATE food_items SET image_url = '/foods/kfc_popcorn_nuggets.png' WHERE name = 'KFC Popcorn Nuggets';

-- Shake Shack
UPDATE food_items SET image_url = '/foods/shake_shack_shackburger.png' WHERE name = 'ShackBurger';
UPDATE food_items SET image_url = '/foods/shake_shack_smokestack.png' WHERE name = 'SmokeShack';
UPDATE food_items SET image_url = '/foods/shake_shack_chick_n_shack.png' WHERE name = 'Chick''n Shack';
UPDATE food_items SET image_url = '/foods/shake_shack_cheese_fries.png' WHERE name = 'Cheese Fries' AND brand = 'Shake Shack';
UPDATE food_items SET image_url = '/foods/shake_shack_crinkle_fries.png' WHERE name = 'Crinkle Cut Fries' AND brand = 'Shake Shack';
UPDATE food_items SET image_url = '/foods/shake_shack_frozen_custard.png' WHERE name = 'Frozen Custard (Vanilla)';
UPDATE food_items SET image_url = '/foods/shake_shack_shack_stack.png' WHERE name = 'Shack Stack';

-- Wingstop
UPDATE food_items SET image_url = '/foods/wingstop_bone_in_wings.png' WHERE name = 'Bone-In Wings (6 pc)';
UPDATE food_items SET image_url = '/foods/wingstop_boneless_wings.png' WHERE name = 'Boneless Wings (6 pc)';
UPDATE food_items SET image_url = '/foods/wingstop_seasoned_fries.png' WHERE name = 'Seasoned Fries' AND brand = 'Wingstop';
UPDATE food_items SET image_url = '/foods/wingstop_lemon_pepper_wings.png' WHERE name = 'Lemon Pepper Wings (6 pc)';
UPDATE food_items SET image_url = '/foods/wingstop_mango_habanero_wings.png' WHERE name = 'Mango Habanero Wings (6 pc)';
UPDATE food_items SET image_url = '/foods/wingstop_garlic_parmesan_wings.png' WHERE name = 'Garlic Parmesan Wings (6 pc)';

-- Jack in the Box
UPDATE food_items SET image_url = '/foods/jbox_jumbo_jack.png' WHERE name = 'Jumbo Jack';
UPDATE food_items SET image_url = '/foods/jbox_sourdough_jack.png' WHERE name = 'Sourdough Jack';
UPDATE food_items SET image_url = '/foods/jbox_ultimate_cheeseburger.png' WHERE name = 'Ultimate Cheeseburger';
UPDATE food_items SET image_url = '/foods/jbox_spicy_crispy_chicken.png' WHERE name = 'Spicy Crispy Chicken Sandwich' AND brand = 'Jack in the Box';
UPDATE food_items SET image_url = '/foods/jbox_egg_rolls.png' WHERE name = 'Egg Rolls (3 pc)';
UPDATE food_items SET image_url = '/foods/jbox_tacos.png' WHERE name = 'Tacos (2 pc)';
UPDATE food_items SET image_url = '/foods/jbox_loaded_curly_fries.png' WHERE name = 'Loaded Curly Fries';

-- Panera Bread
UPDATE food_items SET image_url = '/foods/panera_broccoli_cheddar_bread_bowl.png' WHERE name = 'Broccoli Cheddar Soup (Bread Bowl)';
UPDATE food_items SET image_url = '/foods/panera_broccoli_cheddar_cup.png' WHERE name = 'Broccoli Cheddar Soup (Cup)';
UPDATE food_items SET image_url = '/foods/panera_chicken_noodle_soup.png' WHERE name = 'Chicken Noodle Soup' AND brand = 'Panera Bread';
UPDATE food_items SET image_url = '/foods/panera_turkey_sourdough.png' WHERE name = 'Turkey Sandwich on Sourdough';
UPDATE food_items SET image_url = '/foods/panera_chicken_caesar_salad.png' WHERE name = 'Chicken Caesar Salad' AND brand = 'Panera Bread';
UPDATE food_items SET image_url = '/foods/panera_greek_salad.png' WHERE name = 'Greek Salad' AND brand = 'Panera Bread';
UPDATE food_items SET image_url = '/foods/panera_cinnamon_crunch_bagel.png' WHERE name = 'Cinnamon Crunch Bagel';
UPDATE food_items SET image_url = '/foods/panera_chocolate_chip_cookie.png' WHERE name = 'Chocolate Chip Cookie' AND brand = 'Panera Bread';
UPDATE food_items SET image_url = '/foods/panera_bacon_egg_cheese.png' WHERE name = 'Bacon Egg & Cheese on Brioche';

-- Raising Cane's
UPDATE food_items SET image_url = '/foods/canes_box_combo.png' WHERE name = 'Box Combo';
UPDATE food_items SET image_url = '/foods/canes_3_finger_combo.png' WHERE name = '3 Finger Combo';
UPDATE food_items SET image_url = '/foods/canes_caniac_combo.png' WHERE name = 'Caniac Combo';
UPDATE food_items SET image_url = '/foods/canes_crinkle_fries.png' WHERE name = 'Crinkle Fries' AND brand = 'Raising Cane''s';
UPDATE food_items SET image_url = '/foods/canes_texas_toast.png' WHERE name = 'Texas Toast' AND brand = 'Raising Cane''s';

-- Dairy Queen
UPDATE food_items SET image_url = '/foods/dq_oreo_blizzard.png' WHERE name = 'Oreo Blizzard (Medium)';
UPDATE food_items SET image_url = '/foods/dq_dilly_bar.png' WHERE name = 'Dilly Bar';
UPDATE food_items SET image_url = '/foods/dq_chicken_strip_basket.png' WHERE name = 'Chicken Strip Basket (4 pc)';
UPDATE food_items SET image_url = '/foods/dq_double_cheeseburger.png' WHERE name = 'Double Cheeseburger' AND brand = 'Dairy Queen';
UPDATE food_items SET image_url = '/foods/dq_soft_serve_cone.png' WHERE name = 'Soft Serve Cone (Medium)';
UPDATE food_items SET image_url = '/foods/dq_pb_cookie_dough_blizzard.png' WHERE name = 'Peanut Butter Cookie Dough Blizzard (Medium)';

-- Jersey Mike's
UPDATE food_items SET image_url = '/foods/jersey_mikes_original_italian.png' WHERE name = 'Original Italian Sub (Regular)';
UPDATE food_items SET image_url = '/foods/jersey_mikes_turkey_provolone.png' WHERE name = 'Turkey & Provolone Sub (Regular)';
UPDATE food_items SET image_url = '/foods/jersey_mikes_club_sub.png' WHERE name = 'Club Sub (Regular)';
UPDATE food_items SET image_url = '/foods/jersey_mikes_philly.png' WHERE name = 'Philly Cheesesteak Sub (Regular)';
UPDATE food_items SET image_url = '/foods/jersey_mikes_blt.png' WHERE name = 'BLT Sub (Regular)';

-- Jimmy John's
UPDATE food_items SET image_url = '/foods/jj_turkey_tom.png' WHERE name = 'Turkey Tom';
UPDATE food_items SET image_url = '/foods/jj_vito.png' WHERE name = 'The Vito';
UPDATE food_items SET image_url = '/foods/jj_pepe.png' WHERE name = 'The Pepe';
UPDATE food_items SET image_url = '/foods/jj_slim_tuna.png' WHERE name = 'Slim 5 Tuna Salad';
UPDATE food_items SET image_url = '/foods/jj_beach_club.png' WHERE name = 'Beach Club';

-- Sonic
UPDATE food_items SET image_url = '/foods/sonic_cheeseburger.png' WHERE name = 'Sonic Cheeseburger';
UPDATE food_items SET image_url = '/foods/sonic_footlong_coney.png' WHERE name = 'Footlong Chili Cheese Coney';
UPDATE food_items SET image_url = '/foods/sonic_tots.png' WHERE name = 'Tater Tots (Medium)';
UPDATE food_items SET image_url = '/foods/sonic_corn_dog.png' WHERE name = 'Corn Dog' AND brand = 'Sonic';
UPDATE food_items SET image_url = '/foods/sonic_cherry_limeade.png' WHERE name = 'Cherry Limeade (Medium)';

-- Whataburger
UPDATE food_items SET image_url = '/foods/whataburger_original.png' WHERE name = 'Whataburger' AND brand = 'Whataburger';
UPDATE food_items SET image_url = '/foods/whataburger_double.png' WHERE name = 'Double Meat Whataburger';
UPDATE food_items SET image_url = '/foods/whataburger_spicy_chicken.png' WHERE name = 'Spicy Chicken Sandwich' AND brand = 'Whataburger';
UPDATE food_items SET image_url = '/foods/whataburger_onion_rings.png' WHERE name = 'Onion Rings (Medium)' AND brand = 'Whataburger';
UPDATE food_items SET image_url = '/foods/whataburger_apple_pie.png' WHERE name = 'Apple Pie' AND brand = 'Whataburger';
UPDATE food_items SET image_url = '/foods/whataburger_chocolate_shake.png' WHERE name = 'Chocolate Shake (Medium)' AND brand = 'Whataburger';

-- Zaxby's
UPDATE food_items SET image_url = '/foods/zaxbys_signature_sandwich.png' WHERE name = 'Signature Sandwich';
UPDATE food_items SET image_url = '/foods/zaxbys_fingerz_plate.png' WHERE name = 'Chicken Fingerz Plate';
UPDATE food_items SET image_url = '/foods/zaxbys_wings_and_things.png' WHERE name = 'Wings & Things';
UPDATE food_items SET image_url = '/foods/zaxbys_crinkle_fries.png' WHERE name = 'Zaxby''s Crinkle Fries';
UPDATE food_items SET image_url = '/foods/zaxbys_zalads_house.png' WHERE name = 'House Zalad with Grilled Chicken';

-- Culver's
UPDATE food_items SET image_url = '/foods/culvers_butterburger.png' WHERE name = 'ButterBurger (Single)';
UPDATE food_items SET image_url = '/foods/culvers_double_butterburger.png' WHERE name = 'Double ButterBurger with Cheese';
UPDATE food_items SET image_url = '/foods/culvers_cheese_curds.png' WHERE name = 'Wisconsin Cheese Curds';
UPDATE food_items SET image_url = '/foods/culvers_frozen_custard.png' WHERE name = 'Vanilla Fresh Frozen Custard';
UPDATE food_items SET image_url = '/foods/culvers_fish_sandwich.png' WHERE name = 'North Atlantic Cod Fish Sandwich';

-- IHOP
UPDATE food_items SET image_url = '/foods/ihop_buttermilk_pancakes.png' WHERE name = 'Original Buttermilk Pancakes (3)';
UPDATE food_items SET image_url = '/foods/ihop_cheesecake_pancakes.png' WHERE name = 'New York Cheesecake Pancakes';
UPDATE food_items SET image_url = '/foods/ihop_stuffed_french_toast.png' WHERE name = 'Stuffed French Toast';
UPDATE food_items SET image_url = '/foods/ihop_bacon_omelette.png' WHERE name = 'Bacon Omelette';
UPDATE food_items SET image_url = '/foods/ihop_belgian_waffle.png' WHERE name = 'Belgian Waffle' AND brand = 'IHOP';
UPDATE food_items SET image_url = '/foods/ihop_harvest_grain_pancakes.png' WHERE name ILIKE '%Harvest Grain%Nut%';
UPDATE food_items SET image_url = '/foods/ihop_big_steak_omelette.png' WHERE name = 'Big Steak Omelette';
UPDATE food_items SET image_url = '/foods/ihop_chicken_waffles.png' WHERE name = 'Chicken & Waffles' AND brand = 'IHOP';

-- Denny's
UPDATE food_items SET image_url = '/foods/dennys_grand_slam.png' WHERE name = 'Grand Slam';
UPDATE food_items SET image_url = '/foods/dennys_moons_over_hammy.png' WHERE name = 'Moons Over My Hammy';
UPDATE food_items SET image_url = '/foods/dennys_pancakes.png' WHERE name = 'Pancakes (4)';
UPDATE food_items SET image_url = '/foods/dennys_country_fried_steak.png' WHERE name = 'Country Fried Steak' AND brand = 'Denny''s';
UPDATE food_items SET image_url = '/foods/dennys_scrambler.png' WHERE name = 'Scrambler';
UPDATE food_items SET image_url = '/foods/dennys_avocado_toast.png' WHERE name = 'Avocado Toast' AND brand = 'Denny''s';

-- Texas Roadhouse
UPDATE food_items SET image_url = '/foods/txrh_sirloin_6oz.png' WHERE name = '6 oz Sirloin';
UPDATE food_items SET image_url = '/foods/txrh_ribs_half_rack.png' WHERE name = 'Baby Back Ribs (Half Rack)';
UPDATE food_items SET image_url = '/foods/txrh_rolls.png' WHERE name = 'Fresh-Baked Dinner Rolls (2)';
UPDATE food_items SET image_url = '/foods/txrh_green_beans.png' WHERE name = 'Fresh Seasoned Green Beans';
UPDATE food_items SET image_url = '/foods/txrh_loaded_sweet_potato.png' WHERE name = 'Loaded Sweet Potato' AND brand = 'Texas Roadhouse';
UPDATE food_items SET image_url = '/foods/txrh_grilled_salmon.png' WHERE name = 'Grilled Salmon' AND brand = 'Texas Roadhouse';

-- Red Lobster
UPDATE food_items SET image_url = '/foods/red_lobster_cheddar_bay_biscuit.png' WHERE name = 'Cheddar Bay Biscuit';
UPDATE food_items SET image_url = '/foods/red_lobster_lobster_tail.png' WHERE name = 'Lobster Tail (8 oz)';
UPDATE food_items SET image_url = '/foods/red_lobster_shrimp_scampi.png' WHERE name = 'Shrimp Scampi' AND brand = 'Red Lobster';
UPDATE food_items SET image_url = '/foods/red_lobster_admiral_feast.png' WHERE name = 'Admiral''s Feast';
UPDATE food_items SET image_url = '/foods/red_lobster_clam_chowder.png' WHERE name = 'New England Clam Chowder' AND brand = 'Red Lobster';

-- Outback
UPDATE food_items SET image_url = '/foods/outback_6oz_sirloin.png' WHERE name = '6 oz Outback Special Sirloin';
UPDATE food_items SET image_url = '/foods/outback_blooming_onion.png' WHERE name = 'Bloomin'' Onion';
UPDATE food_items SET image_url = '/foods/outback_grilled_salmon.png' WHERE name = 'Grilled Salmon' AND brand = 'Outback Steakhouse';
UPDATE food_items SET image_url = '/foods/outback_victorias_filet.png' WHERE name = 'Victoria''s Filet (6 oz)';

-- Little Caesars
UPDATE food_items SET image_url = '/foods/little_caesars_pepperoni_slice.png' WHERE name = 'Hot-N-Ready Pepperoni Pizza Slice';
UPDATE food_items SET image_url = '/foods/little_caesars_cheese_slice.png' WHERE name = 'Hot-N-Ready Cheese Pizza Slice';
UPDATE food_items SET image_url = '/foods/little_caesars_crazy_bread.png' WHERE name = 'Crazy Bread';
UPDATE food_items SET image_url = '/foods/little_caesars_deep_dish.png' WHERE name = 'Deep Deep Dish Pepperoni Pizza Slice';

-- Checkers
UPDATE food_items SET image_url = '/foods/checkers_big_buford.png' WHERE name = 'Big Buford Double Cheeseburger';
UPDATE food_items SET image_url = '/foods/checkers_seasoned_fries.png' WHERE name = 'Seasoned Fries (Medium)' AND brand = 'Checkers';

-- Casual Dining
UPDATE food_items SET image_url = '/foods/red_robin_gourmet_cheeseburger.png' WHERE name = 'Gourmet Cheeseburger';
UPDATE food_items SET image_url = '/foods/red_robin_steak_fries.png' WHERE name = 'Steak Fries' AND brand = 'Red Robin';
UPDATE food_items SET image_url = '/foods/cracker_barrel_chicken_fried_chicken.png' WHERE name = 'Chicken Fried Chicken';
UPDATE food_items SET image_url = '/foods/cracker_barrel_biscuit.png' WHERE name = 'Buttermilk Biscuit' AND brand = 'Cracker Barrel';
UPDATE food_items SET image_url = '/foods/olive_garden_zuppa_toscana.png' WHERE name = 'Zuppa Toscana Soup';
UPDATE food_items SET image_url = '/foods/olive_garden_tiramisu.png' WHERE name = 'Tiramisu' AND brand = 'Olive Garden';
UPDATE food_items SET image_url = '/foods/waffle_house_waffle.png' WHERE name = 'Classic Waffle';
UPDATE food_items SET image_url = '/foods/cook_out_double_cheeseburger.png' WHERE name = 'Double Cheeseburger' AND brand = 'Cook Out';

-- Korean
UPDATE food_items SET image_url = '/foods/korean_bulgogi.png' WHERE name = 'Korean Beef Bulgogi';
UPDATE food_items SET image_url = '/foods/korean_galbi.png' WHERE name = 'Korean Galbi (Short Ribs)';
UPDATE food_items SET image_url = '/foods/korean_samgyeopsal.png' WHERE name = 'Korean Samgyeopsal (Pork Belly)';
UPDATE food_items SET image_url = '/foods/tteokbokki.png' WHERE name = 'Tteokbokki';
UPDATE food_items SET image_url = '/foods/japchae.png' WHERE name = 'Japchae';
UPDATE food_items SET image_url = '/foods/korean_fried_chicken.png' WHERE name = 'Korean Fried Chicken (4 pc)';
UPDATE food_items SET image_url = '/foods/kimchi_bowl.png' WHERE name = 'Kimchi';
UPDATE food_items SET image_url = '/foods/korean_bibim_noodles.png' WHERE name = 'Korean Bibim Cold Noodles';
UPDATE food_items SET image_url = '/foods/sundubu_jjigae.png' WHERE name = 'Sundubu Jjigae (Soft Tofu Stew)';
UPDATE food_items SET image_url = '/foods/doenjang_jjigae.png' WHERE name = 'Doenjang Jjigae';

-- Filipino
UPDATE food_items SET image_url = '/foods/chicken_adobo_filipino.png' WHERE name = 'Chicken Adobo (Filipino)';
UPDATE food_items SET image_url = '/foods/pork_sinigang.png' WHERE name = 'Pork Sinigang';
UPDATE food_items SET image_url = '/foods/kare_kare.png' WHERE name = 'Kare-Kare';
UPDATE food_items SET image_url = '/foods/lechon_kawali.png' WHERE name = 'Lechon Kawali (Crispy Pork Belly)';
UPDATE food_items SET image_url = '/foods/pancit_bihon.png' WHERE name = 'Pancit Bihon';
UPDATE food_items SET image_url = '/foods/lumpia_shanghai.png' WHERE name = 'Lumpia Shanghai (6 pc)';
UPDATE food_items SET image_url = '/foods/sinangag_garlic_rice.png' WHERE name = 'Sinangag (Filipino Garlic Rice)';
UPDATE food_items SET image_url = '/foods/halo_halo.png' WHERE name = 'Halo-Halo';

-- Brazilian
UPDATE food_items SET image_url = '/foods/acai_bowl_brazilian.png' WHERE name = 'Açaí Bowl' AND brand IS NULL;
UPDATE food_items SET image_url = '/foods/pao_de_queijo.png' WHERE name = 'Pão de Queijo (3 pc)';
UPDATE food_items SET image_url = '/foods/coxinha.png' WHERE name = 'Coxinha';
UPDATE food_items SET image_url = '/foods/churrasco_picanha.png' WHERE name = 'Churrasco Picanha';
UPDATE food_items SET image_url = '/foods/feijoada.png' WHERE name = 'Feijoada';
UPDATE food_items SET image_url = '/foods/farofa.png' WHERE name = 'Farofa';
UPDATE food_items SET image_url = '/foods/brigadeiro.png' WHERE name = 'Brigadeiro (2 pc)';

-- Mexican Home
UPDATE food_items SET image_url = '/foods/birria_tacos.png' WHERE name = 'Birria Tacos (3)';
UPDATE food_items SET image_url = '/foods/enchiladas_rojas.png' WHERE name = 'Enchiladas Rojas (3)';
UPDATE food_items SET image_url = '/foods/pozole_rojo.png' WHERE name = 'Pozole Rojo';
UPDATE food_items SET image_url = '/foods/chilaquiles_rojos.png' WHERE name = 'Chilaquiles Rojos';
UPDATE food_items SET image_url = '/foods/elote_street_corn.png' WHERE name = 'Elote (Mexican Street Corn)';
UPDATE food_items SET image_url = '/foods/carne_asada_plate.png' WHERE name = 'Carne Asada Plate';
UPDATE food_items SET image_url = '/foods/tamale_pork_red.png' WHERE name = 'Tamale (Pork, Red Chile)';
UPDATE food_items SET image_url = '/foods/menudo_bowl.png' WHERE name = 'Menudo';

-- Ethiopian
UPDATE food_items SET image_url = '/foods/injera_ethiopian.png' WHERE name = 'Injera';
UPDATE food_items SET image_url = '/foods/doro_wat.png' WHERE name = 'Doro Wat';
UPDATE food_items SET image_url = '/foods/ethiopian_tibs.png' WHERE name = 'Ethiopian Tibs';
UPDATE food_items SET image_url = '/foods/misir_red_lentils.png' WHERE name = 'Misir (Red Lentil Stew)';
UPDATE food_items SET image_url = '/foods/ethiopian_combo_platter.png' WHERE name = 'Ethiopian Combination Platter';

-- Peruvian
UPDATE food_items SET image_url = '/foods/ceviche_peruano.png' WHERE name = 'Ceviche Peruano';
UPDATE food_items SET image_url = '/foods/lomo_saltado.png' WHERE name = 'Lomo Saltado';
UPDATE food_items SET image_url = '/foods/aji_de_gallina.png' WHERE name = 'Ají de Gallina';
UPDATE food_items SET image_url = '/foods/causa_limena.png' WHERE name = 'Causa Limeña';
UPDATE food_items SET image_url = '/foods/anticuchos.png' WHERE name = 'Anticuchos (Beef Heart Skewers, 3)';

-- Colombian
UPDATE food_items SET image_url = '/foods/bandeja_paisa.png' WHERE name = 'Bandeja Paisa';
UPDATE food_items SET image_url = '/foods/arepa_colombiana.png' WHERE name = 'Arepa Colombiana';
UPDATE food_items SET image_url = '/foods/sancocho_colombiano.png' WHERE name = 'Sancocho Colombiano';
UPDATE food_items SET image_url = '/foods/changua.png' WHERE name = 'Changua (Colombian Milk Soup)';
UPDATE food_items SET image_url = '/foods/ajiaco_colombiano.png' WHERE name = 'Ajiaco Colombiano';
UPDATE food_items SET image_url = '/foods/sobrebarriga.png' WHERE name = 'Sobrebarriga';

-- Venezuelan
UPDATE food_items SET image_url = '/foods/pabellon_criollo.png' WHERE name = 'Pabellón Criollo';
UPDATE food_items SET image_url = '/foods/cachapas.png' WHERE name = 'Cachapas';
UPDATE food_items SET image_url = '/foods/hallacas_venezuelan.png' WHERE name = 'Hallacas';
UPDATE food_items SET image_url = '/foods/caraotas_negras.png' WHERE name = 'Caraotas Negras';
UPDATE food_items SET image_url = '/foods/tequenos.png' WHERE name = 'Tequeños (4 pc)';

-- Turkish / Greek
UPDATE food_items SET image_url = '/foods/doner_kebab.png' WHERE name = 'Döner Kebab';
UPDATE food_items SET image_url = '/foods/lahmacun.png' WHERE name = 'Lahmacun';
UPDATE food_items SET image_url = '/foods/menemen_turkish.png' WHERE name = 'Menemen (Turkish Egg Dish)';
UPDATE food_items SET image_url = '/foods/spanakopita.png' WHERE name = 'Spanakopita';
UPDATE food_items SET image_url = '/foods/moussaka_greek.png' WHERE name = 'Moussaka';
UPDATE food_items SET image_url = '/foods/baklava.png' WHERE name = 'Baklava (2 pieces)';

-- Thai Extra
UPDATE food_items SET image_url = '/foods/massaman_curry.png' WHERE name = 'Massaman Curry';
UPDATE food_items SET image_url = '/foods/som_tam.png' WHERE name = 'Som Tam (Green Papaya Salad)';
UPDATE food_items SET image_url = '/foods/khao_man_gai.png' WHERE name = 'Khao Man Gai';
UPDATE food_items SET image_url = '/foods/mango_sticky_rice.png' WHERE name = 'Mango Sticky Rice';
UPDATE food_items SET image_url = '/foods/tom_kha_gai.png' WHERE name = 'Tom Kha Gai';

-- Vietnamese Extra
UPDATE food_items SET image_url = '/foods/bun_bo_hue.png' WHERE name = 'Bún Bò Huế';
UPDATE food_items SET image_url = '/foods/banh_mi_sandwich.png' WHERE name = 'Bánh Mì Sandwich';
UPDATE food_items SET image_url = '/foods/com_tam.png' WHERE name = 'Cơm Tấm (Broken Rice with Grilled Pork)';
UPDATE food_items SET image_url = '/foods/bun_cha.png' WHERE name = 'Bún Chả';
UPDATE food_items SET image_url = '/foods/che_ba_mau.png' WHERE name = 'Chè Ba Màu';

-- Indian Extra
UPDATE food_items SET image_url = '/foods/chicken_biryani.png' WHERE name = 'Chicken Biryani';
UPDATE food_items SET image_url = '/foods/dal_makhani.png' WHERE name = 'Dal Makhani';
UPDATE food_items SET image_url = '/foods/chana_masala.png' WHERE name = 'Chana Masala';
UPDATE food_items SET image_url = '/foods/palak_paneer.png' WHERE name = 'Palak Paneer';
UPDATE food_items SET image_url = '/foods/garlic_naan.png' WHERE name = 'Garlic Naan';
UPDATE food_items SET image_url = '/foods/samosa_chaat.png' WHERE name = 'Samosa Chaat';

-- Japanese Extra
UPDATE food_items SET image_url = '/foods/tonkatsu.png' WHERE name = 'Tonkatsu (Breaded Pork Cutlet)';
UPDATE food_items SET image_url = '/foods/oyakodon.png' WHERE name = 'Oyakodon';
UPDATE food_items SET image_url = '/foods/takoyaki.png' WHERE name = 'Takoyaki (6 pc)';
UPDATE food_items SET image_url = '/foods/mochi_ice_cream.png' WHERE name = 'Mochi Ice Cream (3 pc)';

-- Supplements
UPDATE food_items SET image_url = '/foods/pre_workout_powder.png' WHERE name = 'Pre-Workout Powder';
UPDATE food_items SET image_url = '/foods/fish_oil_softgel.png' WHERE name = 'Fish Oil Softgel';
UPDATE food_items SET image_url = '/foods/collagen_peptides.png' WHERE name = 'Collagen Peptides';
UPDATE food_items SET image_url = '/foods/vitamin_d3_supplement.png' WHERE name = 'Vitamin D3 (2000 IU)';
UPDATE food_items SET image_url = '/foods/glutamine_powder.png' WHERE name = 'L-Glutamine Powder';
UPDATE food_items SET image_url = '/foods/zma_supplement.png' WHERE name = 'ZMA Supplement';
UPDATE food_items SET image_url = '/foods/magnesium_glycinate.png' WHERE name = 'Magnesium Glycinate';
UPDATE food_items SET image_url = '/foods/electrolyte_powder.png' WHERE name = 'Electrolyte Powder';
UPDATE food_items SET image_url = '/foods/omega3_supplement.png' WHERE name = 'Omega-3 Fish Oil (1000mg)';
UPDATE food_items SET image_url = '/foods/ashwagandha.png' WHERE name = 'Ashwagandha (600mg)';

-- Breakfast Extras
UPDATE food_items SET image_url = '/foods/eggs_benedict.png' WHERE name = 'Eggs Benedict';
UPDATE food_items SET image_url = '/foods/acai_bowl.png' WHERE name = 'Açaí Bowl' AND brand IS NULL AND serving_unit = 'bowl';
UPDATE food_items SET image_url = '/foods/smoothie_bowl_berry.png' WHERE name = 'Berry Smoothie Bowl';
UPDATE food_items SET image_url = '/foods/quiche_lorraine_slice.png' WHERE name = 'Quiche Lorraine (1 slice)';
UPDATE food_items SET image_url = '/foods/crepes_plain.png' WHERE name = 'Crepes Plain (2)';
UPDATE food_items SET image_url = '/foods/granola_bowl_milk.png' WHERE name = 'Granola Bowl with Milk';
UPDATE food_items SET image_url = '/foods/biscuits_and_gravy.png' WHERE name = 'Biscuits and Gravy';
UPDATE food_items SET image_url = '/foods/bagel_lox_cream_cheese.png' WHERE name = 'Bagel with Lox & Cream Cheese';
UPDATE food_items SET image_url = '/foods/shakshuka.png' WHERE name = 'Shakshuka';
UPDATE food_items SET image_url = '/foods/breakfast_quesadilla.png' WHERE name = 'Breakfast Quesadilla';

-- More Proteins
UPDATE food_items SET image_url = '/foods/duck_breast_roasted.png' WHERE name = 'Duck Breast (roasted)';
UPDATE food_items SET image_url = '/foods/goat_meat_stewed.png' WHERE name = 'Goat Meat (stewed)';
UPDATE food_items SET image_url = '/foods/rabbit_roasted.png' WHERE name = 'Rabbit (roasted)';
UPDATE food_items SET image_url = '/foods/swordfish_steak_grilled.png' WHERE name = 'Swordfish Steak (grilled)';
UPDATE food_items SET image_url = '/foods/rainbow_trout_baked.png' WHERE name = 'Rainbow Trout (baked)';
UPDATE food_items SET image_url = '/foods/atlantic_mackerel_baked.png' WHERE name = 'Atlantic Mackerel (baked)';
UPDATE food_items SET image_url = '/foods/pan_seared_scallops.png' WHERE name = 'Pan-Seared Scallops';
UPDATE food_items SET image_url = '/foods/raw_oysters_6.png' WHERE name = 'Raw Oysters (6)';
UPDATE food_items SET image_url = '/foods/steamed_clams.png' WHERE name = 'Steamed Clams';
UPDATE food_items SET image_url = '/foods/mussels_steamed.png' WHERE name = 'Steamed Mussels';

-- Drinks
UPDATE food_items SET image_url = '/foods/sprite_can.png' WHERE name = 'Sprite (12 oz can)';
UPDATE food_items SET image_url = '/foods/sweet_tea.png' WHERE name = 'Sweet Iced Tea (16 oz)';
UPDATE food_items SET image_url = '/foods/unsweetened_iced_tea.png' WHERE name = 'Unsweetened Iced Tea (16 oz)';
UPDATE food_items SET image_url = '/foods/prime_hydration.png' WHERE name = 'Prime Hydration Drink';
UPDATE food_items SET image_url = '/foods/coconut_water_vitacoco.png' WHERE name = 'Coconut Water' AND brand = 'Vita Coco';
UPDATE food_items SET image_url = '/foods/chocolate_milk.png' WHERE name = 'Chocolate Milk (8 oz)';
UPDATE food_items SET image_url = '/foods/heineken_bottle.png' WHERE name = 'Heineken Beer (12 oz)';
UPDATE food_items SET image_url = '/foods/corona_bottle.png' WHERE name = 'Corona Beer (12 oz)';
UPDATE food_items SET image_url = '/foods/red_wine_glass.png' WHERE name = 'Red Wine (5 oz glass)';
UPDATE food_items SET image_url = '/foods/white_wine_glass.png' WHERE name = 'White Wine (5 oz glass)';
UPDATE food_items SET image_url = '/foods/tequila_shot.png' WHERE name = 'Tequila Shot (1.5 oz)';
UPDATE food_items SET image_url = '/foods/vodka_shot.png' WHERE name = 'Vodka Shot (1.5 oz)';
UPDATE food_items SET image_url = '/foods/rum_and_coke.png' WHERE name = 'Rum and Coke';
UPDATE food_items SET image_url = '/foods/white_claw_hard_seltzer.png' WHERE name = 'White Claw Hard Seltzer';

-- Snacks
UPDATE food_items SET image_url = '/foods/quest_protein_chips.png' WHERE name = 'Protein Chips (Ranch)';
UPDATE food_items SET image_url = '/foods/popcorners_white_cheddar.png' WHERE name = 'PopCorners White Cheddar';
UPDATE food_items SET image_url = '/foods/nature_valley_crunchy.png' WHERE name = 'Nature Valley Crunchy Bar';
UPDATE food_items SET image_url = '/foods/nutri_grain_bar.png' WHERE name = 'Nutri-Grain Strawberry Bar';
UPDATE food_items SET image_url = '/foods/pirates_booty.png' WHERE name = 'Pirate''s Booty White Cheddar';
UPDATE food_items SET image_url = '/foods/gummy_bears.png' WHERE name = 'Gummy Bears';
UPDATE food_items SET image_url = '/foods/sour_patch_kids.png' WHERE name = 'Sour Patch Kids';
UPDATE food_items SET image_url = '/foods/swedish_fish.png' WHERE name = 'Swedish Fish';
UPDATE food_items SET image_url = '/foods/starburst_original.png' WHERE name = 'Starburst Original';
UPDATE food_items SET image_url = '/foods/haribo_goldbears.png' WHERE name = 'Haribo Gold-Bears';
UPDATE food_items SET image_url = '/foods/hi_chew_strawberry.png' WHERE name = 'Hi-Chew Strawberry';
UPDATE food_items SET image_url = '/foods/takis_fuego.png' WHERE name = 'Takis Fuego';

-- Vegetables
UPDATE food_items SET image_url = '/foods/bok_choy_cooked.png' WHERE name = 'Bok Choy (cooked)';
UPDATE food_items SET image_url = '/foods/arugula_raw.png' WHERE name = 'Arugula (raw)';
UPDATE food_items SET image_url = '/foods/butternut_squash_roasted.png' WHERE name = 'Butternut Squash (roasted)';
UPDATE food_items SET image_url = '/foods/acorn_squash_roasted.png' WHERE name = 'Acorn Squash (roasted)';
UPDATE food_items SET image_url = '/foods/nopales_grilled.png' WHERE name = 'Nopales / Cactus Paddles (grilled)';
UPDATE food_items SET image_url = '/foods/jicama_raw.png' WHERE name = 'Jicama (raw)';
UPDATE food_items SET image_url = '/foods/swiss_chard_cooked.png' WHERE name = 'Swiss Chard (cooked)';
UPDATE food_items SET image_url = '/foods/watercress_raw.png' WHERE name = 'Watercress (raw)';
UPDATE food_items SET image_url = '/foods/turnip_cooked.png' WHERE name = 'Turnip (cooked)';
UPDATE food_items SET image_url = '/foods/parsnip_roasted.png' WHERE name = 'Parsnip (roasted)';
UPDATE food_items SET image_url = '/foods/leek_cooked.png' WHERE name = 'Leek (cooked)';
UPDATE food_items SET image_url = '/foods/fennel_raw.png' WHERE name = 'Fennel (raw)';

-- Fruits
UPDATE food_items SET image_url = '/foods/dragon_fruit.png' WHERE name = 'Dragon Fruit';
UPDATE food_items SET image_url = '/foods/papaya_fresh.png' WHERE name = 'Papaya (fresh)';
UPDATE food_items SET image_url = '/foods/guava_fresh.png' WHERE name = 'Guava (fresh)';
UPDATE food_items SET image_url = '/foods/passion_fruit_halved.png' WHERE name = 'Passion Fruit';
UPDATE food_items SET image_url = '/foods/lychee_fresh.png' WHERE name = 'Lychee (fresh)';
UPDATE food_items SET image_url = '/foods/star_fruit.png' WHERE name = 'Star Fruit / Carambola';
UPDATE food_items SET image_url = '/foods/jackfruit_fresh.png' WHERE name = 'Jackfruit (fresh)';
UPDATE food_items SET image_url = '/foods/persimmon_fresh.png' WHERE name = 'Persimmon (fresh)';
UPDATE food_items SET image_url = '/foods/kumquat.png' WHERE name = 'Kumquat';
UPDATE food_items SET image_url = '/foods/blood_orange.png' WHERE name = 'Blood Orange';
UPDATE food_items SET image_url = '/foods/tamarind.png' WHERE name = 'Tamarind';
UPDATE food_items SET image_url = '/foods/longan_fresh.png' WHERE name = 'Longan (fresh)';

-- Dairy
UPDATE food_items SET image_url = '/foods/sour_cream.png' WHERE name = 'Sour Cream (full fat)';
UPDATE food_items SET image_url = '/foods/heavy_cream.png' WHERE name = 'Heavy Whipping Cream';
UPDATE food_items SET image_url = '/foods/half_and_half.png' WHERE name = 'Half & Half';
UPDATE food_items SET image_url = '/foods/kefir_plain.png' WHERE name = 'Kefir (plain)';
UPDATE food_items SET image_url = '/foods/brie_cheese.png' WHERE name = 'Brie Cheese';
UPDATE food_items SET image_url = '/foods/blue_cheese.png' WHERE name = 'Blue Cheese (crumbled)';
UPDATE food_items SET image_url = '/foods/gouda_cheese.png' WHERE name = 'Gouda Cheese';
UPDATE food_items SET image_url = '/foods/feta_crumbled.png' WHERE name = 'Feta Cheese (crumbled)';
UPDATE food_items SET image_url = '/foods/ricotta_cheese.png' WHERE name = 'Ricotta Cheese';
UPDATE food_items SET image_url = '/foods/mascarpone_cheese.png' WHERE name = 'Mascarpone Cheese';

-- Cereals / Grains
UPDATE food_items SET image_url = '/foods/granola_plain.png' WHERE name = 'Granola (plain)';
UPDATE food_items SET image_url = '/foods/grape_nuts_cereal.png' WHERE name = 'Grape Nuts Cereal';
UPDATE food_items SET image_url = '/foods/kashi_go_cereal.png' WHERE name = 'Kashi GO Cereal';
UPDATE food_items SET image_url = '/foods/cap_n_crunch.png' WHERE name = 'Cap''n Crunch';
UPDATE food_items SET image_url = '/foods/cocoa_puffs.png' WHERE name = 'Cocoa Puffs';
UPDATE food_items SET image_url = '/foods/polenta_cooked.png' WHERE name = 'Polenta (cooked)';
UPDATE food_items SET image_url = '/foods/grits_cooked.png' WHERE name = 'Grits (cooked)';
UPDATE food_items SET image_url = '/foods/millet_cooked.png' WHERE name = 'Millet (cooked)';
UPDATE food_items SET image_url = '/foods/udon_noodles_cooked.png' WHERE name = 'Udon Noodles (cooked)';
UPDATE food_items SET image_url = '/foods/soba_noodles_cooked.png' WHERE name = 'Soba Noodles (cooked)';

-- Protein Bars / Shakes
UPDATE food_items SET image_url = '/foods/barebells_chocolate_dough.png' WHERE name = 'Barebells Chocolate Dough Bar';
UPDATE food_items SET image_url = '/foods/grenade_carb_killa.png' WHERE name = 'Grenade Carb Killa Bar';
UPDATE food_items SET image_url = '/foods/built_bar_chocolate.png' WHERE name = 'Built Bar Chocolate';
UPDATE food_items SET image_url = '/foods/ghost_protein_bar.png' WHERE name = 'Ghost Protein Bar';
UPDATE food_items SET image_url = '/foods/core_power_chocolate.png' WHERE name = 'Core Power Elite Shake (Chocolate)';
UPDATE food_items SET image_url = '/foods/bsn_syntha6.png' WHERE name = 'BSN Syntha-6 Protein Shake';
UPDATE food_items SET image_url = '/foods/orgain_plant_protein_shake.png' WHERE name = 'Orgain Plant Protein Shake';
UPDATE food_items SET image_url = '/foods/vega_sport_protein.png' WHERE name = 'Vega Sport Premium Protein';

-- Condiments
UPDATE food_items SET image_url = '/foods/worcestershire_sauce.png' WHERE name = 'Worcestershire Sauce';
UPDATE food_items SET image_url = '/foods/fish_sauce_bottle.png' WHERE name = 'Fish Sauce';
UPDATE food_items SET image_url = '/foods/oyster_sauce.png' WHERE name = 'Oyster Sauce';
UPDATE food_items SET image_url = '/foods/hoisin_sauce.png' WHERE name = 'Hoisin Sauce';
UPDATE food_items SET image_url = '/foods/miso_paste.png' WHERE name = 'Miso Paste (white)';
UPDATE food_items SET image_url = '/foods/gochujang_paste.png' WHERE name = 'Gochujang (Korean Chili Paste)';
UPDATE food_items SET image_url = '/foods/chimichurri_sauce.png' WHERE name = 'Chimichurri Sauce';
UPDATE food_items SET image_url = '/foods/red_curry_paste.png' WHERE name = 'Red Curry Paste';

-- Misc Grains / Breads
UPDATE food_items SET image_url = '/foods/rice_noodles_cooked.png' WHERE name = 'Rice Noodles (cooked)';
UPDATE food_items SET image_url = '/foods/egg_noodles_cooked.png' WHERE name = 'Egg Noodles (cooked)';
UPDATE food_items SET image_url = '/foods/cream_of_rice.png' WHERE name = 'Cream of Rice';
UPDATE food_items SET image_url = '/foods/sourdough_bread_slice.png' WHERE name = 'Sourdough Bread';
UPDATE food_items SET image_url = '/foods/cornbread_slice.png' WHERE name = 'Cornbread';
UPDATE food_items SET image_url = '/foods/focaccia_slice.png' WHERE name = 'Focaccia';

-- Sandwiches / Meals
UPDATE food_items SET image_url = '/foods/grilled_cheese_sandwich.png' WHERE name = 'Grilled Cheese Sandwich';
UPDATE food_items SET image_url = '/foods/blt_sandwich.png' WHERE name = 'BLT Sandwich';
UPDATE food_items SET image_url = '/foods/club_sandwich.png' WHERE name = 'Club Sandwich';
UPDATE food_items SET image_url = '/foods/philly_cheesesteak_sandwich.png' WHERE name = 'Philly Cheesesteak Sandwich';
UPDATE food_items SET image_url = '/foods/french_dip_sandwich.png' WHERE name = 'French Dip Sandwich';
UPDATE food_items SET image_url = '/foods/grilled_veggie_wrap.png' WHERE name = 'Grilled Veggie Wrap';

-- Soups
UPDATE food_items SET image_url = '/foods/lentil_soup_bowl.png' WHERE name = 'Lentil Soup';
UPDATE food_items SET image_url = '/foods/minestrone_soup_bowl.png' WHERE name = 'Minestrone Soup';
UPDATE food_items SET image_url = '/foods/clam_chowder_bowl.png' WHERE name = 'New England Clam Chowder' AND brand IS NULL;
UPDATE food_items SET image_url = '/foods/french_onion_soup_bowl.png' WHERE name = 'French Onion Soup';
UPDATE food_items SET image_url = '/foods/tomato_bisque_bowl.png' WHERE name = 'Tomato Bisque';

-- Packaged Snacks
UPDATE food_items SET image_url = '/foods/lays_classic_chips.png' WHERE name = 'Lay''s Classic Chips';
UPDATE food_items SET image_url = '/foods/pringles_original.png' WHERE name = 'Pringles Original';
UPDATE food_items SET image_url = '/foods/ritz_crackers.png' WHERE name = 'Ritz Crackers (5)';
UPDATE food_items SET image_url = '/foods/wheat_thins.png' WHERE name = 'Wheat Thins (handful)';
UPDATE food_items SET image_url = '/foods/babybel_cheese.png' WHERE name = 'Babybel Mini Cheese';

-- Health Drinks
UPDATE food_items SET image_url = '/foods/kombucha_ginger_lemon.png' WHERE name = 'Ginger Lemon Kombucha';
UPDATE food_items SET image_url = '/foods/beet_juice.png' WHERE name = 'Fresh Beet Juice';
UPDATE food_items SET image_url = '/foods/celery_juice.png' WHERE name = 'Fresh Celery Juice';
UPDATE food_items SET image_url = '/foods/golden_milk_turmeric_latte.png' WHERE name = 'Golden Milk Turmeric Latte';

-- Desserts Extra
UPDATE food_items SET image_url = '/foods/tiramisu_slice.png' WHERE name = 'Tiramisu (1 slice)';
UPDATE food_items SET image_url = '/foods/gelato_scoop.png' WHERE name = 'Gelato (1 scoop)';
UPDATE food_items SET image_url = '/foods/churros.png' WHERE name = 'Churros (3)';
UPDATE food_items SET image_url = '/foods/beignets.png' WHERE name = 'Beignets (3)';
UPDATE food_items SET image_url = '/foods/funnel_cake.png' WHERE name = 'Funnel Cake';
UPDATE food_items SET image_url = '/foods/soft_pretzel_large.png' WHERE name = 'Large Soft Pretzel';
UPDATE food_items SET image_url = '/foods/strawberry_cheesecake_slice.png' WHERE name = 'Strawberry Cheesecake (1 slice)';

-- Bojangles
UPDATE food_items SET image_url = '/foods/bojangles_chicken_supremes.png' WHERE name ILIKE '%Bojangles%' OR name ILIKE '%Chicken Supremes%';
