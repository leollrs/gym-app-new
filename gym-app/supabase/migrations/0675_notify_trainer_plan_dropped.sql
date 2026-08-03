-- 0675_notify_trainer_plan_dropped.sql
-- purpose: tell a COACH when their client walks away from the plan they built.
--
-- 0668 notifies the member when the coach edits a plan. The reverse direction
-- never existed: a member could drop an assigned plan and the trainer would
-- only find out by opening the client's page and noticing the program was gone.
-- For a trainer who charges for follow-up, that is the single most important
-- signal the app can give them, and it was the one thing it stayed quiet about.
--
-- WHY A TRIGGER AND NOT CLIENT CODE: the drop happens in releaseTrainerPlan()
-- on the member's device, but the same rows are also deleted by
-- trg_revoke_removed_client_plans (0646) and by a coach reassigning. Hanging
-- the notification off the DELETE means it fires from every path, and can't be
-- skipped by an app build that forgot to call it.
--
-- Reuses the `plan_assigned` notification type instead of extending the enum,
-- for the same reason 0668 did: the payload and the copy differ, the channel
-- does not — and a value added by ALTER TYPE ... ADD VALUE cannot be used in
-- the transaction that adds it, which would force this into two blocks for no
-- benefit. The audience is 'trainer', which is what routes it correctly.

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
  -- Only materialized COACH programs. A member deleting one of their own
  -- generated programs is nobody else's business.
  v_plan_id := NULLIF(OLD.schedule_map ->> 'trainer_plan_id', '')::UUID;
  IF v_plan_id IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT trainer_id, name INTO v_trainer, v_plan_name
    FROM trainer_workout_plans WHERE id = v_plan_id;

  IF v_trainer IS NULL THEN
    RETURN OLD;                      -- plan already gone; nothing to notify
  END IF;

  -- Never tell the trainer about their own action. This fires on the coach's
  -- own reassign path and on trg_revoke_removed_client_plans (0646), which runs
  -- when the COACH removes the client — they know, they just did it.
  IF v_actor IS NOT NULL AND v_actor = v_trainer THEN
    RETURN OLD;
  END IF;

  -- No authenticated actor means a cron / service-role cascade, not a member
  -- decision. Staying quiet is the safe default: a false "your client quit"
  -- is worse for a coach than a missed one.
  IF v_actor IS NULL THEN
    RETURN OLD;
  END IF;

  -- SWITCHING IS NOT LEAVING. adoptTrainerPlan() INSERTS the replacement
  -- program (trainerPlanAdoption.js:254) and only then DELETES the one it
  -- supersedes (:274) — so a member moving from one of the coach's plans to
  -- another lands here with the new row already in place. Without this check
  -- the coach gets "your client left your plan" the moment the client accepts
  -- their next one, which is precisely backwards.
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
    jsonb_build_object(
      'route', '/trainer/clients',
      'plan_id', v_plan_id,
      'member_id', OLD.profile_id,
      'dropped', true
    ),
    -- One per (plan, member, day). Adoption deletes several materialized rows
    -- in a single statement, so without this the coach would get a burst of
    -- identical notifications for one decision.
    'plan_dropped_' || v_plan_id::text || '_' || OLD.profile_id::text || '_' || to_char(now(), 'YYYYMMDD')
  );

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- MUST NOT block the delete. A plpgsql EXCEPTION block is a subtransaction,
  -- so letting this propagate would roll back the member's release and leave
  -- them stuck on a plan they chose to leave — a notification failure must
  -- never cost the member their action.
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fire_trainer_plan_dropped() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_notify_trainer_plan_dropped ON public.generated_programs;
CREATE TRIGGER trg_notify_trainer_plan_dropped
  AFTER DELETE ON public.generated_programs
  FOR EACH ROW
  EXECUTE FUNCTION public.fire_trainer_plan_dropped();

NOTIFY pgrst, 'reload schema';

-- Verify:
--   1) As a MEMBER, leave an adopted coach plan → the trainer gets exactly one
--      notification, regardless of how many rows the release deleted.
--   2) As the TRAINER, unassign the same client → NO notification (you did it).
--   3) Delete a self-made program → NO notification (no trainer_plan_id).
--   4) As a MEMBER, adopt a DIFFERENT plan from the same coach → NO
--      notification. This is the one worth testing by hand: the switch path
--      deletes the old row too, and reading it as a departure would tell the
--      coach they lost a client at the exact moment they gained the sale.
--
--   SELECT profile_id, title, body, dedup_key, created_at
--     FROM notifications
--    WHERE dedup_key LIKE 'plan_dropped_%'
--    ORDER BY created_at DESC LIMIT 10;
