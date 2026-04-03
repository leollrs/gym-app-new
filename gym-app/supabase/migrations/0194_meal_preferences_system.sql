-- =============================================================
-- MEAL PREFERENCE LEARNING + DIETARY RESTRICTIONS
-- Migration: 0194_meal_preferences_system.sql
-- =============================================================

-- ── 1. Add dietary columns to member_onboarding ──────────────
ALTER TABLE member_onboarding
  ADD COLUMN IF NOT EXISTS dietary_restrictions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS food_allergies       TEXT[] DEFAULT '{}';

COMMENT ON COLUMN member_onboarding.dietary_restrictions IS 'e.g. vegan, vegetarian, pescatarian, keto, gluten_free, dairy_free, halal';
COMMENT ON COLUMN member_onboarding.food_allergies       IS 'e.g. nuts, shellfish, dairy, eggs, soy, wheat, fish';

-- ── 2. Meal ratings table (thumbs up/down on suggestions) ────
CREATE TABLE IF NOT EXISTS meal_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id)     ON DELETE CASCADE,
  meal_id     TEXT NOT NULL,                        -- references local meal data IDs (r1, r2, etc.)
  rating      SMALLINT NOT NULL CHECK (rating IN (-1, 1)),  -- -1 = dislike, 1 = like
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(profile_id, meal_id)                      -- one rating per meal per user (upsertable)
);

CREATE INDEX idx_meal_ratings_profile ON meal_ratings(profile_id);

ALTER TABLE meal_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_ratings_own" ON meal_ratings
  FOR ALL TO authenticated
  USING  (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- Trainers can read client ratings
CREATE POLICY "meal_ratings_trainer_read" ON meal_ratings
  FOR SELECT TO authenticated
  USING (public.is_trainer_of(profile_id));

-- ── 3. Ingredient affinities (learned preferences) ──────────
-- Computed periodically from meal_ratings + food_logs + disliked_foods
CREATE TABLE IF NOT EXISTS ingredient_affinities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id)     ON DELETE CASCADE,
  ingredient  TEXT NOT NULL,
  score       REAL NOT NULL DEFAULT 0,              -- -1.0 (hate) to +1.0 (love)
  sample_count INT NOT NULL DEFAULT 0,              -- how many interactions informed this score
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(profile_id, ingredient)
);

CREATE INDEX idx_ingredient_affinities_profile ON ingredient_affinities(profile_id);

ALTER TABLE ingredient_affinities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingredient_affinities_own" ON ingredient_affinities
  FOR ALL TO authenticated
  USING  (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- ── 4. Generated meal plans storage ──────────────────────────
-- Stores the onboarding-generated (or re-generated) weekly meal plan
CREATE TABLE IF NOT EXISTS generated_meal_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id)     ON DELETE CASCADE,
  week_start  DATE NOT NULL,
  plan_data   JSONB NOT NULL,                       -- full 7-day plan with meals + macros
  macro_targets JSONB,                              -- { calories, protein, carbs, fat }
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(profile_id, week_start)
);

CREATE INDEX idx_generated_meal_plans_profile ON generated_meal_plans(profile_id) WHERE is_active = TRUE;

ALTER TABLE generated_meal_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generated_meal_plans_own" ON generated_meal_plans
  FOR ALL TO authenticated
  USING  (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "generated_meal_plans_trainer_read" ON generated_meal_plans
  FOR SELECT TO authenticated
  USING (public.is_trainer_of(profile_id));
