-- =============================================================
-- FIX: infinite recursion in profiles RLS policies
-- =============================================================
-- current_gym_id(), current_user_role(), and is_admin() all query
-- the profiles table. They are SECURITY DEFINER, but Supabase's
-- function owner role does not have BYPASSRLS, so RLS still fires
-- inside the function → the profiles_select policy calls
-- current_gym_id() → which queries profiles → policy fires again
-- → infinite recursion.
--
-- Fix: add "SET row_security = off" to each function so that the
-- internal SELECT on profiles runs without RLS evaluation.
-- =============================================================

CREATE OR REPLACE FUNCTION public.current_gym_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT gym_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (SELECT role IN ('admin', 'super_admin')
     FROM public.profiles
     WHERE id = auth.uid()
     LIMIT 1),
    FALSE
  );
$$;
