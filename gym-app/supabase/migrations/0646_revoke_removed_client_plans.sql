-- ============================================================
-- 0646 — Removing a client revokes their assigned plans
-- ============================================================
-- Removing a client deactivates the trainer_clients relationship
-- (is_active → false). Their assigned workout/meal plans should go with them:
-- otherwise an ex-client keeps seeing the plans in their app. This trigger
-- drops the removed client from the trainer's plan junctions (0644/0645) and,
-- where they were the legacy PRIMARY (client_id), promotes a remaining shared
-- member (or NULL → the plan becomes an unassigned template).
--
-- Additive + idempotent. DEPENDS ON 0644 + 0645 (the junction tables).
-- Scoped to (trainer_id, client_id) of the deactivated row — no cross-tenant reach.
-- ============================================================

CREATE OR REPLACE FUNCTION public.revoke_removed_client_plans()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only on a genuine active → inactive transition.
  IF NOT (OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE) THEN
    RETURN NEW;
  END IF;

  -- 1. Drop the client from this trainer's plan junctions (revokes access).
  DELETE FROM trainer_plan_members tpm
  USING trainer_workout_plans p
  WHERE tpm.plan_id = p.id
    AND p.trainer_id = NEW.trainer_id
    AND tpm.member_id = NEW.client_id;

  DELETE FROM trainer_meal_plan_members tmpm
  USING trainer_meal_plans mp
  WHERE tmpm.plan_id = mp.id
    AND mp.trainer_id = NEW.trainer_id
    AND tmpm.member_id = NEW.client_id;

  -- 2. Where the removed client was the PRIMARY, promote a remaining junction
  --    member (ordered by when they were assigned) or NULL if none remain.
  UPDATE trainer_workout_plans p SET
    client_id  = (SELECT member_id FROM trainer_plan_members
                  WHERE plan_id = p.id ORDER BY assigned_at LIMIT 1),
    updated_at = now()
  WHERE p.trainer_id = NEW.trainer_id AND p.client_id = NEW.client_id;

  UPDATE trainer_meal_plans mp SET
    client_id  = (SELECT member_id FROM trainer_meal_plan_members
                  WHERE plan_id = mp.id ORDER BY assigned_at LIMIT 1),
    updated_at = now()
  WHERE mp.trainer_id = NEW.trainer_id AND mp.client_id = NEW.client_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the client-removal itself.
  RAISE LOG 'revoke_removed_client_plans failed (trainer %, client %): %', NEW.trainer_id, NEW.client_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revoke_removed_client_plans ON public.trainer_clients;
CREATE TRIGGER trg_revoke_removed_client_plans
  AFTER UPDATE OF is_active ON public.trainer_clients
  FOR EACH ROW EXECUTE FUNCTION public.revoke_removed_client_plans();

NOTIFY pgrst, 'reload schema';
