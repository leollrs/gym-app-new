-- Standalone-postgres variant of seed_benchmark.sql.
-- Differences: session_replication_role (not ALTER TRIGGER) to skip triggers
-- without table ownership, and a minimal auth.users insert (id+email only)
-- since the bare image's auth.users schema differs from the full stack.
\set ON_ERROR_STOP on
\timing on
\set GYM '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set N_MEMBERS 2000
\set N_CHECKINS 50000
\set N_SESSIONS 40000

-- Idempotent cleanup (run under normal role so FK cascades fire).
DELETE FROM auth.users WHERE email LIKE 'bench%@bench.local';
DELETE FROM gyms WHERE id = :GYM::uuid;

SET session_replication_role = replica;

INSERT INTO gyms (id, name, slug, timezone, is_active)
VALUES (:GYM::uuid, 'Benchmark Gym', 'benchmark-gym', 'America/Puerto_Rico', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
SELECT gen_random_uuid(), 'bench' || g || '@bench.local'
FROM generate_series(1, :N_MEMBERS) g;

INSERT INTO profiles
  (id, gym_id, role, username, full_name,
   is_onboarded, imported_archived, membership_status, last_active_at, created_at)
SELECT u.id, :GYM::uuid, 'member',
       'bench_' || substr(u.id::text, 1, 8),
       'Bench Member ' || substr(u.id::text, 1, 4),
       true, false, 'active',
       now() - (random() * 60 * interval '1 day'),
       now() - (random() * 365 * interval '1 day')
FROM auth.users u
WHERE u.email LIKE 'bench%@bench.local';

UPDATE profiles SET role = 'admin'
WHERE id = (SELECT id FROM profiles WHERE gym_id = :GYM::uuid ORDER BY created_at LIMIT 1);
UPDATE gyms SET owner_user_id = (SELECT id FROM profiles WHERE gym_id = :GYM::uuid AND role = 'admin' LIMIT 1)
WHERE id = :GYM::uuid;

CREATE TEMP TABLE bm_members AS
  SELECT id, (row_number() OVER ())::int AS rn FROM profiles WHERE gym_id = :GYM::uuid;
ALTER TABLE bm_members ADD PRIMARY KEY (rn);

-- check_ins has a one-per-member-per-day unique constraint, so generate
-- distinct (member, day) pairs: each member visits a random ~28% of the last
-- 90 days → ~50k check-ins, no same-day collisions.
INSERT INTO check_ins (profile_id, gym_id, checked_in_at, method)
SELECT m.id, :GYM::uuid,
       (now()::date - d)::timestamptz + (random() * 12 * interval '1 hour'),
       (ARRAY['qr','manual','gps']::checkin_method[])[1 + floor(random() * 3)::int]
FROM bm_members m
CROSS JOIN generate_series(0, 89) d
WHERE random() < 0.28;

INSERT INTO workout_sessions
  (profile_id, gym_id, name, status, started_at, completed_at, duration_seconds, total_volume_lbs)
SELECT m.id, :GYM::uuid, 'Bench Session', 'completed',
       s.started, s.started + interval '1 hour', 3600,
       round((random() * 15000)::numeric, 2)
FROM generate_series(1, :N_SESSIONS) g
JOIN bm_members m ON m.rn = 1 + floor(random() * :N_MEMBERS)::int
CROSS JOIN LATERAL (SELECT now() - (random() * 60 * interval '1 day') AS started) s;

INSERT INTO churn_risk_scores (profile_id, gym_id, score, risk_tier, key_signals, computed_at)
SELECT id, :GYM::uuid,
       round((random() * 100)::numeric, 1),
       (ARRAY['low','medium','high','critical'])[1 + floor(random() * 4)::int],
       ARRAY['recency','frequency_drop'],
       now() - (random() * 7 * interval '1 day')
FROM bm_members;

SET session_replication_role = origin;

ANALYZE profiles;
ANALYZE check_ins;
ANALYZE workout_sessions;
ANALYZE churn_risk_scores;

SELECT
  (SELECT count(*) FROM profiles          WHERE gym_id = :GYM::uuid) AS members,
  (SELECT count(*) FROM check_ins         WHERE gym_id = :GYM::uuid) AS check_ins,
  (SELECT count(*) FROM workout_sessions  WHERE gym_id = :GYM::uuid) AS sessions,
  (SELECT count(*) FROM churn_risk_scores WHERE gym_id = :GYM::uuid) AS churn_scores;
