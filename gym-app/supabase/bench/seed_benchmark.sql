-- ============================================================
-- seed_benchmark.sql — synthetic FUTURE-SCALE data for ONE gym
-- Run against LOCAL supabase only (postgres superuser).
-- Volumes chosen to model a busy single gym ~1 year in:
--   2,000 members, 50,000 check-ins (90d), 40,000 completed
--   sessions (60d), one churn score per member.
-- Edit the three counts below to scale up/down.
-- ============================================================
\set ON_ERROR_STOP on
\timing on

\set GYM '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set N_MEMBERS 2000
\set N_CHECKINS 50000
\set N_SESSIONS 40000

-- We insert auth.users directly; disable any handle_new_user trigger so we
-- control profile rows ourselves.
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Gym ─────────────────────────────────────────────────────
INSERT INTO gyms (id, name, slug, timezone, is_active)
VALUES (:GYM::uuid, 'Benchmark Gym', 'benchmark-gym', 'America/Puerto_Rico', true)
ON CONFLICT (id) DO NOTHING;

-- ── auth.users (minimal; password is a dummy hash, we set JWT claims
--    directly in the benchmark instead of logging in) ─────────
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data)
SELECT '00000000-0000-0000-0000-000000000000',
       gen_random_uuid(), 'authenticated', 'authenticated',
       'bench' || g || '@bench.local',
       '$2a$10$benchbenchbenchbenchbenchbenchbenchbenchbe',
       now(),
       now() - (random() * 365 * interval '1 day'),
       now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{}'::jsonb
FROM generate_series(1, :N_MEMBERS) g;

-- ── profiles (spread last_active_at over 0–60d so churn tiers vary) ──
INSERT INTO profiles
  (id, gym_id, role, username, full_name,
   is_onboarded, imported_archived, membership_status,
   last_active_at, created_at)
SELECT u.id, :GYM::uuid, 'member',
       'bench_' || substr(u.id::text, 1, 8),
       'Bench Member ' || substr(u.id::text, 1, 4),
       true, false, 'active',
       now() - (random() * 60 * interval '1 day'),
       u.created_at
FROM auth.users u
WHERE u.email LIKE 'bench%@bench.local';

-- Promote one profile to admin/owner so the admin-overview RLS path resolves.
UPDATE profiles SET role = 'admin'
WHERE id = (SELECT id FROM profiles WHERE gym_id = :GYM::uuid ORDER BY created_at LIMIT 1);

UPDATE gyms SET owner_user_id = (SELECT id FROM profiles WHERE gym_id = :GYM::uuid AND role = 'admin' LIMIT 1)
WHERE id = :GYM::uuid;

-- Numbered member lookup for fast random fan-out.
CREATE TEMP TABLE bm_members AS
  SELECT id, (row_number() OVER ())::int AS rn FROM profiles WHERE gym_id = :GYM::uuid;
ALTER TABLE bm_members ADD PRIMARY KEY (rn);

-- ── check_ins (90 days) ─────────────────────────────────────
INSERT INTO check_ins (profile_id, gym_id, checked_in_at, method)
SELECT m.id, :GYM::uuid,
       now() - (random() * 90 * interval '1 day') - (random() * 12 * interval '1 hour'),
       (ARRAY['qr','manual','gps']::checkin_method[])[1 + floor(random() * 3)::int]
FROM generate_series(1, :N_CHECKINS) g
JOIN bm_members m ON m.rn = 1 + floor(random() * :N_MEMBERS)::int;

-- ── workout_sessions (60 days, completed) ───────────────────
INSERT INTO workout_sessions
  (profile_id, gym_id, name, status, started_at, completed_at,
   duration_seconds, total_volume_lbs)
SELECT m.id, :GYM::uuid, 'Bench Session', 'completed',
       s.started, s.started + interval '1 hour', 3600,
       round((random() * 15000)::numeric, 2)
FROM generate_series(1, :N_SESSIONS) g
JOIN bm_members m ON m.rn = 1 + floor(random() * :N_MEMBERS)::int
CROSS JOIN LATERAL (SELECT now() - (random() * 60 * interval '1 day') AS started) s;

-- ── churn_risk_scores (one per member) ──────────────────────
INSERT INTO churn_risk_scores (profile_id, gym_id, score, risk_tier, key_signals, computed_at)
SELECT id, :GYM::uuid,
       round((random() * 100)::numeric, 1),
       (ARRAY['low','medium','high','critical'])[1 + floor(random() * 4)::int],
       ARRAY['recency','frequency_drop'],
       now() - (random() * 7 * interval '1 day')
FROM bm_members;

ALTER TABLE auth.users ENABLE TRIGGER USER;

-- Fresh stats so EXPLAIN ANALYZE reflects real plans.
ANALYZE profiles;
ANALYZE check_ins;
ANALYZE workout_sessions;
ANALYZE churn_risk_scores;

SELECT
  (SELECT count(*) FROM profiles            WHERE gym_id = :GYM::uuid) AS members,
  (SELECT count(*) FROM check_ins           WHERE gym_id = :GYM::uuid) AS check_ins,
  (SELECT count(*) FROM workout_sessions    WHERE gym_id = :GYM::uuid) AS sessions,
  (SELECT count(*) FROM churn_risk_scores   WHERE gym_id = :GYM::uuid) AS churn_scores;
