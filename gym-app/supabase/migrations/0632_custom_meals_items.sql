-- 0632 — remember the composition of a member-built custom meal.
--
-- custom_meals already stores the by-value macro totals (calories/protein_g/…)
-- so plans and logs never need to read component foods. But when a member
-- BUILDS a meal from foods + portions, we want to keep that ingredient list so
-- the meal can be shown with its foods and edited later (add/remove a food,
-- change a portion) instead of only ever showing frozen totals.
--
-- `items` is an ordered JSON array, each entry:
--   { "food_item_id": uuid|null, "name": text, "servings": number,
--     "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number }
-- Nullable + additive: existing manually-entered custom meals (macros only)
-- keep working with items = NULL. Safe to re-run.

ALTER TABLE public.custom_meals
  ADD COLUMN IF NOT EXISTS items jsonb;
