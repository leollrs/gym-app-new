-- 0479_fix_super_admin_additional_roles_escalation.sql
--
-- Closes two LIVE holes found by auditing function bodies + EXECUTE grants
-- against production on 2026-05-30. No prior migration addresses these
-- (0477 only revoked anon EXECUTE on admin_%/super_admin_%/bulk_% name
-- patterns; these functions don't match).
--
-- 1) PRIVILEGE ESCALATION: a regular gym `admin` can self-promote to platform
--    `super_admin` by adding 'super_admin' to `additional_roles`. The existing
--    guards (guard_profile_update, prevent_super_admin_escalation) only protect
--    the `role` COLUMN, never `additional_roles`, while is_super_admin() honors
--    additional_roles. Chain:
--      UPDATE profiles SET additional_roles = additional_roles||'super_admin'
--      WHERE id = auth.uid();
--    -> guard_profile_update passes (role unchanged)
--    -> guard_additional_roles_update passes (caller is admin, no role filter)
--    -> prevent_super_admin_escalation passes (role unchanged)
--    -> sync_profile_lookup mirrors it -> caller is now platform super_admin.
--
-- 2) ANON REWARD MINTING / CHECK-IN ABUSE: award_earned_reward and
--    checkin_by_external_id carry PUBLIC/anon EXECUTE (Postgres default, never
--    revoked). award_earned_reward has ZERO internal authz and takes
--    p_profile_id as a parameter -> anyone with the anon key can mint rewards
--    for any member. checkin_by_external_id lets anon check in any member by
--    external id (pollutes attendance + churn signals). Neither is called by
--    the client (verified via repo grep) -> safe to revoke from anon/auth.
--
-- NOT FIXED HERE (needs app-side change, tracked separately):
--   add_reward_points / add_reward_points_checked are client-called
--   (rewardsEngine.js addPoints, scanActionHandlers.js) so they can't simply
--   be revoked. They award server-authoritative points but do NOT verify the
--   underlying event happened and have no dedup on workout_completed / pr_hit /
--   streak_* actions -> a member can farm points via direct RPC. Proper fix is
--   to move point-awarding for those actions server-side into complete_workout
--   (already service_role-locked) and stop the client from passing arbitrary
--   actions to add_reward_points.

-- ── 1a. Block super_admin grant/revoke via additional_roles ────────────────
CREATE OR REPLACE FUNCTION public.guard_additional_roles_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- No change → allow.
  IF NEW.additional_roles = OLD.additional_roles THEN
    RETURN NEW;
  END IF;

  -- System / service_role (no auth context) → allow (backfills etc).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Granting OR revoking super_admin via additional_roles requires the CALLER
  -- to already be a super_admin.
  IF ('super_admin'::user_role = ANY(COALESCE(NEW.additional_roles, '{}')))
       IS DISTINCT FROM
     ('super_admin'::user_role = ANY(COALESCE(OLD.additional_roles, '{}')))
  THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Only super_admins can grant or revoke super_admin via additional_roles';
    END IF;
  END IF;

  -- Admins (incl. via additional_roles) may manage member/trainer/admin roles.
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Non-admins: silently revert the additional_roles change, keep other edits.
  NEW.additional_roles := OLD.additional_roles;
  RETURN NEW;
END;
$function$;

-- ── 1b. Catch additional_roles in the escalation guard (defense-in-depth) ───
CREATE OR REPLACE FUNCTION public.prevent_super_admin_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.role = 'super_admin' AND OLD.role <> 'super_admin')
     OR (
       ('super_admin'::user_role = ANY(COALESCE(NEW.additional_roles, '{}')))
       AND NOT ('super_admin'::user_role = ANY(COALESCE(OLD.additional_roles, '{}')))
     )
  THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Cannot escalate to super_admin role';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2. Revoke anon/PUBLIC EXECUTE on internal-only privileged helpers ──────
-- (service_role keeps its explicit grant; the client never calls these.)
REVOKE EXECUTE ON FUNCTION
  public.award_earned_reward(uuid, uuid, text, uuid, text, timestamp with time zone)
  FROM anon, authenticated, PUBLIC;

REVOKE EXECUTE ON FUNCTION
  public.checkin_by_external_id(text, text)
  FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';
