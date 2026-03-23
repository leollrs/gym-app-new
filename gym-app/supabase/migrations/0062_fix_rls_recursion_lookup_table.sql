-- =============================================================
-- DEFINITIVE FIX: infinite recursion in profiles RLS
-- =============================================================
-- Root cause: current_gym_id() / is_admin() query profiles.
-- profiles_select calls those functions → they query profiles
-- → policy fires again → infinite recursion.
-- SECURITY DEFINER + plpgsql did not break the cycle in Supabase.
--
-- Solution: create a tiny RLS-free lookup table that mirrors only
-- gym_id and role from profiles. Helper functions query that table
-- instead of profiles, so no policy ever fires inside them.
-- A trigger keeps it in sync automatically.
-- =============================================================

-- 1. Lookup table (no PII — just gym membership + role)
CREATE TABLE IF NOT EXISTS public.profile_lookup (
  id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gym_id UUID,
  role   public.user_role
);

-- Intentionally no RLS — this table contains no personal data
ALTER TABLE public.profile_lookup DISABLE ROW LEVEL SECURITY;

-- 2. Sync trigger: keep lookup in step with profiles
CREATE OR REPLACE FUNCTION public.sync_profile_lookup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_lookup (id, gym_id, role)
  VALUES (NEW.id, NEW.gym_id, NEW.role)
  ON CONFLICT (id) DO UPDATE
    SET gym_id = EXCLUDED.gym_id,
        role   = EXCLUDED.role;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_lookup ON profiles;
CREATE TRIGGER trg_sync_profile_lookup
  AFTER INSERT OR UPDATE OF gym_id, role ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_lookup();

-- 3. Backfill existing rows
INSERT INTO public.profile_lookup (id, gym_id, role)
SELECT id, gym_id, role FROM public.profiles
ON CONFLICT (id) DO UPDATE
  SET gym_id = EXCLUDED.gym_id,
      role   = EXCLUDED.role;

-- 4. Rewrite helper functions to query profile_lookup (no RLS)
CREATE OR REPLACE FUNCTION public.current_gym_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profile_lookup WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role IN ('admin', 'super_admin')
     FROM public.profile_lookup
     WHERE id = auth.uid()
     LIMIT 1),
    FALSE
  );
$$;
