-- ============================================================================
-- 0362 — Revoke EXECUTE on every trigger function in public
-- ============================================================================
-- Trigger functions (defined as `RETURNS trigger`) are invoked by the
-- Postgres trigger system, not via SQL function calls. Trigger firing
-- bypasses the `EXECUTE` GRANT check entirely — the engine calls the
-- function directly when the relevant DML fires on the table.
--
-- That means we can safely revoke EXECUTE on these from PUBLIC, anon, and
-- authenticated:
--   • Triggers continue firing on INSERT/UPDATE/DELETE as before.
--   • PostgREST stops exposing them as `/rest/v1/rpc/<name>` endpoints
--     for direct invocation by signed-in or anon users.
--   • The Supabase linter's
--     `authenticated_security_definer_function_executable` warning
--     clears for each one.
--
-- This loop is robust to future trigger functions — anything new with
-- `RETURNS trigger` in `public` will already have its EXECUTE locked
-- down once this migration runs (provided no later migration grants
-- it back).
-- ============================================================================

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      fn.proname, fn.args
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
