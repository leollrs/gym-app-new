-- ============================================================
-- 0310: Allow super_admin to promote members to admin role
--
-- Problem: guard_profile_update trigger (from 0202) restricts
-- role changes to 'member' and 'trainer' only — even for
-- super_admin. This prevents promoting anyone to admin.
--
-- Fix: Super admins can assign member, trainer, or admin.
-- Regular admins can still only assign member or trainer.
-- ============================================================

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

    -- Super admins can assign member, trainer, or admin
    IF public.is_super_admin() THEN
      IF NEW.role NOT IN ('member', 'trainer', 'admin') THEN
        RAISE EXCEPTION 'Cannot assign super_admin role via profile update';
      END IF;
    ELSE
      -- Regular admins can only assign member or trainer
      IF NEW.role NOT IN ('member', 'trainer') THEN
        RAISE EXCEPTION 'Admins can only assign member or trainer roles';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
