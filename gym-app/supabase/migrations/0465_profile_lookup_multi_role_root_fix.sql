-- ============================================================
-- 0465 — Multi-role ROOT fix: teach profile_lookup + helpers
--        about additional_roles
-- ============================================================
-- Background:
--   public.profile_lookup (0062) is an RLS-free mirror of profiles
--   carrying ONLY (id, gym_id, role). It exists so the helper
--   functions is_admin() / current_gym_id() / current_user_role()
--   can read role/gym without triggering profiles-RLS recursion.
--
--   The multi-role model (0332) holds extra roles in
--   profiles.additional_roles (user_role[]) — e.g. a member or
--   trainer who is ALSO a gym admin keeps 'admin' there while their
--   primary `role` stays 'member'/'trainer'.
--
--   Because profile_lookup never carried additional_roles, is_admin()
--   and is_super_admin() (which read it) silently returned FALSE for
--   such users. Every RLS policy / RPC gated on those helpers locked
--   multi-role admins out at the DB layer — the frontend guards ARE
--   multi-role-aware, so the user reached the UI and the write died.
--
-- This migration is the single root fix for that whole class:
--   1. add additional_roles to profile_lookup
--   2. sync it from the trigger + backfill
--   3. widen is_admin() / is_super_admin() to honour it
--
-- profile_lookup is RLS-disabled for writes and only exposes
-- (id, gym_id, role, additional_roles) — same low-sensitivity
-- mapping as before, so no new PII concern.
--
-- Behaviour change: existing single-role admins still pass; multi-
-- role holders now pass too. Nothing is tightened.
-- ============================================================

-- ── 1. Add the column (idempotent) ──
ALTER TABLE public.profile_lookup
  ADD COLUMN IF NOT EXISTS additional_roles public.user_role[] NOT NULL DEFAULT '{}';

-- ── 2. Teach the sync trigger to mirror additional_roles ──
CREATE OR REPLACE FUNCTION public.sync_profile_lookup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profile_lookup WHERE id = OLD.id;
    RETURN OLD;
  ELSE
    INSERT INTO public.profile_lookup (id, gym_id, role, additional_roles)
    VALUES (NEW.id, NEW.gym_id, NEW.role, COALESCE(NEW.additional_roles, '{}'))
    ON CONFLICT (id) DO UPDATE
      SET gym_id           = EXCLUDED.gym_id,
          role             = EXCLUDED.role,
          additional_roles = EXCLUDED.additional_roles;
    RETURN NEW;
  END IF;
END;
$$;

-- The 0062 trigger fires AFTER INSERT OR UPDATE **OF gym_id, role** —
-- so an additional_roles-only change would NOT invoke it. Recreate the
-- trigger with additional_roles in the column list so multi-role grants
-- propagate to profile_lookup immediately.
DROP TRIGGER IF EXISTS trg_sync_profile_lookup ON public.profiles;
CREATE TRIGGER trg_sync_profile_lookup
  AFTER INSERT OR UPDATE OF gym_id, role, additional_roles ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_lookup();

-- ── 3. Backfill additional_roles for existing rows ──
UPDATE public.profile_lookup pl
   SET additional_roles = COALESCE(p.additional_roles, '{}')
  FROM public.profiles p
 WHERE p.id = pl.id
   AND pl.additional_roles IS DISTINCT FROM COALESCE(p.additional_roles, '{}');

-- ── 4. Widen is_admin() to honour additional_roles ──
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_lookup
    WHERE id = auth.uid()
      AND (role IN ('admin', 'super_admin')
           OR 'admin'::public.user_role       = ANY(additional_roles)
           OR 'super_admin'::public.user_role = ANY(additional_roles))
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- ── 5. Widen is_super_admin() to honour additional_roles ──
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_lookup
    WHERE id = auth.uid()
      AND (role = 'super_admin'
           OR 'super_admin'::public.user_role = ANY(additional_roles))
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- current_user_role() / current_gym_id() intentionally unchanged:
-- they return the PRIMARY role/gym, which is still correct. Callers
-- that need multi-role awareness go through is_admin()/is_super_admin().

NOTIFY pgrst, 'reload schema';
