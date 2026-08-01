-- 0668_notify_plan_updated.sql
-- purpose: tell the members ON a plan when their coach CHANGES it.
--
-- 0537/0644/0645 notify on assignment. Nothing notified on edit — a coach could
-- rewrite next week's sessions or swap every meal and the member would only
-- find out by opening the app and noticing.
--
-- Reuses the existing notification types rather than extending the enum: the
-- payload and copy differ, the channel doesn't. The dedup key is per
-- (plan, member, day), so a coach editing all afternoon produces ONE
-- notification per member per day, not one per keystroke-save.
--
-- Fires only on a real content change (weeks / meals), only while the plan is
-- active, and never notifies the trainer about their own edit.

-- ───────────────────────────────────────────────────────────────
-- Workout plans
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_plan_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainer TEXT;
  r         RECORD;
BEGIN
  IF NEW.is_active IS NOT TRUE OR COALESCE(NEW.is_draft, FALSE) THEN
    RETURN NEW;
  END IF;
  -- Content only. Renames, activation flips and assignment changes all have
  -- their own notifications (or deliberately have none).
  IF NEW.weeks IS NOT DISTINCT FROM OLD.weeks THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NULL) INTO v_trainer
  FROM profiles WHERE id = NEW.trainer_id;

  FOR r IN
    SELECT member_id FROM trainer_plan_members
     WHERE plan_id = NEW.id AND member_id <> NEW.trainer_id
    UNION
    -- Aliased: without `AS member_id` the second branch's column is unnamed and
    -- `r.member_id` below would not resolve.
    SELECT NEW.client_id AS member_id
     WHERE NEW.client_id IS NOT NULL AND NEW.client_id <> NEW.trainer_id
  LOOP
    PERFORM public._notify_push(
      r.member_id, NEW.gym_id, 'member'::user_role, 'plan_assigned'::notification_type,
      'Your coach updated your plan',
      COALESCE(v_trainer, 'Your coach') || ' made changes to ' || NEW.name || '. Take a look in Workouts.',
      'Tu coach actualizó tu plan',
      COALESCE(v_trainer, 'Tu coach') || ' hizo cambios en ' || NEW.name || '. Míralo en Entrenamientos.',
      jsonb_build_object('route', '/workouts', 'plan_id', NEW.id, 'trainer_id', NEW.trainer_id, 'updated', true),
      'plan_updated_' || NEW.id::text || '_' || r.member_id::text || '_' || to_char(now(), 'YYYYMMDD')
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_plan_updated failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan_updated ON public.trainer_workout_plans;
CREATE TRIGGER trg_plan_updated
  AFTER UPDATE OF weeks ON public.trainer_workout_plans
  FOR EACH ROW EXECUTE FUNCTION public.fire_plan_updated();

-- ───────────────────────────────────────────────────────────────
-- Meal plans
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_meal_plan_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainer TEXT;
  r         RECORD;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF NEW.meals IS NOT DISTINCT FROM OLD.meals THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NULL) INTO v_trainer
  FROM profiles WHERE id = NEW.trainer_id;

  FOR r IN
    SELECT member_id FROM trainer_meal_plan_members
     WHERE plan_id = NEW.id AND member_id <> NEW.trainer_id
    UNION
    -- Aliased: without `AS member_id` the second branch's column is unnamed and
    -- `r.member_id` below would not resolve.
    SELECT NEW.client_id AS member_id
     WHERE NEW.client_id IS NOT NULL AND NEW.client_id <> NEW.trainer_id
  LOOP
    PERFORM public._notify_push(
      r.member_id, NEW.gym_id, 'member'::user_role, 'meal_plan_assigned'::notification_type,
      'Your coach updated your meal plan',
      COALESCE(v_trainer, 'Your coach') || ' made changes to ' || NEW.name || '. Take a look in Nutrition.',
      'Tu coach actualizó tu plan de comidas',
      COALESCE(v_trainer, 'Tu coach') || ' hizo cambios en ' || NEW.name || '. Míralo en Nutrición.',
      jsonb_build_object('route', '/nutrition', 'meal_plan_id', NEW.id, 'trainer_id', NEW.trainer_id, 'updated', true),
      'meal_plan_updated_' || NEW.id::text || '_' || r.member_id::text || '_' || to_char(now(), 'YYYYMMDD')
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_meal_plan_updated failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meal_plan_updated ON public.trainer_meal_plans;
CREATE TRIGGER trg_meal_plan_updated
  AFTER UPDATE OF meals ON public.trainer_meal_plans
  FOR EACH ROW EXECUTE FUNCTION public.fire_meal_plan_updated();

NOTIFY pgrst, 'reload schema';
