-- ============================================================
-- bench_reads.sql — EXPLAIN ANALYZE the heavy admin-overview reads
-- as the `authenticated` role with an admin JWT, so RLS cost is
-- included in the plan. Mirrors src/lib/admin/overviewQuery.js.
-- ============================================================
\set GYM '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''

-- Resolve the seeded admin's id and impersonate it under RLS.
SELECT id AS admin_id FROM profiles WHERE gym_id = :GYM::uuid AND role = 'admin' LIMIT 1 \gset

SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :'admin_id', 'role', 'authenticated')::text,
  false);
SET ROLE authenticated;

\echo '\n========== Q1: members list (LIMIT 2000) =========='
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, full_name, username, role, created_at, gym_id, last_active_at, membership_status, avatar_url
FROM profiles
WHERE gym_id = :GYM::uuid AND role = 'member' AND imported_archived = false
LIMIT 2000;

\echo '\n========== Q2: completed sessions, last 28d (LIMIT 1000) =========='
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT profile_id, started_at, total_volume_lbs
FROM workout_sessions
WHERE gym_id = :GYM::uuid AND status = 'completed'
  AND started_at >= now() - interval '28 days'
ORDER BY started_at DESC
LIMIT 1000;

\echo '\n========== Q3: churn scores, ordered by score (LIMIT 2000) =========='
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT profile_id, score, risk_tier, key_signals, computed_at
FROM churn_risk_scores
WHERE gym_id = :GYM::uuid
ORDER BY score DESC
LIMIT 2000;

\echo '\n========== Q4: not-onboarded members, last 48h (LIMIT 500) =========='
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id
FROM profiles
WHERE gym_id = :GYM::uuid AND role = 'member' AND is_onboarded = false
  AND imported_archived = false AND created_at >= now() - interval '2 days'
LIMIT 500;

\echo '\n========== Q5: check-ins, last 30d (LIMIT 1000) =========='
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT profile_id, checked_in_at
FROM check_ins
WHERE gym_id = :GYM::uuid AND checked_in_at >= now() - interval '30 days'
ORDER BY checked_in_at DESC
LIMIT 1000;

\echo '\n========== Q6: today''s check-ins (LIMIT 500) =========='
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, profile_id, checked_in_at
FROM check_ins
WHERE gym_id = :GYM::uuid AND checked_in_at >= date_trunc('day', now())
ORDER BY checked_in_at DESC
LIMIT 500;

RESET ROLE;
