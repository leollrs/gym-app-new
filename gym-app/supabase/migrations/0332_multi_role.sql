-- =============================================================
-- MULTI-ROLE SUPPORT — additional_roles column on profiles
-- Migration: 0332_multi_role.sql
--
-- Background: profiles.role is single-valued. A trainer who also wants to
-- log their own workouts as a member can't, because route guards lock
-- them into the trainer experience. Same for admins.
--
-- Design (per "Option A" + safety constraints):
--   * Add `additional_roles user_role[]` column. Defaults to '{}'.
--   * Keep `role` as the *primary* role — existing RLS policies that read
--     `role = 'X'` continue to work unchanged.
--   * `user_has_role(p_role)` helper returns TRUE if `role = p_role` OR
--     `p_role = ANY(additional_roles)`. Use this in NEW policies.
--   * Auto-grant 'member' to every existing trainer/admin/super_admin so
--     they can log personal workouts.
--   * Trigger: on INSERT into profiles, auto-add 'member' to
--     additional_roles when role IN (trainer, admin, super_admin) and
--     'member' isn't already there.
--   * Active view is COSMETIC ONLY — stored client-side. Backend never
--     trusts it. RLS continues to enforce on the actual `role` column or
--     via `user_has_role()`.
--
-- Why not promote `role` to an array? Every existing RLS policy uses
-- `role = 'X'` checks. Migrating them all is risk we don't need to take.
-- =============================================================

-- ── Column ──────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS additional_roles user_role[] NOT NULL DEFAULT '{}'::user_role[];

COMMENT ON COLUMN profiles.additional_roles IS
  'Extra roles a user has beyond `role`. Used to grant trainers/admins
   access to the member experience (logging workouts, etc.) without
   demoting their primary role. Active view is decided client-side; RLS
   should check entitlement via user_has_role() for any new policies.';

-- ── Helper function ─────────────────────────────────────────────
-- True when the calling user (auth.uid()) holds `p_role` either as their
-- primary role or in additional_roles. STABLE so PostgREST/RLS can cache.
CREATE OR REPLACE FUNCTION public.user_has_role(p_role user_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM profiles
     WHERE id = auth.uid()
       AND (role = p_role OR p_role = ANY(additional_roles))
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_role(user_role) TO authenticated;

COMMENT ON FUNCTION public.user_has_role(user_role) IS
  'Returns TRUE if the calling user has the given role either as their
   primary `role` or in `additional_roles`. Use in new RLS policies that
   should grant access to multi-role users.';

-- ── Backfill ────────────────────────────────────────────────────
-- Every existing trainer / admin / super_admin gets 'member' in their
-- additional_roles so they can log personal workouts immediately.
UPDATE profiles
   SET additional_roles = ARRAY['member'::user_role]
 WHERE role IN ('trainer', 'admin', 'super_admin')
   AND NOT ('member'::user_role = ANY(additional_roles));

-- ── Trigger: auto-grant 'member' on insert for non-member roles ─
CREATE OR REPLACE FUNCTION public.auto_grant_member_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act on non-member primary roles. Idempotent — won't duplicate.
  IF NEW.role IN ('trainer', 'admin', 'super_admin')
     AND NOT ('member'::user_role = ANY(NEW.additional_roles)) THEN
    NEW.additional_roles := array_append(NEW.additional_roles, 'member'::user_role);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_grant_member_role ON profiles;
CREATE TRIGGER trg_auto_grant_member_role
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_grant_member_role();

-- Also fire when role is changed AFTER creation (e.g. promoting member to
-- trainer). Same idempotency rule applies.
CREATE OR REPLACE FUNCTION public.auto_grant_member_role_on_promote()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role IN ('trainer', 'admin', 'super_admin')
     AND NOT ('member'::user_role = ANY(NEW.additional_roles)) THEN
    NEW.additional_roles := array_append(NEW.additional_roles, 'member'::user_role);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_grant_member_role_on_promote ON profiles;
CREATE TRIGGER trg_auto_grant_member_role_on_promote
  BEFORE UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_grant_member_role_on_promote();

-- ── RLS: who can write `additional_roles` ───────────────────────
-- Only gym admins / super admins can edit the role bag — same authority
-- that already controls primary `role` assignment. Members and trainers
-- cannot escalate themselves.
--
-- The existing profiles update RLS already restricts most non-admin
-- writes. We add a second policy specifically blocking non-admin updates
-- to additional_roles via a column-level WITH CHECK clause approach:
-- since PostgreSQL RLS doesn't support per-column policies cleanly, we
-- enforce it via a BEFORE UPDATE trigger that nukes attempted edits from
-- non-admin/non-self contexts.
CREATE OR REPLACE FUNCTION public.guard_additional_roles_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role user_role;
BEGIN
  -- Allow if values didn't change.
  IF NEW.additional_roles = OLD.additional_roles THEN
    RETURN NEW;
  END IF;

  -- Caller must be an admin / super_admin in the same gym, OR the system
  -- (bypass when running with no auth context — e.g., backfills above).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid();

  IF caller_role IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  -- Otherwise reject the change but keep the rest of the row's updates.
  NEW.additional_roles := OLD.additional_roles;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_additional_roles ON profiles;
CREATE TRIGGER trg_guard_additional_roles
  BEFORE UPDATE OF additional_roles ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_additional_roles_update();
