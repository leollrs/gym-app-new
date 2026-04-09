-- =============================================================
-- 0291 — Fix trainer RLS policies missing gym_id enforcement
--
-- Problem S1: Migration 0274 recreated the trainer_clients INSERT
-- policy without the gym_id check that existed in migration 0029.
-- This allows a trainer to insert a row with any gym_id, enabling
-- them to claim clients from other gyms.
--
-- Problem S2: Migration 0193 created the trainer_meal_plans write
-- policy without a gym_id check. A trainer can insert or update
-- meal plans with a gym_id belonging to a different gym.
--
-- Fix: Recreate both policies with AND gym_id = public.current_gym_id()
-- in the WITH CHECK clause, scoping all writes to the trainer's
-- own gym.
-- =============================================================


-- ── S1: trainer_clients INSERT policy ────────────────────────
-- Drop the policy added in 0274 that is missing the gym_id guard.
DROP POLICY IF EXISTS "trainer_clients_insert_trainer" ON trainer_clients;

-- Recreate with gym_id enforcement so a trainer can only add
-- client relationships inside their own gym.
CREATE POLICY "trainer_clients_insert_trainer" ON trainer_clients
  FOR INSERT WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );


-- ── S2: trainer_meal_plans ALL policy ────────────────────────
-- Drop the policy added in 0193 that is missing the gym_id guard
-- on writes.
DROP POLICY IF EXISTS "trainer_meal_plans_trainer_all" ON trainer_meal_plans;

-- Recreate with gym_id enforcement on WITH CHECK so a trainer
-- can only create or modify meal plans within their own gym.
-- The USING clause (reads) intentionally keeps trainer_id only —
-- a trainer should still be able to read plans they created even
-- if their gym assignment changes, but writes are strictly scoped.
CREATE POLICY "trainer_meal_plans_trainer_all" ON trainer_meal_plans
  FOR ALL
  TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );


-- ── Reload PostgREST schema cache ─────────────────────────────
NOTIFY pgrst, 'reload schema';
