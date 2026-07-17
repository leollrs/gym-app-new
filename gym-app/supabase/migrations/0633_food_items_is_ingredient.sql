-- 0633 — carve a clean "ingredients" list out of food_items.
--
-- `food_items` accumulated three seeds over time: 0048 generics, 0064 branded
-- restaurant products (Panera/IHOP/sodas), and barcode/AI-scan inserts — a mix
-- of raw ingredients AND prepared meals AND near-duplicates. The member's
-- Log Food search should offer only real single INGREDIENTS (chicken, cheese,
-- rice, peppers…), not meals or that junk.
--
-- Rather than a physically separate `ingredients` table (which would break the
-- hard `food_logs.food_item_id -> food_items(id)` FK on every ingredient log
-- and force a new join across every food-log read), we partition food_items
-- with a flag. Log Food filters `is_ingredient = true`; everything else stays
-- exactly where it is:
--   * existing food logs keep their FK,
--   * barcode/AI scans keep inserting (default false → hidden from the picker,
--     still visible under Recent/Favorites),
--   * the old junk is retained but no longer surfaces in the ingredient search.
--
-- Curated ingredient rows land in 0634 with image_url = '/ingredients/<slug>.jpg'
-- (the new food-images/ingredients/ folder). Additive + idempotent.

ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS is_ingredient boolean NOT NULL DEFAULT false;

-- Coarse group the Log Food "ingredient palette" tabs by (protein / carb / veg /
-- fruit / dairy / fat). Nullable — only curated ingredient rows carry it.
ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS ingredient_category text;

-- Narrows the ingredient picker to the curated subset (table is small, but this
-- keeps the filtered search cheap and intent explicit).
CREATE INDEX IF NOT EXISTS idx_food_items_is_ingredient
  ON public.food_items (is_ingredient) WHERE is_ingredient;
