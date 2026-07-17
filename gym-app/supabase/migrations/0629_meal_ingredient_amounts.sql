-- 0629 — meals.ingredient_amounts: per-ingredient quantities ("6 oz", "1 cup",
-- "1 tbsp"), index-aligned with the existing `ingredients` token array so the
-- recipe detail can show HOW MUCH of each ingredient, not just what. Kept as a
-- PARALLEL array (not merged into `ingredients`) so the token-based pantry
-- filtering keeps matching on clean tokens. Nullable/additive — recipes without
-- amounts just render the ingredient name alone until backfilled (migration 0630).
ALTER TABLE meals ADD COLUMN IF NOT EXISTS ingredient_amounts TEXT[];
