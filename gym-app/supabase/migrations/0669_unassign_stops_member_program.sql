-- 0669_unassign_stops_member_program.sql
-- purpose: when a trainer takes a plan away, STOP it on the member's side.
--
-- Adopting a coach's plan materializes it into the member's own structures —
-- a generated_programs row (schedule_map.trainer_plan_id records which plan),
-- routines, and workout_schedule. Unassigning only removed the junction row
-- and cleared trainer_workout_plans.client_id, both of which the member's app
-- stops reading the moment the plan is materialized. So:
--
--   trainer sees "unassigned"
--   member keeps training the plan — hero, week strip, overload engine
--   the member can no longer even SELECT the plan it came from
--
-- Only the member could undo it, and only if they noticed. This closes it on
-- the server, where the revocation actually happens.
--
-- Deliberately NOT destructive: the materialized program is EXPIRED, not
-- deleted, and the routines are left alone. Expiring is how every other
-- "program ended" path in this schema behaves — the member keeps the history
-- and can still resume it from My Programs if they want to.

CREATE OR REPLACE FUNCTION public.stop_member_adopted_plan(
  p_member_id UUID,
  p_plan_id   UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_member_id IS NULL OR p_plan_id IS NULL THEN RETURN; END IF;

  -- Still assigned by the OTHER store? Then this was not a revocation.
  IF EXISTS (
    SELECT 1 FROM trainer_plan_members
     WHERE plan_id = p_plan_id AND member_id = p_member_id
  ) OR EXISTS (
    SELECT 1 FROM trainer_workout_plans
     WHERE id = p_plan_id AND client_id = p_member_id
  ) THEN
    RETURN;
  END IF;

  UPDATE generated_programs
     SET expires_at = now()
   WHERE profile_id = p_member_id
     AND expires_at > now()
     AND schedule_map ->> 'trainer_plan_id' = p_plan_id::text;

  -- The week strip reads workout_schedule directly, so a stopped program must
  -- not keep feeding it.
  DELETE FROM workout_schedule
   WHERE profile_id = p_member_id
     AND routine_id IN (
       SELECT (jsonb_array_elements_text(COALESCE(gp.schedule_map -> 'routine_ids', '[]'::jsonb)))::uuid
         FROM generated_programs gp
        WHERE gp.profile_id = p_member_id
          AND gp.schedule_map ->> 'trainer_plan_id' = p_plan_id::text
     );

  UPDATE profiles
     SET active_trainer_plan_id = NULL
   WHERE id = p_member_id
     AND active_trainer_plan_id = p_plan_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stop_member_adopted_plan(UUID, UUID) FROM PUBLIC;

-- ── Junction row removed → stop it for that member ────────────────────────
CREATE OR REPLACE FUNCTION public.fire_plan_member_removed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.stop_member_adopted_plan(OLD.member_id, OLD.plan_id);
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_plan_member_removed failed (plan %, member %): %', OLD.plan_id, OLD.member_id, SQLERRM;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan_member_removed ON public.trainer_plan_members;
CREATE TRIGGER trg_plan_member_removed
  AFTER DELETE ON public.trainer_plan_members
  FOR EACH ROW EXECUTE FUNCTION public.fire_plan_member_removed();

-- ── client_id cleared / moved, or the plan deactivated ────────────────────
CREATE OR REPLACE FUNCTION public.fire_plan_client_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  -- Legacy primary assignee dropped or moved to someone else.
  IF OLD.client_id IS NOT NULL AND OLD.client_id IS DISTINCT FROM NEW.client_id THEN
    PERFORM public.stop_member_adopted_plan(OLD.client_id, OLD.id);
  END IF;

  -- Plan retired entirely → stop it for everyone still on it.
  IF OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE THEN
    FOR r IN SELECT member_id FROM trainer_plan_members WHERE plan_id = NEW.id LOOP
      -- The junction row still exists here, so the guard inside
      -- stop_member_adopted_plan would bail — expire directly instead.
      UPDATE generated_programs
         SET expires_at = now()
       WHERE profile_id = r.member_id
         AND expires_at > now()
         AND schedule_map ->> 'trainer_plan_id' = NEW.id::text;
      UPDATE profiles SET active_trainer_plan_id = NULL
       WHERE id = r.member_id AND active_trainer_plan_id = NEW.id;
    END LOOP;
    IF NEW.client_id IS NOT NULL THEN
      UPDATE generated_programs
         SET expires_at = now()
       WHERE profile_id = NEW.client_id
         AND expires_at > now()
         AND schedule_map ->> 'trainer_plan_id' = NEW.id::text;
      UPDATE profiles SET active_trainer_plan_id = NULL
       WHERE id = NEW.client_id AND active_trainer_plan_id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_plan_client_changed failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan_client_changed ON public.trainer_workout_plans;
CREATE TRIGGER trg_plan_client_changed
  AFTER UPDATE OF client_id, is_active ON public.trainer_workout_plans
  FOR EACH ROW EXECUTE FUNCTION public.fire_plan_client_changed();

NOTIFY pgrst, 'reload schema';
