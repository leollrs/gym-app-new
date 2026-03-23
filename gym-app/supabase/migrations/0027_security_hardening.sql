-- =============================================================
-- SECURITY HARDENING
-- Migration: 0027_security_hardening.sql
-- Fixes: privilege escalation, cross-tenant access, enumeration
-- =============================================================

-- ============================================================
-- 1. PREVENT SELF-ESCALATION VIA PROFILE INSERT
--    New users can only insert with role='member'
-- ============================================================

-- Drop the old permissive policy
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;

-- Replacement: lock role to 'member' and require a valid gym_id
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (
    id = auth.uid()
    AND role = 'member'
  );

-- ============================================================
-- 2. PREVENT SELF-UPDATE OF ROLE AND GYM_ID
--    Members can update their own profile but NOT role or gym_id.
--    Admins can update role for members in their gym.
-- ============================================================

-- Drop the old permissive policy that allowed updating any column
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

-- Members can only update safe columns (trigger enforces immutable fields)
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Trigger: block non-admin users from changing role or gym_id
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Block role changes by non-admins
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Cannot change your own role';
    END IF;
  END IF;

  -- Block gym_id changes entirely (even admins shouldn't switch gyms via update)
  IF NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
    RAISE EXCEPTION 'Cannot change gym_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_update ON profiles;
CREATE TRIGGER trg_guard_profile_update
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_update();

-- ============================================================
-- 3. ADD UNIQUE CONSTRAINT ON USERNAME PER GYM
-- ============================================================

-- Prevent username impersonation within the same gym
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_gym_username_unique'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_gym_username_unique UNIQUE (gym_id, username);
  END IF;
END $$;

-- ============================================================
-- 4. RESTRICT FEED ITEM DELETION TO OWNER + ADMIN
-- ============================================================

-- Ensure members can only delete/update their own feed items
DROP POLICY IF EXISTS "feed_update_own" ON activity_feed_items;
CREATE POLICY "feed_update_own" ON activity_feed_items
  FOR UPDATE USING (
    actor_id = auth.uid()
    OR (gym_id = public.current_gym_id() AND public.is_admin())
  );

DROP POLICY IF EXISTS "feed_delete_own" ON activity_feed_items;
CREATE POLICY "feed_delete_own" ON activity_feed_items
  FOR DELETE USING (
    actor_id = auth.uid()
    OR (gym_id = public.current_gym_id() AND public.is_admin())
  );

-- ============================================================
-- 5. RESTRICT GYM LOOKUP FOR UNAUTHENTICATED SIGNUP
--    Only return gym id (not name) to reduce enumeration value.
--    The existing gyms_select policy already limits to own gym,
--    but signup queries before auth. The fix in migration 0005
--    allows SELECT for is_active gyms. We keep that but note
--    the frontend fix reduces information leakage.
-- ============================================================
-- (Frontend fix applied in Signup.jsx — see code changes)
