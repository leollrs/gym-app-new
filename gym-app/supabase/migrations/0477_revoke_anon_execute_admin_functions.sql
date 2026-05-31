-- ============================================================
-- 0478 — Revoke anon EXECUTE on all admin / super_admin / bulk functions
-- ============================================================
-- Live grants check (2026-05-30) found the `anon` role (unauthenticated,
-- anyone on the public internet via the REST API) holds EXECUTE on:
--   admin_bulk_freeze, admin_cancel_class_booking, admin_create_member,
--   admin_get_or_create_tv_code, admin_get_tv_sessions, admin_rotate_tv_code,
--   admin_set_tv_style, bulk_import_members,
--   super_admin_cancel_gym_deletion, super_admin_compute_gym_costs,
--   super_admin_delete_gym_now, super_admin_export_gym_data,
--   super_admin_schedule_gym_deletion
-- This is the Supabase default (anon+authenticated get EXECUTE on all public
-- functions). None of these should be reachable by an unauthenticated caller.
--
-- IMPORTANT — this is DEFENSE IN DEPTH, not the whole story:
-- In Supabase there is no "admin" database role. Every real user (member,
-- trainer, admin, super_admin) connects as the SAME role `authenticated`;
-- admin-ness lives in profile_lookup, not in a DB role. So a GRANT can only
-- distinguish anon vs authenticated — it CANNOT enforce "admin only". The
-- load-bearing check that stops a regular logged-in member from calling these
-- is the internal `IF NOT is_admin()/is_super_admin() THEN RAISE EXCEPTION`
-- guard inside each function body. This migration removes the anon surface;
-- the internal guards (verified separately) remain the primary control.
--
-- We revoke from anon on the WHOLE admin_/super_admin_/bulk_ family (not just
-- the 13 observed) so newly-added functions in these families are covered too.
-- authenticated EXECUTE is intentionally retained — those calls are gated by
-- the functions' internal role checks.
-- ============================================================

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname LIKE 'admin\_%'
        OR p.proname LIKE 'super\_admin\_%'
        OR p.proname LIKE 'bulk\_%'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon;',
      fn.nspname, fn.proname, fn.args
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
