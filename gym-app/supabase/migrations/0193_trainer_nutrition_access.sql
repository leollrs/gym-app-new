-- =============================================================
-- TRAINER NUTRITION ACCESS + MEAL PLANS
-- Migration: 0193_trainer_nutrition_access.sql
-- =============================================================

-- ── 1. Trainer meal plans table ──────────────────────────────
CREATE TABLE IF NOT EXISTS trainer_meal_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  trainer_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  name            TEXT NOT NULL DEFAULT 'Custom Plan',
  description     TEXT,

  -- Trainer-set macro targets
  target_calories INT,
  target_protein_g INT,
  target_carbs_g  INT,
  target_fat_g    INT,

  -- Optional structured meals (JSONB)
  -- Format: { "meals": [{ "name": "Breakfast", "items": [...] }] }
  meals           JSONB DEFAULT '[]'::jsonb,

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trainer_meal_plans_trainer ON trainer_meal_plans(trainer_id, client_id);
CREATE INDEX idx_trainer_meal_plans_client  ON trainer_meal_plans(client_id) WHERE is_active = TRUE;

ALTER TABLE trainer_meal_plans ENABLE ROW LEVEL SECURITY;

-- Trainers manage their own meal plans
CREATE POLICY "trainer_meal_plans_trainer_all" ON trainer_meal_plans
  FOR ALL
  TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

-- Clients can view their assigned meal plans
CREATE POLICY "trainer_meal_plans_client_select" ON trainer_meal_plans
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

-- Admins can view all meal plans in their gym
CREATE POLICY "trainer_meal_plans_admin_select" ON trainer_meal_plans
  FOR SELECT
  TO authenticated
  USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

-- ── 2. Trainer access to nutrition data ──────────────────────
-- Allow trainers to read their clients' nutrition targets
CREATE POLICY "nutrition_targets_trainer_read" ON nutrition_targets
  FOR SELECT
  TO authenticated
  USING (public.is_trainer_of(profile_id));

-- Allow trainers to read their clients' food logs
CREATE POLICY "food_logs_trainer_read" ON food_logs
  FOR SELECT
  TO authenticated
  USING (public.is_trainer_of(profile_id));

-- Allow trainers to read their clients' meal plans
CREATE POLICY "meal_plans_trainer_read" ON meal_plans
  FOR SELECT
  TO authenticated
  USING (public.is_trainer_of(profile_id));

-- ── 3. Trainer access to progress photos ─────────────────────
CREATE POLICY "progress_photos_trainer_read" ON progress_photos
  FOR SELECT
  TO authenticated
  USING (public.is_trainer_of(profile_id));

-- ── 4. Trainer access to check-ins ───────────────────────────
CREATE POLICY "check_ins_trainer_read" ON check_ins
  FOR SELECT
  TO authenticated
  USING (public.is_trainer_of(profile_id));
