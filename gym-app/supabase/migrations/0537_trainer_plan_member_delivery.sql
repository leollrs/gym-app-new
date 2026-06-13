-- ============================================================
-- 0537 — Trainer plan member delivery (P0-2)
-- ============================================================
-- trainer_workout_plans / trainer_meal_plans were trainer-only surfaces:
-- an assigned plan produced NOTHING in the client's app — no viewer (fixed
-- client-side in this batch: TrainerPlanSection / TrainerMealPlanSection),
-- no notification, and meal-plan macro targets never reached the member's
-- nutrition_targets. This migration wires the server half:
--
--   1. New notification types: 'plan_assigned' + 'meal_plan_assigned'.
--   2. (Defensive) re-assert the client SELECT policies from 0036/0193.
--      VERIFIED present in the migration chain (0036 trainer_plans_client_select,
--      0193 trainer_meal_plans_client_select; 0211/0291 only replaced the
--      trainer FOR ALL policies) — guarded CREATEs below protect drifted envs.
--   3. Notify + push the client when a plan is assigned (INSERT active) or
--      re-activated (is_active false→true), via _notify_push (0440).
--   4. Sync the client's nutrition_targets from a newly assigned/activated
--      meal plan's macro targets. Member can still edit their targets later —
--      this only writes at assign/reactivation time.
--
-- notifications.type is the notification_type ENUM (0001), not a CHECK —
-- extended with ADD VALUE IF NOT EXISTS. New values are only cast at runtime
-- inside function bodies (same PG15-safe pattern as 0442), so adding + using
-- them in one migration is safe.
--
-- DEPENDS ON 0440 (public._notify_push). Apply after 0440.
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'plan_assigned';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'meal_plan_assigned';

-- ── 1. Defensive client SELECT policies (no-op when 0036/0193 intact) ──────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_workout_plans'
      AND policyname = 'trainer_plans_client_select'
  ) THEN
    CREATE POLICY "trainer_plans_client_select" ON trainer_workout_plans
      FOR SELECT TO authenticated
      USING (client_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trainer_meal_plans'
      AND policyname = 'trainer_meal_plans_client_select'
  ) THEN
    CREATE POLICY "trainer_meal_plans_client_select" ON trainer_meal_plans
      FOR SELECT TO authenticated
      USING (client_id = auth.uid());
  END IF;
END $$;

-- ── 2. Workout plan assigned/reactivated → notify the client ───────────────
-- Dedup is per plan per day: editing an active plan never re-fires (UPDATE
-- trigger only watches is_active), and a same-day deactivate/reactivate
-- flip-flop can't spam, but a genuine later re-activation re-notifies.
CREATE OR REPLACE FUNCTION public.fire_member_plan_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned BOOLEAN := FALSE;
  v_trainer  TEXT;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_assigned := TRUE;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    v_assigned := TRUE;
  END IF;
  IF NOT v_assigned OR NEW.client_id IS NULL OR NEW.client_id = NEW.trainer_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NULL) INTO v_trainer
  FROM profiles WHERE id = NEW.trainer_id;

  PERFORM public._notify_push(
    NEW.client_id, NEW.gym_id, 'member'::user_role, 'plan_assigned'::notification_type,
    'New plan from your coach',
    COALESCE(v_trainer, 'Your coach') || ' assigned you a plan: ' || NEW.name || '. Check it out in Workouts.',
    'Tu coach te asignó un plan',
    COALESCE(v_trainer, 'Tu coach') || ' te asignó un plan: ' || NEW.name || '. Míralo en Entrenamientos.',
    jsonb_build_object('route', '/workouts', 'plan_id', NEW.id, 'trainer_id', NEW.trainer_id),
    'plan_assigned_' || NEW.id::text || '_' || to_char(now(), 'YYYYMMDD')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_member_plan_assigned failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_plan_assigned_ins ON trainer_workout_plans;
CREATE TRIGGER trg_member_plan_assigned_ins
  AFTER INSERT ON trainer_workout_plans
  FOR EACH ROW EXECUTE FUNCTION fire_member_plan_assigned();

DROP TRIGGER IF EXISTS trg_member_plan_assigned_upd ON trainer_workout_plans;
CREATE TRIGGER trg_member_plan_assigned_upd
  AFTER UPDATE OF is_active ON trainer_workout_plans
  FOR EACH ROW EXECUTE FUNCTION fire_member_plan_assigned();

-- ── 3. Meal plan assigned/reactivated → notify the client ──────────────────
CREATE OR REPLACE FUNCTION public.fire_member_meal_plan_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned BOOLEAN := FALSE;
  v_trainer  TEXT;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_assigned := TRUE;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    v_assigned := TRUE;
  END IF;
  IF NOT v_assigned OR NEW.client_id IS NULL OR NEW.client_id = NEW.trainer_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NULL) INTO v_trainer
  FROM profiles WHERE id = NEW.trainer_id;

  PERFORM public._notify_push(
    NEW.client_id, NEW.gym_id, 'member'::user_role, 'meal_plan_assigned'::notification_type,
    'New meal plan from your coach',
    COALESCE(v_trainer, 'Your coach') || ' assigned you a meal plan: ' || NEW.name || '. Check it out in Nutrition.',
    'Tu coach te asignó un plan de comidas',
    COALESCE(v_trainer, 'Tu coach') || ' te asignó un plan de comidas: ' || NEW.name || '. Míralo en Nutrición.',
    jsonb_build_object('route', '/nutrition', 'meal_plan_id', NEW.id, 'trainer_id', NEW.trainer_id),
    'meal_plan_assigned_' || NEW.id::text || '_' || to_char(now(), 'YYYYMMDD')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_member_meal_plan_assigned failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_meal_plan_assigned_ins ON trainer_meal_plans;
CREATE TRIGGER trg_member_meal_plan_assigned_ins
  AFTER INSERT ON trainer_meal_plans
  FOR EACH ROW EXECUTE FUNCTION fire_member_meal_plan_assigned();

DROP TRIGGER IF EXISTS trg_member_meal_plan_assigned_upd ON trainer_meal_plans;
CREATE TRIGGER trg_member_meal_plan_assigned_upd
  AFTER UPDATE OF is_active ON trainer_meal_plans
  FOR EACH ROW EXECUTE FUNCTION fire_member_meal_plan_assigned();

-- ── 4. Meal plan assigned/reactivated → sync client nutrition_targets ──────
-- nutrition_targets (0001): profile_id PK, gym_id NOT NULL, daily_calories,
-- daily_protein_g, daily_carbs_g, daily_fat_g, calculation_method, updated_at.
-- trainer_meal_plans target_* columns map 1:1. COALESCE on conflict keeps any
-- existing value when the trainer left a macro blank. calculation_method
-- 'trainer_plan' marks the row's provenance; the member's macro editor
-- overwrites freely afterwards (this trigger only fires on assign/reactivate).
CREATE OR REPLACE FUNCTION public.fire_sync_targets_from_meal_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned BOOLEAN := FALSE;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_assigned := TRUE;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    v_assigned := TRUE;
  END IF;
  IF NOT v_assigned OR NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Nothing to sync if the trainer set no targets at all.
  IF NEW.target_calories IS NULL AND NEW.target_protein_g IS NULL
     AND NEW.target_carbs_g IS NULL AND NEW.target_fat_g IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO nutrition_targets (
    profile_id, gym_id, daily_calories, daily_protein_g, daily_carbs_g, daily_fat_g,
    calculation_method, updated_at
  )
  VALUES (
    NEW.client_id, NEW.gym_id, NEW.target_calories, NEW.target_protein_g,
    NEW.target_carbs_g, NEW.target_fat_g, 'trainer_plan', now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    daily_calories     = COALESCE(EXCLUDED.daily_calories,  nutrition_targets.daily_calories),
    daily_protein_g    = COALESCE(EXCLUDED.daily_protein_g, nutrition_targets.daily_protein_g),
    daily_carbs_g      = COALESCE(EXCLUDED.daily_carbs_g,   nutrition_targets.daily_carbs_g),
    daily_fat_g        = COALESCE(EXCLUDED.daily_fat_g,     nutrition_targets.daily_fat_g),
    calculation_method = 'trainer_plan',
    updated_at         = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A sync failure must never roll back the plan save.
  RAISE LOG 'fire_sync_targets_from_meal_plan failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_targets_from_meal_plan_ins ON trainer_meal_plans;
CREATE TRIGGER trg_sync_targets_from_meal_plan_ins
  AFTER INSERT ON trainer_meal_plans
  FOR EACH ROW EXECUTE FUNCTION fire_sync_targets_from_meal_plan();

DROP TRIGGER IF EXISTS trg_sync_targets_from_meal_plan_upd ON trainer_meal_plans;
CREATE TRIGGER trg_sync_targets_from_meal_plan_upd
  AFTER UPDATE OF is_active ON trainer_meal_plans
  FOR EACH ROW EXECUTE FUNCTION fire_sync_targets_from_meal_plan();

NOTIFY pgrst, 'reload schema';
