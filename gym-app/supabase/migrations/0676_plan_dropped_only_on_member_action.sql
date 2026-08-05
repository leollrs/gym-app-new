-- 0676_plan_dropped_only_on_member_action.sql
--
-- Tightens 0675. That trigger fired on ANY authenticated delete of an adopted
-- coach program that wasn't the trainer's own — which swept up two paths that
-- are not a member leaving a plan:
--
--   · `delete_user_account()` (0106) is SECURITY DEFINER on `auth.uid()` and
--     deletes generated_programs at line 36. A member closing their account
--     would send their coach "a client left your plan — check in with them"
--     about someone whose profile is being deleted in the same transaction.
--   · An admin removing a member from the gym is likewise not the member
--     deciding anything, and the coach would get the same misleading nudge
--     pointing at a client row that is about to vanish.
--
-- The notification only makes sense for one event: the member themselves
-- choosing to stop following the plan, while remaining a member. So require
-- BOTH — the actor is the owner of the program, and that profile still exists.
--
-- Everything else in 0675 is unchanged and still applies (skip the trainer's
-- own action, skip service-role/cron, skip a switch to another coach plan).

CREATE OR REPLACE FUNCTION public.fire_trainer_plan_dropped()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id   UUID;
  v_trainer   UUID;
  v_plan_name TEXT;
  v_member    TEXT;
  v_actor     UUID := auth.uid();
BEGIN
  v_plan_id := NULLIF(OLD.schedule_map ->> 'trainer_plan_id', '')::UUID;
  IF v_plan_id IS NULL THEN
    RETURN OLD;                      -- not a coach program
  END IF;

  -- The row must have been LIVE. releaseTrainerPlan deletes every adopted
  -- program the member ever had, with no expiry filter
  -- (trainerPlanAdoption.js:382) — and adopting a second coach's plan EXPIRES
  -- the first rather than deleting it, so those old rows are still sitting in
  -- the table. Without this, one "Leave program" tap in August fires once per
  -- historical row: the coach whose plan the member left back in January is
  -- told "Maria stopped following Plan A. Check in with them." The per-plan
  -- dedup key cannot collapse that, because each row carries a different
  -- plan_id. A coach should only ever hear about a plan the member was
  -- actually on.
  IF OLD.expires_at IS NULL OR OLD.expires_at <= now() THEN
    RETURN OLD;
  END IF;

  -- ONLY the member's own decision. This single check replaces 0675's looser
  -- "any actor that isn't the trainer" rule and covers account deletion and
  -- admin removal in one go: in both, the actor is not the program's owner.
  IF v_actor IS NULL OR v_actor <> OLD.profile_id THEN
    RETURN OLD;
  END IF;

  -- ...and they must still BE a member. A self-delete has the actor matching
  -- the owner, so only the profile's continued existence separates "I'm
  -- stopping this plan" from "I'm closing my account".
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.profile_id) THEN
    RETURN OLD;
  END IF;

  SELECT trainer_id, name INTO v_trainer, v_plan_name
    FROM trainer_workout_plans WHERE id = v_plan_id;

  IF v_trainer IS NULL OR v_trainer = v_actor THEN
    RETURN OLD;                      -- plan gone, or the coach is the member
  END IF;

  -- Switching between two of the coach's plans is not leaving: adoption INSERTs
  -- the replacement before DELETEing the old row (trainerPlanAdoption.js:254
  -- then :274), so a live adopted program here means they moved, not left.
  IF EXISTS (
    SELECT 1 FROM generated_programs g
     WHERE g.profile_id = OLD.profile_id
       AND g.id <> OLD.id
       AND g.expires_at > now()
       AND NULLIF(g.schedule_map ->> 'trainer_plan_id', '') IS NOT NULL
  ) THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Un miembro') INTO v_member
    FROM profiles WHERE id = OLD.profile_id;

  PERFORM public._notify_push(
    v_trainer, OLD.gym_id, 'trainer'::user_role, 'plan_assigned'::notification_type,
    'A client left your plan',
    COALESCE(v_member, 'A client') || ' stopped following ' || COALESCE(v_plan_name, 'your plan') || '. Check in with them.',
    'Un cliente dejó tu plan',
    COALESCE(v_member, 'Un cliente') || ' dejó de seguir ' || COALESCE(v_plan_name, 'tu plan') || '. Habla con esa persona.',
    jsonb_build_object('route', '/trainer/clients', 'plan_id', v_plan_id,
                       'member_id', OLD.profile_id, 'dropped', true),
    'plan_dropped_' || v_plan_id::text || '_' || OLD.profile_id::text || '_' || to_char(now(), 'YYYYMMDD')
  );

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- Never block the delete: a plpgsql EXCEPTION block is a subtransaction, so
  -- propagating would roll back the member's action over a failed notification.
  RETURN OLD;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Verify — only the first should produce a notification:
--   1) member taps "Leave program" on an adopted coach plan  → 1 notification
--   2) member deletes their own account                      → none
--   3) admin removes that member from the gym                → none
--   4) trainer unassigns the client                          → none
--   5) member adopts a different plan from the same coach    → none
--
--   SELECT profile_id, title, dedup_key, created_at FROM notifications
--    WHERE dedup_key LIKE 'plan_dropped_%' ORDER BY created_at DESC LIMIT 10;
