-- 0560_fix_dashboard_grant_and_wod_insert.sql
-- ----------------------------------------------------------------------------
-- Production permission errors triaged from the Supabase logs:
--
--   1. 42501 "permission denied for function get_dashboard_data"
--      Migration 0363 (revoke_unused_secdef_function_grants) revoked EXECUTE on
--      get_dashboard_data from authenticated when it was considered unused. It
--      is now the primary dashboard RPC (App.jsx, Dashboard.jsx, main.jsx), and
--      no migration ever re-granted it (0551 only CREATE OR REPLACE'd the body,
--      which keeps grants revoked). The client falls back to individual queries,
--      so the dashboard still loads — but every visit logs a permission error.
--      → re-GRANT EXECUTE to authenticated.
--
--   2. 42501 "new row violates row-level security policy for table
--      gym_workouts_of_the_day" on the WOD upsert (on_conflict=gym_id,date).
--      The Workout-of-the-Day is generated client-side and the first gym
--      visitor persists the canonical row (INSERT ... ON CONFLICT DO NOTHING) so
--      everyone sees the same one (GymWOD.jsx). The table has a READ policy
--      (wod_gym_read, 0274) but NO INSERT policy was ever created, so every
--      persist is RLS-denied. → add an INSERT policy scoped to the member's gym.
--
--   3. get_gym_pulse permission-denied — granted in 0523; re-granted here
--      defensively (idempotent) in case prod is behind / it was re-revoked.
--
-- NOTE: the "permission denied for table profile_lookup" errors are NOT fixed
-- here — every current reader is SECURITY DEFINER, so that denial is a prod
-- that hasn't yet applied 0520/0522 (profile_lookup resync + RLS-helper grant
-- restore). Applying the pending migration backlog resolves it; granting table
-- SELECT directly would re-expose PII (intentionally revoked in 0221).
-- ----------------------------------------------------------------------------

-- ── 1. Dashboard RPC: re-grant EXECUTE ──────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_dashboard_data() TO authenticated;

-- ── 3. Gym pulse RPC: defensive re-grant (matches 0523 signature) ───────────
GRANT EXECUTE ON FUNCTION public.get_gym_pulse(timestamptz, timestamptz) TO authenticated;

-- ── 2. Workout-of-the-Day: members may persist their own gym's WOD ──────────
-- Pure INSERT only (the client uses ON CONFLICT DO NOTHING — no UPDATE needed,
-- and we deliberately don't grant UPDATE so a member can't rewrite the canonical
-- row once it exists). Scoped to the caller's gym so nobody can seed another
-- gym's WOD.
DROP POLICY IF EXISTS "wod_gym_insert" ON public.gym_workouts_of_the_day;
CREATE POLICY "wod_gym_insert" ON public.gym_workouts_of_the_day
  FOR INSERT TO authenticated
  WITH CHECK (gym_id = public.current_gym_id());

NOTIFY pgrst, 'reload schema';
