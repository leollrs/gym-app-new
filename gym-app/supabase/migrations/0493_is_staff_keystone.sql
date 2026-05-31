-- 0493_is_staff_keystone.sql
--
-- THE KEYSTONE for "staff use the app but never pollute the customer plane."
--
-- Adds profiles.is_staff: a single, maintained source of truth for
-- "this account is gym STAFF (trainer/admin/super_admin), not a paying member."
-- A BEFORE trigger keeps it in sync with role + additional_roles, so you never
-- have to remember to recompute it. Customer-facing surfaces that DON'T already
-- gate on a privacy flag (who's-here / GymPulse, the monthly-stats matview,
-- in-app challenge rankings) filter `AND NOT is_staff`.
--
-- For the LEADERBOARDS we use a shortcut instead of rewriting ~640 lines of
-- SECURITY DEFINER functions: every leaderboard query (all 7 in-app RPCs, the
-- milestone feed, AND all 6 TV leaderboards + TV challenge boards) ALREADY
-- filters `leaderboard_visible = TRUE`. So the same trigger also FORCES
-- `leaderboard_visible = false` for staff. That drops them off every leaderboard
-- and the public TV with zero changes to those functions (zero blast radius).
-- We only ever force it FALSE — never true — so a real member's choice is
-- preserved, and a demoted ex-staff just re-enables it in Settings.
--
-- Definition of staff (covers BOTH the primary role and the multi-role bag, so
-- it's robust no matter how the role bag is arranged):
--   role IN (trainer, admin, super_admin)
--   OR additional_roles && {trainer, admin, super_admin}
--
-- ⚠️ Apply via Supabase Dashboard SQL Editor. This is migration 1/N of the
--    staff-invisibility sweep — apply it BEFORE the others and BEFORE deploying
--    the matching frontend (GymPulse / friend search query for is_staff).

-- ── 1. Column ───────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_staff IS
  'TRUE when the account holds any staff role (trainer/admin/super_admin) in role OR additional_roles. Maintained by trg_profiles_set_is_staff, which also forces leaderboard_visible=false for staff. Customer-facing queries filter "AND NOT is_staff" so staff who use the member app never pollute member metrics, leaderboards, the TV, or who''s-here.';

-- ── 2. Maintenance trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profiles_set_is_staff()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_staff := (
    NEW.role IN ('trainer','admin','super_admin')
    OR (NEW.additional_roles IS NOT NULL
        AND NEW.additional_roles && ARRAY['trainer','admin','super_admin']::user_role[])
  );
  -- Keep staff off every leaderboard + the public TV. Each leaderboard query
  -- already filters `leaderboard_visible = TRUE`, so this single line does it
  -- for all of them with no function changes. Force FALSE only — never true.
  IF NEW.is_staff THEN
    NEW.leaderboard_visible := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_set_is_staff ON public.profiles;
CREATE TRIGGER trg_profiles_set_is_staff
  BEFORE INSERT OR UPDATE OF role, additional_roles, leaderboard_visible ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_set_is_staff();

-- ── 3. Backfill existing rows ───────────────────────────────────────────────
UPDATE public.profiles
  SET is_staff = (
        role IN ('trainer','admin','super_admin')
        OR (additional_roles IS NOT NULL
            AND additional_roles && ARRAY['trainer','admin','super_admin']::user_role[])
      ),
      leaderboard_visible = CASE
        WHEN (
          role IN ('trainer','admin','super_admin')
          OR (additional_roles IS NOT NULL
              AND additional_roles && ARRAY['trainer','admin','super_admin']::user_role[])
        ) THEN false
        ELSE leaderboard_visible
      END;

NOTIFY pgrst, 'reload schema';
