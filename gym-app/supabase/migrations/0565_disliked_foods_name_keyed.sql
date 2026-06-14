-- ════════════════════════════════════════════════════════════════════
-- Fix: "foods to avoid" never saved
-- ════════════════════════════════════════════════════════════════════
-- disliked_foods was created (0055) keyed on food_item_id (UUID FK to
-- food_items, NOT NULL) with UNIQUE(profile_id, food_item_id). But the
-- meal-preference system stores ingredient SLUGS (e.g. 'broccoli',
-- 'shellfish'), not food_items rows. Both writers — the onboarding diet
-- step (Onboarding.jsx) and the My Plan preferences sheet (Nutrition.jsx
-- MealPrefsSheet) — plus the affinity engine (lib/mealPreferences.js)
-- write/read a `food_name` TEXT column + `gym_id` and upsert with
-- onConflict (profile_id, food_name). Those columns + constraint never
-- existed, so every disliked-foods write threw (caught + swallowed) →
-- the user-visible "ingredients to avoid don't save".
--
-- Reshape to name-keyed, mirroring food_favorites (0321). Idempotent —
-- safe whether or not the columns/constraint already exist.

ALTER TABLE disliked_foods ADD COLUMN IF NOT EXISTS food_name TEXT;
ALTER TABLE disliked_foods ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;

-- Ingredient slugs have no food_items row, so food_item_id is now optional.
ALTER TABLE disliked_foods ALTER COLUMN food_item_id DROP NOT NULL;

-- Swap the id-keyed uniqueness for the name-keyed one the upserts target.
-- (A unique index satisfies ON CONFLICT (profile_id, food_name).)
ALTER TABLE disliked_foods DROP CONSTRAINT IF EXISTS disliked_foods_profile_id_food_item_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS disliked_foods_profile_food_name_key
  ON disliked_foods (profile_id, food_name);

-- RLS (0055) already grants owners full access:
--   CREATE POLICY "Users own disliked foods" ON disliked_foods
--     FOR ALL USING (profile_id = auth.uid());
-- FOR ALL with USING (and no explicit WITH CHECK) also gates INSERT via the
-- defaulted WITH CHECK, so name-keyed inserts by the owner are allowed.
-- gym_id is informational; no policy change needed.
