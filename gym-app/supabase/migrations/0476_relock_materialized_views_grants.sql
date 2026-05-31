-- ============================================================
-- 0476 — Strip anon/authenticated privileges off the materialized views
-- ============================================================
-- The 4 public materialized views aggregate data ACROSS ALL GYMS:
--   mv_gym_exercise_popularity, mv_gym_health_scores,
--   mv_gym_member_summary, mv_gym_stats_daily
-- Materialized views CANNOT carry RLS and ignore security_invoker — Postgres
-- always reads them as precomputed owner-level data. Their ONLY access control
-- is the table-level GRANT.
--
-- Live grants dump (2026-05-30) on all four shows anon + authenticated hold:
--   INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
-- (SELECT is correctly absent — so there is NO cross-tenant read leak; that's
-- the one thing that was already right.) This is the fingerprint of a blanket
-- `GRANT ALL ON ALL TABLES ... TO anon, authenticated` that splashed onto the
-- matviews — same disease as profile_lookup (see 0473).
--
-- Why it still matters:
--   • INSERT/UPDATE/DELETE/TRUNCATE on a matview are inert (Postgres rejects
--     DML on matviews) — harmless noise, but noise an auditor will flag.
--   • MAINTAIN (PG17) is NOT inert: it authorizes REFRESH MATERIALIZED VIEW
--     (also VACUUM/ANALYZE/CLUSTER/REINDEX). So any authenticated user — and
--     even anon, unauthenticated — can trigger a full REFRESH of these
--     cross-gym aggregates on demand. mv_gym_health_scores / mv_gym_member_
--     summary recompute over every gym's sessions/check-ins/churn; repeated
--     REFRESH is a cheap resource-exhaustion / DoS lever.
--
-- The app never reads or refreshes these from the client; they are populated
-- server-side (postgres / service_role, via cron + SECURITY DEFINER RPCs).
-- Least-privilege target: anon + authenticated have NOTHING on them.
--
-- FIX: REVOKE ALL on each matview from anon + authenticated. postgres (owner)
-- and service_role retain full privileges (untouched), so refresh + server-side
-- reads keep working. Idempotent — REVOKE of an absent privilege is a no-op.
-- ============================================================

REVOKE ALL ON public.mv_gym_exercise_popularity FROM anon, authenticated;
REVOKE ALL ON public.mv_gym_health_scores       FROM anon, authenticated;
REVOKE ALL ON public.mv_gym_member_summary      FROM anon, authenticated;
REVOKE ALL ON public.mv_gym_stats_daily         FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
