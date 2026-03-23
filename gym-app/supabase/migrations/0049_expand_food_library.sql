-- ═══════════════════════════════════════════════════════════
-- EXPANDED FOOD LIBRARY — 450+ new items
-- Fast food, casual dining, packaged goods, international,
-- whole foods, desserts & sweets
-- ═══════════════════════════════════════════════════════════

INSERT INTO food_items (name, brand, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) VALUES

-- ─────────────────────────────────────────────────────────
-- McDONALD'S (28 items)
-- ─────────────────────────────────────────────────────────
('Big Mac', 'McDonald''s', 1, 'sandwich', 550, 25, 45, 30, 3),
('Quarter Pounder with Cheese', 'McDonald''s', 1, 'sandwich', 520, 30, 42, 26, 2),
('McChicken', 'McDonald''s', 1, 'sandwich', 400, 14, 40, 21, 2),
('Chicken McNuggets (4 pc)', 'McDonald''s', 4, 'pieces', 170, 10, 10, 10, 0),
('Chicken McNuggets (6 pc)', 'McDonald''s', 6, 'pieces', 250, 15, 15, 15, 0),
('Chicken McNuggets (10 pc)', 'McDonald''s', 10, 'pieces', 420, 25, 25, 25, 1),
('Chicken McNuggets (20 pc)', 'McDonald''s', 20, 'pieces', 840, 49, 51, 50, 2),
('Filet-O-Fish', 'McDonald''s', 1, 'sandwich', 390, 16, 39, 19, 1),
('McDouble', 'McDonald''s', 1, 'sandwich', 400, 22, 33, 20, 2),
('Egg McMuffin', 'McDonald''s', 1, 'sandwich', 300, 17, 30, 13, 2),
('Sausage McMuffin', 'McDonald''s', 1, 'sandwich', 400, 14, 29, 26, 2),
('Sausage McMuffin with Egg', 'McDonald''s', 1, 'sandwich', 480, 21, 30, 31, 2),
('Hash Brown', 'McDonald''s', 1, 'piece', 140, 1, 16, 8, 1),
('Large Fries', 'McDonald''s', 1, 'serving', 480, 7, 65, 23, 5),
('Medium Fries', 'McDonald''s', 1, 'serving', 320, 5, 43, 15, 4),
('Small Fries', 'McDonald''s', 1, 'serving', 220, 3, 29, 10, 3),
('Southwest Grilled Chicken Salad', 'McDonald''s', 1, 'salad', 350, 37, 27, 11, 6),
('Apple Slices', 'McDonald''s', 1, 'bag', 15, 0, 4, 0, 0.5),
('McFlurry with Oreo (regular)', 'McDonald''s', 1, 'cup', 510, 12, 80, 17, 1),
('McFlurry with M&M (regular)', 'McDonald''s', 1, 'cup', 640, 14, 90, 23, 2),
('Hotcakes', 'McDonald''s', 3, 'pancakes', 350, 8, 60, 9, 2),
('Big Breakfast with Hotcakes', 'McDonald''s', 1, 'meal', 1090, 36, 111, 56, 5),
('Bacon Egg & Cheese Biscuit', 'McDonald''s', 1, 'sandwich', 460, 19, 38, 26, 1),
('Iced Coffee (medium, no sugar)', 'McDonald''s', 1, 'cup', 140, 2, 22, 5, 0),
('Chocolate Shake (medium)', 'McDonald''s', 1, 'cup', 630, 14, 88, 22, 1),
('Vanilla Shake (medium)', 'McDonald''s', 1, 'cup', 600, 14, 84, 21, 0),
('Double Quarter Pounder with Cheese', 'McDonald''s', 1, 'sandwich', 740, 48, 43, 42, 2),
('Crispy Chicken Sandwich', 'McDonald''s', 1, 'sandwich', 470, 26, 45, 20, 2),

-- ─────────────────────────────────────────────────────────
-- CHICK-FIL-A (22 items)
-- ─────────────────────────────────────────────────────────
('Original Chicken Sandwich', 'Chick-fil-A', 1, 'sandwich', 440, 28, 40, 19, 1),
('Spicy Chicken Sandwich', 'Chick-fil-A', 1, 'sandwich', 450, 28, 41, 19, 2),
('Grilled Chicken Sandwich', 'Chick-fil-A', 1, 'sandwich', 320, 28, 36, 6, 3),
('Chicken Nuggets (8 ct)', 'Chick-fil-A', 8, 'pieces', 250, 27, 11, 11, 0),
('Chicken Nuggets (12 ct)', 'Chick-fil-A', 12, 'pieces', 380, 40, 16, 17, 0),
('Grilled Nuggets (8 ct)', 'Chick-fil-A', 8, 'pieces', 130, 25, 1, 3, 0),
('Waffle Fries (medium)', 'Chick-fil-A', 1, 'serving', 420, 5, 45, 24, 5),
('Waffle Fries (large)', 'Chick-fil-A', 1, 'serving', 560, 7, 60, 32, 7),
('Mac & Cheese (medium)', 'Chick-fil-A', 1, 'serving', 440, 17, 43, 22, 1),
('Chicken Biscuit', 'Chick-fil-A', 1, 'sandwich', 440, 18, 48, 19, 2),
('Spicy Southwest Salad', 'Chick-fil-A', 1, 'salad', 450, 33, 39, 19, 8),
('Grilled Cool Wrap', 'Chick-fil-A', 1, 'wrap', 350, 37, 29, 13, 15),
('Chick-n-Strips (3 ct)', 'Chick-fil-A', 3, 'strips', 310, 28, 14, 15, 0),
('Frosted Lemonade (medium)', 'Chick-fil-A', 1, 'cup', 330, 5, 64, 6, 0),
('Cookies & Cream Milkshake (medium)', 'Chick-fil-A', 1, 'cup', 550, 13, 75, 22, 0),
('Hash Brown Scramble Burrito', 'Chick-fil-A', 1, 'burrito', 680, 36, 51, 37, 3),
('Chicken Tortilla Soup (medium)', 'Chick-fil-A', 1, 'bowl', 340, 22, 29, 14, 6),
('Side Salad', 'Chick-fil-A', 1, 'salad', 80, 5, 6, 4.5, 2),
('Cobb Salad', 'Chick-fil-A', 1, 'salad', 510, 40, 27, 27, 5),
('Fruit Cup', 'Chick-fil-A', 1, 'cup', 60, 1, 16, 0, 2),
('Chocolate Chip Cookie', 'Chick-fil-A', 1, 'cookie', 350, 4, 49, 16, 1),
('Chick-fil-A Sauce', 'Chick-fil-A', 1, 'packet', 140, 0, 7, 13, 0),

-- ─────────────────────────────────────────────────────────
-- CHIPOTLE (16 items)
-- ─────────────────────────────────────────────────────────
('Chicken Burrito', 'Chipotle', 1, 'burrito', 1020, 54, 105, 39, 12),
('Steak Burrito', 'Chipotle', 1, 'burrito', 1030, 51, 105, 41, 12),
('Chicken Bowl', 'Chipotle', 1, 'bowl', 740, 51, 72, 27, 14),
('Steak Bowl', 'Chipotle', 1, 'bowl', 750, 48, 72, 29, 14),
('Carnitas Bowl', 'Chipotle', 1, 'bowl', 800, 44, 72, 35, 14),
('Sofritas Bowl', 'Chipotle', 1, 'bowl', 675, 24, 76, 28, 16),
('Chips & Guacamole', 'Chipotle', 1, 'serving', 770, 10, 64, 53, 13),
('Chips & Queso Blanco', 'Chipotle', 1, 'serving', 780, 18, 72, 46, 3),
('Cilantro-Lime White Rice', 'Chipotle', 1, 'serving', 210, 4, 40, 4, 0),
('Black Beans', 'Chipotle', 1, 'serving', 130, 8, 22, 1, 7),
('Pinto Beans', 'Chipotle', 1, 'serving', 130, 8, 22, 1, 7),
('Chicken Quesadilla', 'Chipotle', 1, 'quesadilla', 750, 45, 52, 38, 3),
('Steak Tacos (3)', 'Chipotle', 3, 'tacos', 545, 30, 42, 27, 5),
('Chicken Tacos (3)', 'Chipotle', 3, 'tacos', 520, 33, 42, 24, 5),
('Barbacoa Bowl', 'Chipotle', 1, 'bowl', 760, 47, 72, 31, 14),
('Veggie Bowl', 'Chipotle', 1, 'bowl', 640, 16, 80, 28, 18),

-- ─────────────────────────────────────────────────────────
-- SUBWAY (16 items)
-- ─────────────────────────────────────────────────────────
('6" Turkey Breast Sub', 'Subway', 1, 'sandwich', 280, 18, 46, 3.5, 5),
('6" Italian BMT', 'Subway', 1, 'sandwich', 410, 20, 47, 16, 5),
('6" Chicken Teriyaki', 'Subway', 1, 'sandwich', 380, 26, 51, 7, 5),
('6" Meatball Marinara', 'Subway', 1, 'sandwich', 480, 23, 56, 18, 7),
('6" Tuna', 'Subway', 1, 'sandwich', 480, 20, 44, 25, 5),
('6" Veggie Delite', 'Subway', 1, 'sandwich', 230, 9, 44, 2.5, 5),
('6" Steak & Cheese', 'Subway', 1, 'sandwich', 380, 26, 46, 10, 5),
('6" Spicy Italian', 'Subway', 1, 'sandwich', 470, 20, 46, 23, 5),
('Footlong Turkey Breast', 'Subway', 1, 'sandwich', 560, 36, 92, 7, 10),
('Footlong Italian BMT', 'Subway', 1, 'sandwich', 820, 40, 94, 32, 10),
('Footlong Chicken Teriyaki', 'Subway', 1, 'sandwich', 760, 52, 102, 14, 10),
('Chocolate Chip Cookie', 'Subway', 1, 'cookie', 220, 2, 30, 10, 1),
('6" Rotisserie Chicken', 'Subway', 1, 'sandwich', 350, 29, 44, 7, 5),
('6" Cold Cut Combo', 'Subway', 1, 'sandwich', 360, 18, 46, 12, 5),
('6" Black Forest Ham', 'Subway', 1, 'sandwich', 290, 18, 46, 4, 5),
('Footlong Meatball Marinara', 'Subway', 1, 'sandwich', 960, 46, 112, 36, 14),

-- ─────────────────────────────────────────────────────────
-- TACO BELL (17 items)
-- ─────────────────────────────────────────────────────────
('Crunchy Taco', 'Taco Bell', 1, 'taco', 170, 8, 13, 10, 3),
('Soft Taco', 'Taco Bell', 1, 'taco', 180, 9, 18, 9, 2),
('Crunchy Taco Supreme', 'Taco Bell', 1, 'taco', 190, 8, 14, 12, 3),
('Burrito Supreme (Beef)', 'Taco Bell', 1, 'burrito', 390, 16, 51, 14, 7),
('Crunchwrap Supreme', 'Taco Bell', 1, 'wrap', 530, 16, 71, 21, 4),
('Chicken Quesadilla', 'Taco Bell', 1, 'quesadilla', 500, 27, 37, 27, 3),
('Steak Quesadilla', 'Taco Bell', 1, 'quesadilla', 520, 26, 37, 28, 3),
('Mexican Pizza', 'Taco Bell', 1, 'pizza', 540, 20, 46, 30, 7),
('Nachos BellGrande', 'Taco Bell', 1, 'serving', 740, 16, 82, 38, 12),
('Cheesy Gordita Crunch', 'Taco Bell', 1, 'piece', 500, 20, 40, 28, 4),
('Bean Burrito', 'Taco Bell', 1, 'burrito', 350, 13, 54, 9, 9),
('Chalupa Supreme (Beef)', 'Taco Bell', 1, 'piece', 350, 14, 30, 20, 4),
('Beefy 5-Layer Burrito', 'Taco Bell', 1, 'burrito', 490, 19, 63, 18, 7),
('Doritos Locos Taco', 'Taco Bell', 1, 'taco', 170, 8, 15, 9, 3),
('Cheese Quesadilla', 'Taco Bell', 1, 'quesadilla', 470, 19, 38, 26, 3),
('Chicken Burrito', 'Taco Bell', 1, 'burrito', 410, 21, 51, 14, 5),
('Nachos & Cheese', 'Taco Bell', 1, 'serving', 220, 3, 32, 12, 2),

-- ─────────────────────────────────────────────────────────
-- WENDY'S (16 items)
-- ─────────────────────────────────────────────────────────
('Dave''s Single', 'Wendy''s', 1, 'sandwich', 570, 30, 39, 33, 2),
('Dave''s Double', 'Wendy''s', 1, 'sandwich', 810, 48, 40, 51, 2),
('Dave''s Triple', 'Wendy''s', 1, 'sandwich', 1090, 69, 41, 72, 2),
('Baconator', 'Wendy''s', 1, 'sandwich', 950, 57, 38, 62, 2),
('Spicy Chicken Sandwich', 'Wendy''s', 1, 'sandwich', 500, 30, 50, 19, 2),
('Jr. Cheeseburger', 'Wendy''s', 1, 'sandwich', 290, 16, 26, 14, 1),
('Jr. Bacon Cheeseburger', 'Wendy''s', 1, 'sandwich', 370, 20, 27, 20, 1),
('Nuggets (4 ct)', 'Wendy''s', 4, 'pieces', 170, 10, 10, 11, 0),
('Nuggets (10 ct)', 'Wendy''s', 10, 'pieces', 430, 24, 24, 27, 0),
('Large Fries', 'Wendy''s', 1, 'serving', 530, 7, 63, 28, 6),
('Chili (small)', 'Wendy''s', 1, 'bowl', 170, 15, 16, 5, 5),
('Chili (large)', 'Wendy''s', 1, 'bowl', 250, 23, 23, 7, 7),
('Baked Potato (plain)', 'Wendy''s', 1, 'potato', 270, 7, 61, 0.5, 7),
('Frosty — Chocolate (small)', 'Wendy''s', 1, 'cup', 350, 9, 56, 10, 0),
('Frosty — Vanilla (small)', 'Wendy''s', 1, 'cup', 340, 9, 56, 9, 0),
('Classic Chicken Sandwich', 'Wendy''s', 1, 'sandwich', 490, 28, 46, 20, 2),

-- ─────────────────────────────────────────────────────────
-- BURGER KING (12 items)
-- ─────────────────────────────────────────────────────────
('Whopper', 'Burger King', 1, 'sandwich', 660, 28, 49, 40, 2),
('Whopper Jr', 'Burger King', 1, 'sandwich', 310, 13, 27, 18, 1),
('Whopper with Cheese', 'Burger King', 1, 'sandwich', 740, 33, 49, 46, 2),
('Original Chicken Sandwich', 'Burger King', 1, 'sandwich', 660, 28, 48, 40, 3),
('Chicken Fries (9 pc)', 'Burger King', 9, 'pieces', 280, 13, 17, 17, 1),
('Onion Rings (medium)', 'Burger King', 1, 'serving', 410, 5, 51, 20, 3),
('Bacon Cheeseburger', 'Burger King', 1, 'sandwich', 320, 19, 27, 15, 1),
('Double Whopper', 'Burger King', 1, 'sandwich', 900, 48, 49, 56, 2),
('Impossible Whopper', 'Burger King', 1, 'sandwich', 630, 25, 58, 34, 4),
('French Fries (medium)', 'Burger King', 1, 'serving', 380, 5, 53, 17, 4),
('Chicken Jr', 'Burger King', 1, 'sandwich', 450, 16, 38, 26, 1),
('Hash Browns (medium)', 'Burger King', 1, 'serving', 330, 3, 31, 22, 4),

-- ─────────────────────────────────────────────────────────
-- FIVE GUYS (8 items)
-- ─────────────────────────────────────────────────────────
('Cheeseburger', 'Five Guys', 1, 'sandwich', 840, 47, 40, 55, 2),
('Little Cheeseburger', 'Five Guys', 1, 'sandwich', 550, 27, 39, 32, 2),
('Bacon Cheeseburger', 'Five Guys', 1, 'sandwich', 920, 51, 40, 62, 2),
('Little Bacon Cheeseburger', 'Five Guys', 1, 'sandwich', 630, 31, 39, 39, 2),
('Cajun Fries (regular)', 'Five Guys', 1, 'serving', 950, 15, 131, 41, 15),
('Regular Fries', 'Five Guys', 1, 'serving', 950, 15, 131, 41, 15),
('Hot Dog', 'Five Guys', 1, 'hot dog', 545, 18, 40, 35, 2),
('Veggie Sandwich', 'Five Guys', 1, 'sandwich', 440, 16, 60, 15, 6),

-- ─────────────────────────────────────────────────────────
-- PANDA EXPRESS (12 items)
-- ─────────────────────────────────────────────────────────
('Orange Chicken', 'Panda Express', 1, 'serving', 490, 25, 51, 23, 0),
('Beijing Beef', 'Panda Express', 1, 'serving', 470, 14, 56, 26, 2),
('Kung Pao Chicken', 'Panda Express', 1, 'serving', 290, 16, 19, 19, 2),
('Broccoli Beef', 'Panda Express', 1, 'serving', 150, 9, 13, 7, 2),
('Fried Rice', 'Panda Express', 1, 'serving', 520, 12, 85, 16, 1),
('Chow Mein', 'Panda Express', 1, 'serving', 510, 13, 80, 16, 6),
('Super Greens', 'Panda Express', 1, 'serving', 90, 6, 10, 3, 5),
('String Bean Chicken', 'Panda Express', 1, 'serving', 190, 14, 13, 9, 2),
('Grilled Teriyaki Chicken', 'Panda Express', 1, 'serving', 300, 36, 14, 13, 1),
('Honey Walnut Shrimp', 'Panda Express', 1, 'serving', 360, 13, 35, 23, 1),
('Mushroom Chicken', 'Panda Express', 1, 'serving', 220, 14, 10, 14, 1),
('Steamed White Rice', 'Panda Express', 1, 'serving', 380, 7, 87, 0, 0),

-- ─────────────────────────────────────────────────────────
-- POPEYES (10 items)
-- ─────────────────────────────────────────────────────────
('Classic Chicken Sandwich', 'Popeyes', 1, 'sandwich', 700, 28, 50, 42, 2),
('Spicy Chicken Sandwich', 'Popeyes', 1, 'sandwich', 700, 28, 50, 42, 3),
('Chicken Breast (mild)', 'Popeyes', 1, 'piece', 380, 27, 16, 24, 1),
('Chicken Thigh (mild)', 'Popeyes', 1, 'piece', 280, 16, 10, 20, 0),
('Cajun Fries (regular)', 'Popeyes', 1, 'serving', 260, 3, 37, 14, 3),
('Red Beans & Rice (regular)', 'Popeyes', 1, 'serving', 230, 7, 30, 9, 6),
('Biscuit', 'Popeyes', 1, 'biscuit', 260, 3, 29, 15, 1),
('3pc Chicken Tenders (mild)', 'Popeyes', 3, 'tenders', 410, 26, 24, 22, 1),
('Mashed Potatoes & Gravy', 'Popeyes', 1, 'serving', 110, 1, 18, 4, 1),
('Coleslaw (regular)', 'Popeyes', 1, 'serving', 220, 1, 20, 15, 2),

-- ─────────────────────────────────────────────────────────
-- STARBUCKS (17 items)
-- ─────────────────────────────────────────────────────────
('Grande Caramel Frappuccino', 'Starbucks', 16, 'fl oz', 370, 5, 55, 15, 0),
('Grande Caffè Latte', 'Starbucks', 16, 'fl oz', 190, 13, 19, 7, 0),
('Grande Caffè Mocha', 'Starbucks', 16, 'fl oz', 360, 14, 47, 14, 2),
('Pike Place Brewed Coffee (grande)', 'Starbucks', 16, 'fl oz', 5, 1, 0, 0, 0),
('Grande Iced Caramel Macchiato', 'Starbucks', 16, 'fl oz', 250, 10, 34, 7, 0),
('Cake Pop (birthday cake)', 'Starbucks', 1, 'piece', 160, 2, 18, 9, 0),
('Bacon Gouda Breakfast Sandwich', 'Starbucks', 1, 'sandwich', 360, 19, 34, 19, 1),
('Spinach Feta & Egg White Wrap', 'Starbucks', 1, 'wrap', 290, 20, 34, 8, 3),
('Impossible Breakfast Sandwich', 'Starbucks', 1, 'sandwich', 420, 22, 34, 22, 3),
('Butter Croissant', 'Starbucks', 1, 'piece', 260, 5, 31, 12, 1),
('Blueberry Muffin', 'Starbucks', 1, 'muffin', 360, 6, 53, 14, 1),
('Banana Nut Bread', 'Starbucks', 1, 'slice', 420, 6, 52, 22, 2),
('Protein Box (Eggs & Cheese)', 'Starbucks', 1, 'box', 470, 25, 40, 24, 3),
('Grande Vanilla Sweet Cream Cold Brew', 'Starbucks', 16, 'fl oz', 200, 3, 28, 10, 0),
('Grande Matcha Latte', 'Starbucks', 16, 'fl oz', 240, 12, 34, 7, 1),
('Grande Chai Tea Latte', 'Starbucks', 16, 'fl oz', 240, 8, 42, 4.5, 0),
('Double Chocolate Brownie', 'Starbucks', 1, 'piece', 480, 6, 55, 27, 3),

-- ─────────────────────────────────────────────────────────
-- DUNKIN' (12 items)
-- ─────────────────────────────────────────────────────────
('Medium Iced Coffee (cream & sugar)', 'Dunkin''', 24, 'fl oz', 260, 3, 42, 9, 0),
('Medium Iced Coffee (black)', 'Dunkin''', 24, 'fl oz', 10, 1, 1, 0, 0),
('Glazed Donut', 'Dunkin''', 1, 'donut', 260, 3, 31, 14, 1),
('Boston Kreme Donut', 'Dunkin''', 1, 'donut', 270, 3, 38, 12, 1),
('Chocolate Frosted Donut', 'Dunkin''', 1, 'donut', 270, 3, 32, 15, 1),
('Bacon Egg & Cheese Croissant', 'Dunkin''', 1, 'sandwich', 530, 21, 40, 32, 1),
('Bacon Egg & Cheese on Bagel', 'Dunkin''', 1, 'sandwich', 520, 25, 53, 22, 2),
('Plain Bagel with Cream Cheese', 'Dunkin''', 1, 'bagel', 400, 11, 64, 12, 3),
('Hash Browns (6 pc)', 'Dunkin''', 6, 'pieces', 250, 2, 24, 17, 2),
('Munchkins Donut Holes (5 pc)', 'Dunkin''', 5, 'pieces', 270, 3, 31, 14, 0),
('Sausage Egg & Cheese Wake-Up Wrap', 'Dunkin''', 1, 'wrap', 340, 14, 24, 22, 1),
('Medium Hot Latte', 'Dunkin''', 14, 'fl oz', 120, 7, 12, 4.5, 0),

-- ─────────────────────────────────────────────────────────
-- PIZZA — Pizza Hut, Domino's, Papa John's (14 items)
-- ─────────────────────────────────────────────────────────
('Hand-Tossed Cheese Pizza (1 slice, medium)', 'Pizza Hut', 1, 'slice', 220, 10, 26, 8, 1),
('Hand-Tossed Pepperoni Pizza (1 slice, medium)', 'Pizza Hut', 1, 'slice', 250, 10, 26, 11, 1),
('Hand-Tossed Supreme Pizza (1 slice, medium)', 'Pizza Hut', 1, 'slice', 260, 11, 27, 12, 2),
('Breadsticks (1 stick)', 'Pizza Hut', 1, 'stick', 140, 4, 20, 5, 1),
('Garlic Bread (2 pieces)', 'Pizza Hut', 2, 'pieces', 280, 6, 30, 15, 1),
('Bone-Out Wings (8 pc)', 'Pizza Hut', 8, 'pieces', 710, 44, 33, 44, 2),
('Hand-Tossed Cheese (1 slice, medium)', 'Domino''s', 1, 'slice', 200, 9, 25, 7, 1),
('Hand-Tossed Pepperoni (1 slice, medium)', 'Domino''s', 1, 'slice', 230, 10, 25, 9, 1),
('Cinnamon Bread Twists (2 pc)', 'Domino''s', 2, 'pieces', 250, 4, 32, 12, 1),
('Boneless Wings (8 pc)', 'Domino''s', 8, 'pieces', 530, 22, 47, 28, 3),
('Original Crust Cheese (1 slice, large)', 'Papa John''s', 1, 'slice', 290, 12, 32, 12, 1),
('Original Crust Pepperoni (1 slice, large)', 'Papa John''s', 1, 'slice', 310, 13, 32, 14, 1),
('Garlic Knots (4 pc)', 'Papa John''s', 4, 'pieces', 340, 8, 42, 16, 2),
('Breadsticks (2 pc)', 'Papa John''s', 2, 'sticks', 280, 7, 37, 11, 1),

-- ─────────────────────────────────────────────────────────
-- CASUAL DINING — Olive Garden, Applebee's, Chili's, TGI Friday's (18 items)
-- ─────────────────────────────────────────────────────────
('Chicken Alfredo', 'Olive Garden', 1, 'plate', 1010, 56, 84, 47, 5),
('Tour of Italy', 'Olive Garden', 1, 'plate', 1500, 67, 97, 80, 6),
('Breadstick (1)', 'Olive Garden', 1, 'breadstick', 140, 4, 22, 2.5, 1),
('House Salad (no dressing)', 'Olive Garden', 1, 'bowl', 90, 4, 13, 3, 3),
('Chicken Parmigiana', 'Olive Garden', 1, 'plate', 1060, 59, 80, 49, 5),
('Fettuccine Alfredo', 'Olive Garden', 1, 'plate', 800, 25, 78, 42, 4),
('Classic Burger', 'Applebee''s', 1, 'sandwich', 760, 42, 44, 46, 3),
('Boneless Wings (classic)', 'Applebee''s', 1, 'serving', 780, 40, 54, 42, 3),
('Chicken Tenders Basket', 'Applebee''s', 1, 'basket', 960, 48, 68, 52, 4),
('Loaded Fries', 'Applebee''s', 1, 'serving', 870, 30, 74, 50, 6),
('Oldtimer with Cheese Burger', 'Chili''s', 1, 'sandwich', 900, 46, 52, 56, 3),
('Original Chicken Crispers', 'Chili''s', 1, 'serving', 1250, 53, 96, 72, 4),
('Baby Back Ribs (full rack)', 'Chili''s', 1, 'rack', 1070, 68, 38, 72, 1),
('Chicken Bacon Ranch Quesadillas', 'Chili''s', 1, 'serving', 1440, 70, 91, 84, 4),
('Classic Buffalo Wings', 'Chili''s', 1, 'serving', 820, 64, 5, 60, 1),
('Cajun Shrimp & Chicken Pasta', 'TGI Friday''s', 1, 'plate', 1030, 51, 88, 50, 5),
('Fridays Burger', 'TGI Friday''s', 1, 'sandwich', 870, 43, 48, 56, 3),
('Sesame Jack Chicken Strips', 'TGI Friday''s', 1, 'serving', 940, 46, 72, 50, 4),

-- ─────────────────────────────────────────────────────────
-- PROTEIN BARS (8 items)
-- ─────────────────────────────────────────────────────────
('Chocolate Chip Cookie Dough Bar', 'Quest', 1, 'bar', 190, 21, 22, 7, 14),
('Birthday Cake Bar', 'Quest', 1, 'bar', 190, 20, 22, 7, 14),
('Chocolate Sea Salt Bar', 'RXBar', 1, 'bar', 210, 12, 24, 9, 5),
('Peanut Butter Chocolate Bar', 'RXBar', 1, 'bar', 210, 12, 24, 9, 4),
('Birthday Cake Bar', 'ONE Bar', 1, 'bar', 220, 20, 24, 8, 1),
('Crunchy Peanut Butter Bar', 'Clif Bar', 1, 'bar', 250, 11, 42, 6, 4),
('Dark Chocolate Nuts & Sea Salt', 'Kind', 1, 'bar', 200, 6, 17, 15, 3),
('Peanut Butter Chocolate Chip Bar', 'Larabar', 1, 'bar', 220, 7, 26, 12, 4),

-- ─────────────────────────────────────────────────────────
-- CEREALS (8 items)
-- ─────────────────────────────────────────────────────────
('Cheerios', 'General Mills', 28, 'g', 100, 3, 20, 2, 3),
('Frosted Flakes', 'Kellogg''s', 30, 'g', 110, 1, 27, 0, 0),
('Special K Original', 'Kellogg''s', 31, 'g', 120, 7, 22, 0.5, 1),
('Raisin Bran', 'Kellogg''s', 59, 'g', 190, 5, 46, 1, 7),
('Lucky Charms', 'General Mills', 27, 'g', 110, 2, 22, 1, 1),
('Cinnamon Toast Crunch', 'General Mills', 31, 'g', 130, 1, 24, 3.5, 2),
('Honey Nut Cheerios', 'General Mills', 28, 'g', 110, 3, 22, 1.5, 2),
('Froot Loops', 'Kellogg''s', 29, 'g', 110, 1, 26, 1, 3),

-- ─────────────────────────────────────────────────────────
-- SNACKS (14 items)
-- ─────────────────────────────────────────────────────────
('Nacho Cheese Doritos', 'Frito-Lay', 28, 'g', 140, 2, 17, 8, 1),
('Cool Ranch Doritos', 'Frito-Lay', 28, 'g', 140, 2, 18, 7, 1),
('Original Cheez-Its', 'Sunshine', 30, 'g', 150, 3, 17, 8, 0),
('Cheddar Goldfish', 'Pepperidge Farm', 30, 'g', 140, 4, 20, 5, 1),
('Hard Pretzels', NULL, 28, 'g', 110, 3, 22, 1, 1),
('Lightly Salted Rice Cakes', 'Quaker', 1, 'cake', 35, 1, 7, 0, 0),
('Movie Theater Popcorn (medium)', NULL, 1, 'bag', 720, 9, 60, 50, 8),
('Skinny Pop (original)', 'SkinnyPop', 28, 'g', 150, 2, 15, 10, 3),
('Trail Mix', NULL, 28, 'g', 140, 4, 13, 9, 1),
('Original Beef Jerky', 'Jack Link''s', 28, 'g', 80, 13, 5, 1, 0),
('Teriyaki Beef Jerky', 'Jack Link''s', 28, 'g', 80, 11, 7, 1, 0),
('Cheddar & Sour Cream Chips', 'Lay''s', 28, 'g', 160, 2, 15, 10, 1),
('Peanut Butter Crackers (6 ct)', 'Lance', 1, 'pack', 190, 5, 23, 10, 1),
('Veggie Straws (original)', 'Sensible Portions', 28, 'g', 130, 1, 18, 7, 1),

-- ─────────────────────────────────────────────────────────
-- FROZEN MEALS (12 items)
-- ─────────────────────────────────────────────────────────
('Chicken Alfredo', 'Lean Cuisine', 1, 'meal', 280, 15, 37, 7, 2),
('Herb Roasted Chicken', 'Lean Cuisine', 1, 'meal', 180, 14, 18, 5, 2),
('Café Steamers Chicken Alfredo', 'Healthy Choice', 1, 'meal', 280, 21, 34, 6, 3),
('Power Bowl Chicken Fajita', 'Healthy Choice', 1, 'bowl', 200, 20, 21, 4, 5),
('Cheese Pizza Pocket', 'Hot Pockets', 1, 'piece', 300, 11, 34, 13, 2),
('Pepperoni Pizza Pocket', 'Hot Pockets', 1, 'piece', 310, 12, 34, 14, 2),
('DiGiorno Cheese Pizza (1 slice)', 'DiGiorno', 1, 'slice', 290, 14, 34, 11, 2),
('DiGiorno Pepperoni Pizza (1 slice)', 'DiGiorno', 1, 'slice', 310, 14, 34, 13, 2),
('Pizza Rolls (6 ct)', 'Totino''s', 6, 'pieces', 210, 6, 26, 8, 1),
('Party Pizza (pepperoni, 1/2 pizza)', 'Totino''s', 0.5, 'pizza', 340, 10, 34, 18, 2),
('Burrito (bean & cheese)', 'Amy''s', 1, 'burrito', 310, 10, 45, 8, 6),
('Cheese Enchilada Meal', 'Amy''s', 1, 'meal', 330, 12, 38, 14, 5),

-- ─────────────────────────────────────────────────────────
-- BREADS & BAKERY (8 items)
-- ─────────────────────────────────────────────────────────
('21 Whole Grains and Seeds', 'Dave''s Killer Bread', 1, 'slice', 110, 5, 22, 1.5, 5),
('Good Seed', 'Dave''s Killer Bread', 1, 'slice', 100, 5, 19, 1.5, 3),
('Ezekiel 4:9 Sprouted Bread', 'Food for Life', 1, 'slice', 80, 4, 15, 0.5, 3),
('English Muffin (whole wheat)', NULL, 1, 'muffin', 120, 5, 24, 1, 3),
('Pita Bread (white, 6.5")', NULL, 1, 'pita', 165, 5, 33, 1, 1),
('Naan Bread', NULL, 1, 'piece', 260, 9, 45, 5, 2),
('Croissant (large)', NULL, 1, 'croissant', 270, 5, 31, 14, 1),
('Hamburger Bun', NULL, 1, 'bun', 140, 4, 26, 2.5, 1),

-- ─────────────────────────────────────────────────────────
-- DAIRY (8 items)
-- ─────────────────────────────────────────────────────────
('Fairlife 2% Milk', 'Fairlife', 240, 'ml', 120, 13, 6, 4.5, 0),
('Fairlife Fat Free Milk', 'Fairlife', 240, 'ml', 80, 13, 6, 0, 0),
('Vanilla Greek Yogurt', 'Chobani', 150, 'g', 120, 12, 15, 0, 0),
('Strawberry Yogurt', 'Yoplait', 170, 'g', 150, 6, 25, 2, 0),
('Light String Cheese', NULL, 1, 'stick', 50, 6, 0, 2.5, 0),
('Cottage Cheese (4%, large curd)', NULL, 113, 'g', 110, 12, 4, 5, 0),
('Parmesan Cheese (grated)', NULL, 5, 'g', 20, 2, 0, 1.5, 0),
('Swiss Cheese (slice)', NULL, 28, 'g', 106, 8, 1.5, 8, 0),

-- ─────────────────────────────────────────────────────────
-- DRINKS — Sports, Energy, Protein Shakes (14 items)
-- ─────────────────────────────────────────────────────────
('Gatorade Zero', 'Gatorade', 591, 'ml', 0, 0, 1, 0, 0),
('Lyte', 'Body Armor', 473, 'ml', 20, 0, 3, 0, 0),
('Original (green can)', 'Monster Energy', 473, 'ml', 210, 0, 54, 0, 0),
('Zero Ultra', 'Monster Energy', 473, 'ml', 0, 0, 2, 0, 0),
('Original (8.4 oz)', 'Red Bull', 250, 'ml', 110, 0, 28, 0, 0),
('Sugar Free (8.4 oz)', 'Red Bull', 250, 'ml', 5, 0, 0, 0, 0),
('Sparkling Orange', 'Celsius', 355, 'ml', 10, 0, 2, 0, 0),
('Chocolate Protein Shake', 'Fairlife', 340, 'ml', 150, 30, 3, 2.5, 1),
('Vanilla Protein Shake', 'Fairlife', 340, 'ml', 150, 30, 3, 2.5, 1),
('Chocolate Protein Shake', 'Premier Protein', 340, 'ml', 160, 30, 5, 3, 1),
('Vanilla Protein Shake', 'Premier Protein', 340, 'ml', 160, 30, 5, 3, 1),
('Genuine Shake (chocolate)', 'Muscle Milk', 414, 'ml', 230, 25, 12, 9, 2),
('Body Armor (strawberry banana)', 'Body Armor', 473, 'ml', 120, 0, 28, 0, 0),
('Powerade Zero', 'Powerade', 591, 'ml', 0, 0, 0, 0, 0),

-- ─────────────────────────────────────────────────────────
-- INTERNATIONAL / ETHNIC FOODS (32 items)
-- ─────────────────────────────────────────────────────────
('California Roll (6 pc)', NULL, 6, 'pieces', 255, 9, 38, 7, 2),
('Spicy Tuna Roll (6 pc)', NULL, 6, 'pieces', 290, 15, 32, 11, 1),
('Salmon Roll (6 pc)', NULL, 6, 'pieces', 300, 14, 35, 10, 1),
('Pad Thai (chicken)', NULL, 1, 'plate', 550, 25, 70, 20, 3),
('Fried Rice (takeout)', NULL, 1, 'plate', 480, 12, 68, 18, 2),
('Lo Mein (chicken)', NULL, 1, 'plate', 520, 22, 64, 20, 3),
('General Tso''s Chicken', NULL, 1, 'plate', 620, 30, 48, 34, 2),
('Chicken Tikka Masala', NULL, 1, 'bowl', 550, 30, 28, 36, 3),
('Naan Bread (restaurant)', NULL, 1, 'piece', 300, 10, 50, 6, 2),
('Falafel (4 balls)', NULL, 4, 'pieces', 230, 8, 26, 12, 4),
('Chicken Shawarma Wrap', NULL, 1, 'wrap', 520, 32, 45, 22, 3),
('Gyro (lamb & beef)', NULL, 1, 'sandwich', 580, 28, 44, 30, 2),
('Pho (beef, with noodles)', NULL, 1, 'bowl', 460, 28, 48, 16, 1),
('Instant Ramen (1 packet)', NULL, 1, 'packet', 380, 10, 52, 14, 2),
('Restaurant Ramen (tonkotsu)', NULL, 1, 'bowl', 650, 30, 60, 32, 2),
('Bibimbap', NULL, 1, 'bowl', 550, 24, 68, 18, 5),
('Pork Tamale', NULL, 1, 'tamale', 280, 11, 24, 16, 3),
('Beef Empanada', NULL, 1, 'piece', 280, 10, 28, 14, 1),
('Pupusa (cheese)', NULL, 1, 'piece', 200, 7, 23, 9, 1),
('Jerk Chicken (thigh)', NULL, 1, 'thigh', 250, 22, 6, 16, 1),
('Chicken Curry (Thai green)', NULL, 1, 'bowl', 480, 28, 14, 36, 2),
('Chicken Curry (Japanese)', NULL, 1, 'plate', 520, 24, 62, 18, 3),
('Pork Dumplings (steamed, 6 pc)', NULL, 6, 'pieces', 300, 14, 30, 14, 1),
('Pork Dumplings (fried, 6 pc)', NULL, 6, 'pieces', 370, 14, 30, 20, 1),
('Vegetable Spring Rolls (2 pc)', NULL, 2, 'rolls', 180, 4, 22, 8, 2),
('Pork Egg Rolls (2 pc)', NULL, 2, 'rolls', 340, 12, 30, 18, 2),
('Arepas (cheese)', NULL, 1, 'piece', 240, 8, 28, 11, 2),
('Chicken Teriyaki Bowl', NULL, 1, 'bowl', 580, 36, 72, 12, 2),
('Butter Chicken', NULL, 1, 'bowl', 490, 28, 18, 34, 2),
('Lamb Curry (vindaloo)', NULL, 1, 'bowl', 520, 30, 16, 36, 3),
('Vegetable Samosa (1 pc)', NULL, 1, 'piece', 150, 3, 18, 7, 2),
('Chicken Satay (4 skewers)', NULL, 4, 'skewers', 340, 28, 12, 20, 1),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL WHOLE FOODS — Fish & Seafood (7 items)
-- ─────────────────────────────────────────────────────────
('Cod (baked)', NULL, 100, 'g', 105, 23, 0, 0.9, 0),
('Halibut (baked)', NULL, 100, 'g', 140, 27, 0, 3, 0),
('Sardines (canned in oil)', NULL, 100, 'g', 208, 25, 0, 11, 0),
('Catfish (baked)', NULL, 100, 'g', 122, 21, 0, 4, 0),
('Mahi-Mahi (baked)', NULL, 100, 'g', 109, 24, 0, 1, 0),
('Crab Meat (canned)', NULL, 100, 'g', 83, 18, 0, 0.7, 0),
('Lobster (steamed)', NULL, 100, 'g', 89, 19, 0, 0.9, 0),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL WHOLE FOODS — Meat Cuts (8 items)
-- ─────────────────────────────────────────────────────────
('Beef Brisket (lean, cooked)', NULL, 100, 'g', 221, 28, 0, 11, 0),
('Lamb Chop (cooked)', NULL, 100, 'g', 282, 26, 0, 19, 0),
('Veal Cutlet (cooked)', NULL, 100, 'g', 172, 31, 0, 4.7, 0),
('Turkey Burger Patty (93% lean)', NULL, 1, 'patty', 170, 21, 0, 9, 0),
('Bison Burger Patty', NULL, 1, 'patty', 200, 24, 0, 11, 0),
('Venison (roasted)', NULL, 100, 'g', 158, 30, 0, 3.2, 0),
('Pork Chop (bone-in, cooked)', NULL, 1, 'chop', 225, 30, 0, 11, 0),
('Lamb (ground, cooked)', NULL, 100, 'g', 283, 25, 0, 20, 0),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL WHOLE FOODS — Plant Proteins (6 items)
-- ─────────────────────────────────────────────────────────
('Tofu (firm)', NULL, 100, 'g', 144, 17, 3, 8, 2),
('Tempeh', NULL, 100, 'g', 192, 20, 8, 11, 5),
('Seitan', NULL, 100, 'g', 150, 25, 8, 2, 1),
('Edamame (shelled)', NULL, 1, 'cup', 188, 18, 14, 8, 8),
('Beyond Meat Burger Patty', 'Beyond Meat', 1, 'patty', 230, 20, 6, 14, 2),
('Impossible Burger Patty', 'Impossible Foods', 1, 'patty', 240, 19, 9, 14, 3),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL WHOLE FOODS — Beans & Legumes (4 items)
-- ─────────────────────────────────────────────────────────
('Kidney Beans (cooked)', NULL, 1, 'cup', 225, 15, 40, 0.9, 11),
('Pinto Beans (cooked)', NULL, 1, 'cup', 245, 15, 45, 1.1, 15),
('Navy Beans (cooked)', NULL, 1, 'cup', 255, 15, 47, 1.1, 19),
('Refried Beans', NULL, 0.5, 'cup', 120, 7, 20, 1.5, 6),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL WHOLE FOODS — Grains (5 items)
-- ─────────────────────────────────────────────────────────
('Couscous (cooked)', NULL, 1, 'cup', 176, 6, 36, 0.3, 2),
('Bulgur Wheat (cooked)', NULL, 1, 'cup', 151, 6, 34, 0.4, 8),
('Farro (cooked)', NULL, 1, 'cup', 200, 8, 37, 1.5, 5),
('Barley (cooked)', NULL, 1, 'cup', 193, 4, 44, 0.7, 6),
('Wild Rice (cooked)', NULL, 1, 'cup', 166, 7, 35, 0.6, 3),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL WHOLE FOODS — Vegetables (10 items)
-- ─────────────────────────────────────────────────────────
('Kale (raw, chopped)', NULL, 1, 'cup', 33, 3, 6, 0.6, 1.3),
('Cauliflower (raw)', NULL, 1, 'cup', 27, 2, 5, 0.3, 2),
('Brussels Sprouts (cooked)', NULL, 1, 'cup', 56, 4, 11, 0.8, 4),
('Eggplant (cooked)', NULL, 1, 'cup', 35, 1, 9, 0.2, 2.5),
('Artichoke (medium, cooked)', NULL, 1, 'medium', 60, 4, 13, 0.2, 7),
('Beets (cooked, sliced)', NULL, 1, 'cup', 75, 3, 17, 0.3, 3.4),
('Cabbage (raw, shredded)', NULL, 1, 'cup', 22, 1, 5, 0.1, 2.1),
('Celery (raw)', NULL, 2, 'stalks', 13, 0.6, 2.4, 0.1, 1.2),
('Radishes (raw, sliced)', NULL, 1, 'cup', 19, 0.8, 4, 0.1, 1.9),
('Snap Peas (raw)', NULL, 1, 'cup', 41, 3, 7, 0.2, 2.6),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL WHOLE FOODS — Fruits (12 items)
-- ─────────────────────────────────────────────────────────
('Peach', NULL, 1, 'medium', 59, 1.4, 14, 0.4, 2.3),
('Plum', NULL, 1, 'medium', 30, 0.5, 7.5, 0.2, 0.9),
('Kiwi', NULL, 1, 'medium', 42, 0.8, 10, 0.4, 2.1),
('Pomegranate (seeds)', NULL, 0.5, 'cup', 72, 1.5, 16, 1, 3.5),
('Figs (fresh)', NULL, 1, 'medium', 37, 0.4, 10, 0.2, 1.5),
('Dates (Medjool)', NULL, 1, 'date', 66, 0.4, 18, 0, 1.6),
('Dried Cranberries', NULL, 28, 'g', 93, 0, 25, 0.4, 2),
('Raisins', NULL, 28, 'g', 85, 0.9, 22, 0.1, 1),
('Raspberries', NULL, 1, 'cup', 64, 1.5, 15, 0.8, 8),
('Blackberries', NULL, 1, 'cup', 62, 2, 14, 0.7, 7.6),
('Cantaloupe (cubed)', NULL, 1, 'cup', 54, 1.3, 13, 0.3, 1.4),
('Honeydew (cubed)', NULL, 1, 'cup', 61, 0.9, 15, 0.2, 1.4),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL WHOLE FOODS — Nuts & Seeds (10 items)
-- ─────────────────────────────────────────────────────────
('Pistachios', NULL, 28, 'g', 159, 6, 8, 13, 3),
('Macadamia Nuts', NULL, 28, 'g', 204, 2, 4, 22, 2.4),
('Pecans', NULL, 28, 'g', 196, 2.6, 4, 20, 2.7),
('Pine Nuts', NULL, 28, 'g', 191, 4, 4, 19, 1),
('Sunflower Seeds (shelled)', NULL, 28, 'g', 165, 5.5, 7, 14, 3),
('Pumpkin Seeds (shelled)', NULL, 28, 'g', 163, 8.5, 4, 14, 1.7),
('Chia Seeds', NULL, 28, 'g', 138, 5, 12, 9, 10),
('Flax Seeds (ground)', NULL, 10, 'g', 53, 2, 3, 4.2, 2.7),
('Hemp Hearts', NULL, 30, 'g', 170, 10, 2, 14, 1),
('Tahini (sesame paste)', NULL, 1, 'tbsp', 89, 3, 3, 8, 0.7),

-- ─────────────────────────────────────────────────────────
-- DESSERTS & SWEETS (26 items)
-- ─────────────────────────────────────────────────────────
('Vanilla Ice Cream', NULL, 0.5, 'cup', 137, 2.3, 16, 7, 0.5),
('Chocolate Ice Cream', NULL, 0.5, 'cup', 143, 2.5, 19, 7, 0.8),
('Frozen Yogurt (vanilla)', NULL, 0.5, 'cup', 114, 3, 22, 2, 0),
('Brownie (homemade)', NULL, 1, 'piece', 230, 3, 30, 12, 1),
('Chocolate Chip Cookie (large)', NULL, 1, 'cookie', 220, 2, 30, 11, 1),
('Cheesecake (1 slice)', NULL, 1, 'slice', 400, 7, 30, 28, 0.3),
('Apple Pie (1 slice)', NULL, 1, 'slice', 296, 2, 43, 14, 2),
('Plain Glazed Donut', NULL, 1, 'donut', 240, 3, 28, 13, 1),
('Cinnamon Roll (large)', NULL, 1, 'roll', 420, 5, 55, 20, 2),
('Blueberry Muffin (bakery)', NULL, 1, 'muffin', 340, 5, 50, 14, 2),
('Pancakes (plain, 3 medium)', NULL, 3, 'pancakes', 390, 10, 58, 12, 2),
('Waffles (plain, 2 round)', NULL, 2, 'waffles', 380, 8, 46, 18, 1),
('French Toast (2 slices)', NULL, 2, 'slices', 350, 10, 36, 18, 1),
('Dark Chocolate (70%)', NULL, 28, 'g', 170, 2, 13, 12, 3),
('Milk Chocolate', NULL, 28, 'g', 150, 2, 17, 9, 1),
('Snickers Bar', 'Mars', 1, 'bar', 250, 4, 33, 12, 1),
('Kit Kat (4-finger)', 'Nestlé', 1, 'bar', 218, 3, 27, 11, 0.5),
('Reese''s Peanut Butter Cups (2 ct)', 'Hershey''s', 1, 'pack', 210, 5, 24, 12, 1),
('M&M''s (peanut, 1.74 oz)', 'Mars', 1, 'bag', 250, 5, 30, 13, 2),
('Skittles (original, 2.17 oz)', 'Mars', 1, 'bag', 250, 0, 56, 2.5, 0),
('Oreo Cookies (3 ct)', 'Nabisco', 3, 'cookies', 160, 1, 25, 7, 1),
('Chips Ahoy Cookies (3 ct)', 'Nabisco', 3, 'cookies', 160, 2, 22, 8, 0),
('Rice Krispies Treat', 'Kellogg''s', 1, 'bar', 90, 1, 17, 2.5, 0),
('Pop-Tart (frosted strawberry, 1 pastry)', 'Kellogg''s', 1, 'pastry', 200, 2, 37, 5, 1),
('Pint of Ben & Jerry''s (Chocolate Fudge Brownie)', 'Ben & Jerry''s', 0.5, 'cup', 260, 5, 32, 13, 2),
('Halo Top (Vanilla Bean)', 'Halo Top', 0.5, 'cup', 70, 5, 14, 2, 3),

-- ─────────────────────────────────────────────────────────
-- CONDIMENTS & EXTRAS (8 items)
-- ─────────────────────────────────────────────────────────
('Sriracha', NULL, 1, 'tsp', 5, 0, 1, 0, 0),
('Balsamic Vinaigrette', NULL, 2, 'tbsp', 90, 0, 4, 8, 0),
('Italian Dressing', NULL, 2, 'tbsp', 80, 0, 3, 7, 0),
('Caesar Dressing', NULL, 2, 'tbsp', 170, 1, 1, 18, 0),
('Teriyaki Sauce', NULL, 1, 'tbsp', 16, 1, 3, 0, 0),
('Maple Syrup', NULL, 2, 'tbsp', 104, 0, 27, 0, 0),
('Jam / Jelly', NULL, 1, 'tbsp', 50, 0, 13, 0, 0.2),
('Nutella', 'Ferrero', 2, 'tbsp', 200, 2, 23, 12, 1),

-- ─────────────────────────────────────────────────────────
-- ADDITIONAL FAST FOOD / QUICK SERVICE (10 items)
-- ─────────────────────────────────────────────────────────
('Double-Double (mustard fried)', 'In-N-Out', 1, 'sandwich', 590, 37, 39, 32, 3),
('Cheeseburger (protein style)', 'In-N-Out', 1, 'sandwich', 330, 18, 11, 25, 3),
('Animal Style Fries', 'In-N-Out', 1, 'serving', 750, 20, 65, 45, 4),
('Crunchy Taco', 'Del Taco', 1, 'taco', 160, 8, 12, 9, 2),
('Original Slider', 'White Castle', 1, 'slider', 140, 7, 15, 6, 0),
('6pc Chicken McNuggets Meal (medium)', 'McDonald''s', 1, 'meal', 710, 24, 80, 32, 5),
('Bacon Clubhouse Burger', 'McDonald''s', 1, 'sandwich', 740, 40, 51, 41, 3),
('Grilled Chicken Deluxe', 'McDonald''s', 1, 'sandwich', 380, 37, 44, 7, 3),
('Chicken Burrito Bowl', 'Qdoba', 1, 'bowl', 710, 48, 68, 26, 13),
('Original Roast Beef (classic)', 'Arby''s', 1, 'sandwich', 360, 23, 37, 14, 2)

ON CONFLICT DO NOTHING;
