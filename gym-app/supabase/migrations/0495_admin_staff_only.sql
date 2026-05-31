-- 0495_admin_staff_only.sql
--
-- Stage 3 of the multi-role refactor: ADMINS (and super_admins) become
-- STAFF-ONLY. They no longer carry the 'member' role, so:
--   • the admin app stays clean (no "switch to member" that strands a shared
--     front-desk/kiosk browser in member view),
--   • they can't accidentally generate member activity,
--   • combined with 0493 they're fully out of every member metric/leaderboard.
-- For QA ("see what members see") admins use the read-only MEMBER PREVIEW in
-- the app (frontend) — which needs NO member role.
--
-- TRAINERS keep 'member' (they personally train/log food). Only admin/super_admin
-- lose it. is_staff (0493) already keeps trainers out of member metrics, the
-- leaderboards, the TV, who's-here, and challenge rankings.
--
-- ⚠️ Apply via Supabase Dashboard SQL Editor, AFTER 0493.

-- ── 1. Stop auto-granting 'member' to admin/super_admin ──────────────────────
-- 0332 gave 'member' to every trainer/admin/super_admin on insert/promote.
-- New rule: trainers only.
CREATE OR REPLACE FUNCTION public.auto_grant_member_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only TRAINERS auto-get the member experience (they personally train).
  -- Admins/super_admins are staff-only and use the read-only member preview.
  IF NEW.role = 'trainer'
     AND NOT ('member'::user_role = ANY(NEW.additional_roles)) THEN
    NEW.additional_roles := array_append(NEW.additional_roles, 'member'::user_role);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_grant_member_role_on_promote()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role = 'trainer'
     AND NOT ('member'::user_role = ANY(NEW.additional_roles)) THEN
    NEW.additional_roles := array_append(NEW.additional_roles, 'member'::user_role);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Strip 'member' from existing admin/super_admin accounts ───────────────
-- Runs as postgres (auth.uid() IS NULL) so the 0332 guard trigger allows it.
-- Also triggers 0493's is_staff maintenance (is_staff stays true via role).
UPDATE public.profiles
   SET additional_roles = array_remove(additional_roles, 'member'::user_role)
 WHERE role IN ('admin','super_admin')
   AND 'member'::user_role = ANY(additional_roles);

NOTIFY pgrst, 'reload schema';
