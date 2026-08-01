-- 0665_revert_0664_duplicate_plan_notify.sql
-- purpose: undo 0664, which should never have shipped.
--
-- 0664 added junction assign-notify triggers that 0644/0645 ALREADY provide
-- (fire_member_plan_shared / fire_member_meal_plan_shared, plus
-- fire_shared_members_on_activate for the draft→publish fan-out). It was
-- written from 0537 alone, without checking that a later migration had already
-- covered the junction. Pure duplication — except for one real defect:
--
-- 0664 also did CREATE OR REPLACE on fire_member_plan_assigned() and
-- fire_member_meal_plan_assigned(), adding a fan-out loop over the junction
-- that did NOT skip the primary assignee. 0537's client_id notification uses
-- the dedup key
--     plan_assigned_<plan>_<date>            (no member segment)
-- while the junction path uses
--     plan_assigned_<plan>_<member>_<date>
-- so for a plan whose client_id is ALSO a junction row, the two keys differ,
-- ON CONFLICT DO NOTHING never engages, and that member gets the same
-- "new plan from your coach" notification TWICE. 0644's own junction trigger
-- avoids exactly this by skipping member_id = client_id.
--
-- The redundant triggers were harmless (identical dedup keys → deduped). The
-- replaced functions were not. This restores both to their 0537 definitions
-- verbatim and removes everything else 0664 created.
--
-- Safe to run whether or not 0664 was applied: every drop is IF EXISTS and the
-- two functions are restored to the definition they already had otherwise.

-- ── 1. Remove 0664's duplicate junction triggers + functions ───────────────
DROP TRIGGER IF EXISTS trg_plan_member_assigned_ins ON public.trainer_plan_members;
DROP TRIGGER IF EXISTS trg_meal_plan_member_assigned_ins ON public.trainer_meal_plan_members;

DROP FUNCTION IF EXISTS public.fire_plan_member_assigned();
DROP FUNCTION IF EXISTS public.fire_meal_plan_member_assigned();
DROP FUNCTION IF EXISTS public._notify_workout_plan_member(UUID, UUID);
DROP FUNCTION IF EXISTS public._notify_meal_plan_member(UUID, UUID);

-- ── 2. Restore fire_member_plan_assigned() — verbatim from 0537 ────────────
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

-- ── 3. Restore fire_member_meal_plan_assigned() — verbatim from 0537 ───────
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

-- The triggers themselves (trg_member_plan_assigned_ins/_upd and the meal
-- equivalents) were never dropped by 0664 — only the functions behind them
-- were replaced — so they now point back at the restored bodies. Nothing to
-- re-create here.

NOTIFY pgrst, 'reload schema';
