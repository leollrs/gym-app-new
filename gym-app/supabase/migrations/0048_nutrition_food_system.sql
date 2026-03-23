-- ═══════════════════════════════════════════════════════════
-- NUTRITION FOOD SYSTEM
-- Food database, food logs, saved meals, favorites
-- ═══════════════════════════════════════════════════════════

-- ── Food items (searchable database) ──────────────────────
CREATE TABLE IF NOT EXISTS food_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  brand           TEXT,
  serving_size    NUMERIC NOT NULL DEFAULT 100,
  serving_unit    TEXT NOT NULL DEFAULT 'g',
  calories        NUMERIC NOT NULL DEFAULT 0,
  protein_g       NUMERIC NOT NULL DEFAULT 0,
  carbs_g         NUMERIC NOT NULL DEFAULT 0,
  fat_g           NUMERIC NOT NULL DEFAULT 0,
  fiber_g         NUMERIC DEFAULT 0,
  barcode         TEXT,
  is_verified     BOOLEAN DEFAULT true,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_food_items_name ON food_items USING gin(to_tsvector('english', name));
CREATE INDEX idx_food_items_barcode ON food_items(barcode) WHERE barcode IS NOT NULL;

-- ── Food logs (what the user actually ate) ────────────────
CREATE TABLE IF NOT EXISTS food_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  food_item_id    UUID REFERENCES food_items(id) ON DELETE SET NULL,
  custom_name     TEXT,
  meal_type       TEXT NOT NULL DEFAULT 'snack',
  log_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  servings        NUMERIC NOT NULL DEFAULT 1,
  calories        NUMERIC NOT NULL DEFAULT 0,
  protein_g       NUMERIC NOT NULL DEFAULT 0,
  carbs_g         NUMERIC NOT NULL DEFAULT 0,
  fat_g           NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_food_logs_profile_date ON food_logs(profile_id, log_date);

-- ── Favorite foods ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_foods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  food_item_id    UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, food_item_id)
);

-- ── Saved meals (groups of foods) ─────────────────────────
CREATE TABLE IF NOT EXISTS saved_meals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_meal_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id         UUID NOT NULL REFERENCES saved_meals(id) ON DELETE CASCADE,
  food_item_id    UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  servings        NUMERIC NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS ───────────────────────────────────────────────────
ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorite_foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_meal_items ENABLE ROW LEVEL SECURITY;

-- Food items: everyone can read, users can insert custom
CREATE POLICY "Anyone can read food items" ON food_items FOR SELECT USING (true);
CREATE POLICY "Users can insert custom foods" ON food_items FOR INSERT WITH CHECK (created_by = auth.uid());

-- Food logs: own data only
CREATE POLICY "Users own food logs" ON food_logs FOR ALL USING (profile_id = auth.uid());

-- Favorites: own data only
CREATE POLICY "Users own favorites" ON favorite_foods FOR ALL USING (profile_id = auth.uid());

-- Saved meals: own data only
CREATE POLICY "Users own saved meals" ON saved_meals FOR ALL USING (profile_id = auth.uid());
CREATE POLICY "Users read own meal items" ON saved_meal_items FOR SELECT
  USING (meal_id IN (SELECT id FROM saved_meals WHERE profile_id = auth.uid()));
CREATE POLICY "Users insert own meal items" ON saved_meal_items FOR INSERT
  WITH CHECK (meal_id IN (SELECT id FROM saved_meals WHERE profile_id = auth.uid()));
CREATE POLICY "Users delete own meal items" ON saved_meal_items FOR DELETE
  USING (meal_id IN (SELECT id FROM saved_meals WHERE profile_id = auth.uid()));

-- ── Seed common foods ─────────────────────────────────────
INSERT INTO food_items (name, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) VALUES
-- Proteins
('Chicken Breast (cooked)', 100, 'g', 165, 31, 0, 3.6, 0),
('Chicken Thigh (cooked)', 100, 'g', 209, 26, 0, 10.9, 0),
('Ground Turkey (93% lean)', 100, 'g', 170, 21, 0, 9.4, 0),
('Ground Beef (90% lean)', 100, 'g', 217, 26, 0, 12, 0),
('Ground Beef (80% lean)', 100, 'g', 254, 24, 0, 17, 0),
('Salmon Fillet (cooked)', 100, 'g', 208, 20, 0, 13, 0),
('Tuna (canned in water)', 100, 'g', 116, 26, 0, 0.8, 0),
('Shrimp (cooked)', 100, 'g', 99, 24, 0, 0.3, 0),
('Tilapia (cooked)', 100, 'g', 128, 26, 0, 2.7, 0),
('Pork Tenderloin (cooked)', 100, 'g', 143, 26, 0, 3.5, 0),
('Steak — Sirloin (cooked)', 100, 'g', 206, 26, 0, 10.6, 0),
('Steak — Ribeye (cooked)', 100, 'g', 291, 24, 0, 21, 0),
('Turkey Breast (deli)', 2, 'slices', 60, 12, 1, 0.5, 0),
('Bacon (cooked)', 2, 'slices', 86, 6, 0.2, 6.7, 0),
('Sausage Link (pork)', 1, 'link', 170, 9, 1, 14, 0),

-- Eggs & Dairy
('Egg (whole, large)', 1, 'large', 72, 6, 0.4, 5, 0),
('Egg White', 1, 'large', 17, 3.6, 0.2, 0.1, 0),
('Greek Yogurt (plain, 0%)', 170, 'g', 100, 17, 6, 0.7, 0),
('Greek Yogurt (plain, 2%)', 170, 'g', 130, 17, 7, 3.5, 0),
('Cottage Cheese (2%)', 113, 'g', 90, 12, 5, 2.5, 0),
('Milk (whole)', 240, 'ml', 149, 8, 12, 8, 0),
('Milk (2%)', 240, 'ml', 122, 8, 12, 5, 0),
('Milk (skim)', 240, 'ml', 83, 8, 12, 0.2, 0),
('Cheese — Cheddar', 28, 'g', 113, 7, 0.4, 9, 0),
('Cheese — Mozzarella', 28, 'g', 85, 6, 0.7, 6, 0),
('Butter', 14, 'g', 102, 0.1, 0, 11.5, 0),
('Cream Cheese', 28, 'g', 99, 1.7, 1.6, 9.8, 0),

-- Grains & Starches
('White Rice (cooked)', 1, 'cup', 206, 4.3, 45, 0.4, 0.6),
('Brown Rice (cooked)', 1, 'cup', 216, 5, 45, 1.8, 3.5),
('Jasmine Rice (cooked)', 1, 'cup', 205, 4.2, 45, 0.4, 0.6),
('Quinoa (cooked)', 1, 'cup', 222, 8, 39, 3.6, 5),
('Pasta (cooked)', 1, 'cup', 220, 8, 43, 1.3, 2.5),
('Bread — White', 1, 'slice', 79, 2.7, 15, 1, 0.6),
('Bread — Whole Wheat', 1, 'slice', 81, 4, 14, 1.1, 1.9),
('Tortilla — Flour (8")', 1, 'tortilla', 140, 3.5, 24, 3.5, 1),
('Tortilla — Corn', 1, 'tortilla', 52, 1.4, 11, 0.7, 1.5),
('Oatmeal (dry)', 40, 'g', 150, 5, 27, 2.5, 4),
('Bagel (plain)', 1, 'bagel', 270, 10, 53, 1.5, 2),
('Potato (baked, medium)', 1, 'medium', 161, 4.3, 37, 0.2, 3.8),
('Sweet Potato (baked, medium)', 1, 'medium', 103, 2.3, 24, 0.1, 3.8),

-- Fruits
('Banana', 1, 'medium', 105, 1.3, 27, 0.4, 3.1),
('Apple', 1, 'medium', 95, 0.5, 25, 0.3, 4.4),
('Orange', 1, 'medium', 62, 1.2, 15, 0.2, 3.1),
('Blueberries', 1, 'cup', 84, 1.1, 21, 0.5, 3.6),
('Strawberries', 1, 'cup', 49, 1, 12, 0.5, 3),
('Grapes', 1, 'cup', 104, 1.1, 27, 0.2, 1.4),
('Avocado', 0.5, 'avocado', 120, 1.5, 6, 11, 5),
('Mango', 1, 'cup', 99, 1.4, 25, 0.6, 2.6),
('Watermelon', 1, 'cup', 46, 0.9, 11, 0.2, 0.6),
('Pineapple', 1, 'cup', 82, 0.9, 22, 0.2, 2.3),

-- Vegetables
('Broccoli (cooked)', 1, 'cup', 55, 3.7, 11, 0.6, 5.1),
('Spinach (raw)', 1, 'cup', 7, 0.9, 1.1, 0.1, 0.7),
('Mixed Salad Greens', 2, 'cups', 18, 1.5, 3.5, 0.2, 1.5),
('Carrots (raw)', 1, 'medium', 25, 0.6, 6, 0.1, 1.7),
('Bell Pepper', 1, 'medium', 31, 1, 6, 0.3, 2.1),
('Tomato', 1, 'medium', 22, 1.1, 4.8, 0.2, 1.5),
('Cucumber', 0.5, 'cucumber', 23, 1, 3.8, 0.3, 1),
('Green Beans (cooked)', 1, 'cup', 44, 2.4, 10, 0.4, 4),
('Asparagus (cooked)', 6, 'spears', 20, 2.2, 3.7, 0.2, 1.8),
('Corn (cooked)', 1, 'ear', 88, 3.3, 19, 1.4, 2),
('Mushrooms (raw)', 1, 'cup', 15, 2.2, 2.3, 0.2, 0.7),
('Onion (raw)', 0.5, 'medium', 22, 0.6, 5.2, 0.1, 0.8),
('Zucchini (cooked)', 1, 'cup', 27, 2, 5, 0.4, 1.9),

-- Legumes & Nuts
('Black Beans (cooked)', 1, 'cup', 227, 15, 41, 0.9, 15),
('Chickpeas (cooked)', 1, 'cup', 269, 15, 45, 4.2, 12.5),
('Lentils (cooked)', 1, 'cup', 230, 18, 40, 0.8, 15.6),
('Peanut Butter', 2, 'tbsp', 188, 7, 7, 16, 1.6),
('Almond Butter', 2, 'tbsp', 196, 7, 6, 18, 3.3),
('Almonds', 28, 'g', 164, 6, 6, 14, 3.5),
('Walnuts', 28, 'g', 185, 4.3, 3.9, 18, 1.9),
('Cashews', 28, 'g', 157, 5.2, 8.6, 12, 0.9),
('Mixed Nuts', 28, 'g', 172, 5, 6, 15, 2),

-- Supplements
('Whey Protein Shake', 1, 'scoop', 120, 24, 3, 1.5, 0),
('Casein Protein Shake', 1, 'scoop', 120, 24, 3, 1, 0),
('Mass Gainer Shake', 1, 'scoop', 650, 30, 110, 8, 3),
('Protein Bar (average)', 1, 'bar', 210, 20, 22, 7, 3),
('Creatine Monohydrate', 1, 'scoop', 0, 0, 0, 0, 0),
('BCAA Powder', 1, 'scoop', 10, 2.5, 0, 0, 0),

-- Oils & Fats
('Olive Oil', 1, 'tbsp', 119, 0, 0, 13.5, 0),
('Coconut Oil', 1, 'tbsp', 121, 0, 0, 13.5, 0),
('Cooking Spray (PAM)', 1, 'spray', 0, 0, 0, 0, 0),

-- Condiments & Sauces
('Honey', 1, 'tbsp', 64, 0.1, 17, 0, 0),
('Soy Sauce', 1, 'tbsp', 9, 0.9, 1, 0, 0),
('Hot Sauce', 1, 'tsp', 0, 0, 0, 0, 0),
('Ketchup', 1, 'tbsp', 20, 0.2, 5, 0, 0),
('Mustard', 1, 'tsp', 3, 0.2, 0.3, 0.2, 0.2),
('Ranch Dressing', 2, 'tbsp', 129, 0.4, 1.8, 13, 0),
('Salsa', 2, 'tbsp', 10, 0.5, 2, 0, 0.5),
('Hummus', 2, 'tbsp', 70, 2, 4, 5, 1),
('Guacamole', 2, 'tbsp', 50, 0.6, 3, 4.5, 2),
('BBQ Sauce', 2, 'tbsp', 60, 0, 14, 0, 0),
('Mayonnaise', 1, 'tbsp', 94, 0.1, 0.1, 10, 0),

-- Drinks
('Water', 240, 'ml', 0, 0, 0, 0, 0),
('Black Coffee', 240, 'ml', 2, 0.3, 0, 0, 0),
('Orange Juice', 240, 'ml', 112, 1.7, 26, 0.5, 0.5),
('Coca-Cola', 355, 'ml', 140, 0, 39, 0, 0),
('Diet Coke', 355, 'ml', 0, 0, 0, 0, 0),
('Gatorade', 355, 'ml', 80, 0, 21, 0, 0),
('Almond Milk (unsweetened)', 240, 'ml', 30, 1, 1, 2.5, 0),
('Oat Milk', 240, 'ml', 120, 3, 16, 5, 2),

-- Common Meals (pre-built)
('Chicken & Rice Bowl', 1, 'bowl', 450, 40, 50, 8, 2),
('Protein Smoothie', 1, 'serving', 300, 30, 35, 5, 4),
('Turkey Sandwich', 1, 'sandwich', 350, 28, 36, 10, 3),
('Steak & Potatoes', 1, 'plate', 550, 42, 40, 22, 4),
('Salmon & Veggies', 1, 'plate', 400, 35, 15, 20, 5),
('Egg & Toast Breakfast', 1, 'serving', 310, 18, 28, 14, 2),
('Overnight Oats', 1, 'serving', 350, 15, 55, 8, 6),
('Tuna Salad', 1, 'serving', 280, 30, 8, 14, 3),
('Burrito Bowl', 1, 'bowl', 520, 35, 55, 15, 10),
('Greek Yogurt Parfait', 1, 'serving', 280, 20, 38, 5, 3)
ON CONFLICT DO NOTHING;

-- Add height_inches and age to onboarding if not present
ALTER TABLE member_onboarding
  ADD COLUMN IF NOT EXISTS height_inches NUMERIC,
  ADD COLUMN IF NOT EXISTS age INT,
  ADD COLUMN IF NOT EXISTS sex TEXT DEFAULT 'male';
