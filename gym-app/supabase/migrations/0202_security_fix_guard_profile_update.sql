-- =============================================================
-- SECURITY FIX: guard_profile_update privilege escalation
-- Migration: 0202_security_fix_guard_profile_update.sql
-- Fixes: admins could set ANY role (including super_admin)
--        via the profile update trigger. Now restricted to
--        'member' and 'trainer' only.
-- =============================================================

CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Block gym_id changes for everyone
  IF NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
    RAISE EXCEPTION 'Cannot change gym_id';
  END IF;

  -- Block role changes for non-admins
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can change roles';
    END IF;
    -- Even admins can only assign member or trainer roles
    IF NEW.role NOT IN ('member', 'trainer') THEN
      RAISE EXCEPTION 'Admins can only assign member or trainer roles';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
