-- ============================================================
-- 0620 — pin search_path on the 15 functions flagged by the
--        Supabase linter (0011_function_search_path_mutable)
-- ============================================================
-- These helper/trigger functions were created without an explicit
-- `SET search_path`, so they inherit the caller's (role-mutable) search_path.
-- For the SECURITY-sensitive ones (profiles_set_is_staff, auto_grant_member_role*)
-- a mutable search_path is a real, if hard-to-exploit, vector: anyone able to
-- create an object in a schema earlier on the path could shadow a table/function
-- the definer references. Pinning to `public` closes it. pg_catalog is always
-- searched implicitly first, so built-ins (now(), format(), …) still resolve.
--
-- Idempotent + signature-safe: we discover every overload of each name from
-- pg_proc and ALTER it, so re-running is a no-op and argument lists can't drift.
-- Purely a metadata change on existing functions — no behavior change, no app
-- coupling, safe for old clients.
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'next_delivery_saturday',
        'profiles_set_is_staff',
        'auto_grant_member_role',
        'auto_grant_member_role_on_promote',
        'outreach_cadence_days',
        'lifecycle_steps',
        'touch_message_templates_updated_at',
        'generate_tv_code',
        'winback_steps',
        'milestone_thresholds',
        'lifecycle_template',
        'print_cards_set_delivery',
        'wellness_checkins_set_updated_at',
        'milestone_template',
        'touch_challenge_score_updated_at'
      ])
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public',
      r.proname, r.args
    );
    RAISE NOTICE 'pinned search_path on public.%(%)', r.proname, r.args;
  END LOOP;
END $$;
