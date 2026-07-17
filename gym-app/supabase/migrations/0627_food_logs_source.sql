-- 0627 — food_logs.source: record HOW a log was created so the UI can tell an
-- AI-photo estimate apart from a recipe logged from the app's own library, a
-- barcode scan, a food-DB pick, or a manual entry. Before this, "AI-logged" was
-- inferred as `food_item_id IS NULL`, which also matched every recipe/menu log —
-- so recipes from our list were wrongly shown as "AI identified".
-- Additive + nullable (legacy rows stay NULL → treated as non-AI). Values:
-- 'ai' | 'barcode' | 'recipe' | 'menu_scan' | 'food_db' | 'manual'.
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS source TEXT;
