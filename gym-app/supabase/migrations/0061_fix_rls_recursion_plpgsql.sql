-- =============================================================
-- FIX (take 2): infinite recursion in profiles RLS
-- =============================================================
-- SQL-language STABLE functions are inlined by the PostgreSQL
-- query planner into the calling policy expression.  When that
-- happens the SECURITY DEFINER context is lost, so the internal
-- SELECT on profiles still triggers RLS → infinite recursion.
--
-- PL/pgSQL functions are NEVER inlined, so SECURITY DEFINER is
-- preserved.  Because these functions are owned by the postgres
-- (superuser) role, they run with BYPASSRLS and the internal
-- SELECT on profiles executes without triggering any policy.
-- =============================================================

CREATE OR REPLACE FUNCTION public.current_gym_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result UUID;
BEGIN
  SELECT gym_id INTO result
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.user_role;
BEGIN
  SELECT role INTO result
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result BOOLEAN;
BEGIN
  SELECT COALESCE(role IN ('admin', 'super_admin'), FALSE)
  INTO result
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
  RETURN COALESCE(result, FALSE);
END;
$$;
