-- 0486_anon_execute_capstone.sql
--
-- DEFENSE-IN-DEPTH CAPSTONE. Not fixing a known live hole — every anon-reachable
-- function was individually verified safe during the 2026-05-30 audit. This makes
-- the whole CLASS of bug structurally impossible: Supabase grants EXECUTE to
-- PUBLIC (anon + authenticated) by default, so any FUTURE function that forgets
-- an internal auth.uid() check would silently be anon-callable. After this, anon
-- can execute ONLY the handful of functions the pre-login app genuinely needs;
-- everything else requires (at minimum) an authenticated session.
--
-- Scope: revokes EXECUTE from `anon` only. `authenticated` is deliberately left
-- alone — that layer is already gated by each function's internal role/ownership
-- checks plus the targeted revokes in 0479/0480/0481/0484. Touching authenticated
-- would risk breaking logged-in features for no security gain here.
--
-- ANON ALLOWLIST (verified against the frontend, 2026-05-30):
--   lookup_invite_by_code, lookup_gym_invite_by_code  — Signup, pre-account
--   lookup_referral_code                              — Signup, pre-account
--   tv_authenticate, tv_get_dashboard_data            — TVDisplay (code, no login)
--   get_maintenance_status                            — MaintenanceGate (pre-auth)
--   get_app_version                                   — app version gate (pre-auth)
-- (create_password_reset_request is NOT in src — the reset edge function uses
--  service_role — so anon does not need it.)
--
-- To add an anon-callable function later: GRANT EXECUTE ... TO anon explicitly,
-- and add it to the allowlist comment above. Reversible: re-grant by name.

DO $$
DECLARE
  r RECORD;
  v_allow TEXT[] := ARRAY[
    'lookup_invite_by_code',
    'lookup_gym_invite_by_code',
    'lookup_referral_code',
    'tv_authenticate',
    'tv_get_dashboard_data',
    'get_maintenance_status',
    'get_app_version'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT (p.proname = ANY(v_allow))
      -- only bother with functions that actually grant anon today
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END$$;

-- Belt-and-suspenders: make sure the allowlisted ones DO still have anon EXECUTE
-- (covers any overload that might have been missed by a prior revoke).
DO $$
DECLARE
  r RECORD;
  v_allow TEXT[] := ARRAY[
    'lookup_invite_by_code',
    'lookup_gym_invite_by_code',
    'lookup_referral_code',
    'tv_authenticate',
    'tv_get_dashboard_data',
    'get_maintenance_status',
    'get_app_version'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_allow)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
  END LOOP;
END$$;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY after applying ──────────────────────────────────────────────────
-- Should return ONLY the 7 allowlisted names:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
--   ORDER BY 1;
-- Then smoke-test pre-login: app loads (version + maintenance gate), Signup
-- invite/referral lookup works, TV display authenticates.
