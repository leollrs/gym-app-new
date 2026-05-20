-- =============================================================
-- MILESTONE PUSH CRON — workout-count celebrations
-- Migration: 0409_milestone_push_cron.sql
--
-- Auto-touches at programmed workout-count milestones (10, 25,
-- 50, 100, 200, 500). These do NOT violate witnessing-at-scale:
-- they're clearly system-generated "you hit 50 workouts"
-- celebrations, not pretend-personal messages from the owner.
-- The owner queue (0398 orchestrator + 0406 morning queue)
-- still handles every relationship moment.
--
-- Architecture mirrors lifecycle messages (0400 + 0401):
--   1. Strict UNIQUE log row per (profile_id, milestone_key) so
--      each milestone fires exactly once per member ever.
--   2. SECURITY DEFINER daily function picks the SMALLEST unsent
--      eligible threshold per member — catch-up semantics with
--      no spam-the-newcomer dump (a member with 600 workouts on
--      day one gets workouts_10 today, workouts_25 tomorrow,
--      workouts_50 the next day, etc).
--   3. AFTER INSERT trigger on milestone_push_log fires pg_net
--      → send-push-user, mirroring fire_lifecycle_push (0401).
--      Vault-missing case is a graceful no-op: the in-app
--      notification + log row still land; only push is skipped.
--
-- PREREQUISITE — same secrets the rest of the retention stack uses:
--   SELECT vault.create_secret('<supabase-url>',     'supabase_url',     'Project URL');
--   SELECT vault.create_secret('<service-role-key>', 'service_role_key', 'Service role key');
-- =============================================================

-- ── 1. Log table (strict per-member-per-milestone dedup) ─────
CREATE TABLE IF NOT EXISTS milestone_push_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id            UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  milestone_key     TEXT NOT NULL,   -- 'workouts_10', 'workouts_25', etc.
  milestone_n       INTEGER NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  push_request_id   BIGINT,          -- pg_net request id (NULL = push skipped)
  push_queued_at    TIMESTAMPTZ,     -- when the trigger fired pg_net
  UNIQUE (profile_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS idx_milestone_push_log_gym_sent
  ON milestone_push_log (gym_id, sent_at DESC);

-- ── 2. RLS — staff read only; writes via cron SECURITY DEFINER
ALTER TABLE milestone_push_log ENABLE ROW LEVEL SECURITY;

-- Admins/super_admins/trainers can read for their gym (effectiveness
-- analysis: "of members who hit workouts_50, what's their 90-day
-- retention?"). No write policies — only the SECURITY DEFINER cron
-- function inserts. RLS blocks all other paths.
DROP POLICY IF EXISTS "milestone_push_log_read_staff" ON milestone_push_log;
CREATE POLICY "milestone_push_log_read_staff"
  ON milestone_push_log
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- ── 3. Threshold definitions ─────────────────────────────────
-- Returns one row per defined threshold. Centralized so the cron
-- and any future admin UI both pull from the same source of truth.
CREATE OR REPLACE FUNCTION milestone_thresholds()
RETURNS TABLE (milestone_key TEXT, milestone_n INTEGER, sort_order INTEGER)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('workouts_10',  10,  1),
    ('workouts_25',  25,  2),
    ('workouts_50',  50,  3),
    ('workouts_100', 100, 4),
    ('workouts_200', 200, 5),
    ('workouts_500', 500, 6)
  ) AS t(milestone_key, milestone_n, sort_order);
$$;

-- ── 4. Template lookup (EN + ES) ─────────────────────────────
-- Hardcoded copy. Returns (title, body) for a given
-- (milestone_key, language). {{first_name}} is interpolated by the caller.
CREATE OR REPLACE FUNCTION milestone_template(p_milestone_key TEXT, p_lang TEXT)
RETURNS TABLE (title TEXT, body TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT title, body FROM (VALUES
    -- 10 workouts
    ('workouts_10', 'en',
      '10 workouts logged 🏆',
      '{{first_name}}, you''re past day-one talk. Ten sessions on the board — keep it going.'),
    ('workouts_10', 'es',
      '10 entrenamientos registrados 🏆',
      '{{first_name}}, ya pasaste de palabras. Diez sesiones en el récord — sigue así.'),
    -- 25 workouts
    ('workouts_25', 'en',
      '25 workouts logged 🏆',
      '{{first_name}}, 25 sessions in. That''s a real habit forming. Proud of you.'),
    ('workouts_25', 'es',
      '25 entrenamientos registrados 🏆',
      '{{first_name}}, 25 sesiones completas. Eso es un hábito real formándose. Orgullosos de ti.'),
    -- 50 workouts
    ('workouts_50', 'en',
      '50 workouts logged 🏆',
      '{{first_name}}, that''s real consistency. Proud of you.'),
    ('workouts_50', 'es',
      '50 entrenamientos registrados 🏆',
      '{{first_name}}, eso es consistencia real. Orgullosos de ti.'),
    -- 100 workouts
    ('workouts_100', 'en',
      '100 workouts logged 🏆',
      '{{first_name}}, triple digits. Most people never get here. You did.'),
    ('workouts_100', 'es',
      '100 entrenamientos registrados 🏆',
      '{{first_name}}, tres dígitos. La mayoría nunca llega. Tú sí.'),
    -- 200 workouts
    ('workouts_200', 'en',
      '200 workouts logged 🏆',
      '{{first_name}}, 200 sessions. This isn''t a phase anymore — it''s who you are.'),
    ('workouts_200', 'es',
      '200 entrenamientos registrados 🏆',
      '{{first_name}}, 200 sesiones. Esto ya no es una fase — es quién eres.'),
    -- 500 workouts
    ('workouts_500', 'en',
      '500 workouts logged 🏆',
      '{{first_name}}, 500. Five hundred. You set the standard at this gym.'),
    ('workouts_500', 'es',
      '500 entrenamientos registrados 🏆',
      '{{first_name}}, 500. Quinientos. Tú pones el estándar en este gimnasio.')
  ) AS t(k, l, title, body)
  WHERE k = p_milestone_key
    AND (l = COALESCE(p_lang, 'en') OR l = 'en')
  ORDER BY (l = COALESCE(p_lang, 'en')) DESC   -- prefer exact lang match, fall back to en
  LIMIT 1;
$$;

-- ── 5. Daily send function ──────────────────────────────────
-- Picks AT MOST ONE milestone per member per run — the SMALLEST
-- threshold they're already past AND haven't received yet.
-- A member with 600 workouts on day one gets workouts_10 today,
-- workouts_25 tomorrow, etc — never the whole stack at once.
CREATE OR REPLACE FUNCTION run_milestone_pushes_daily()
RETURNS TABLE (sent_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sent INTEGER := 0;
BEGIN
  -- Active members with their completed workout count.
  WITH active_members AS (
    SELECT
      p.id      AS profile_id,
      p.gym_id,
      p.full_name,
      COALESCE(p.preferred_language, 'en') AS lang,
      (
        SELECT COUNT(*)::INTEGER
        FROM workout_sessions ws
        WHERE ws.profile_id = p.id
          AND ws.status = 'completed'
      ) AS workout_count
    FROM profiles p
    WHERE p.role = 'member'
      AND p.membership_status = 'active'
      AND p.gym_id IS NOT NULL
  ),
  -- Cross-join members with thresholds; filter to past+unsent;
  -- pick the SMALLEST per member (catch-up: workouts_10 first,
  -- not workouts_500 even if they have 600 sessions).
  due_milestones AS (
    SELECT DISTINCT ON (am.profile_id)
      am.profile_id,
      am.gym_id,
      am.full_name,
      am.lang,
      t.milestone_key,
      t.milestone_n,
      t.sort_order
    FROM active_members am
    CROSS JOIN milestone_thresholds() t
    WHERE am.workout_count >= t.milestone_n
      AND NOT EXISTS (
        SELECT 1 FROM milestone_push_log mpl
        WHERE mpl.profile_id    = am.profile_id
          AND mpl.milestone_key = t.milestone_key
      )
    ORDER BY am.profile_id, t.sort_order ASC
  ),
  -- Materialize the rendered template for each due send.
  rendered AS (
    SELECT
      dm.profile_id,
      dm.gym_id,
      dm.milestone_key,
      dm.milestone_n,
      REPLACE(tpl.title, '{{first_name}}',
              COALESCE(NULLIF(SPLIT_PART(dm.full_name, ' ', 1), ''), '')) AS title,
      REPLACE(tpl.body,  '{{first_name}}',
              COALESCE(NULLIF(SPLIT_PART(dm.full_name, ' ', 1), ''), '')) AS body
    FROM due_milestones dm
    CROSS JOIN LATERAL milestone_template(dm.milestone_key, dm.lang) tpl
  ),
  -- Insert the in-app notification. dedup_key keeps idempotency
  -- across re-runs (matches notifications dedup pattern, 0155).
  inserted_notifs AS (
    INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key)
    SELECT
      r.profile_id,
      r.gym_id,
      'milestone'::notification_type,
      r.title,
      r.body,
      jsonb_build_object(
        'route',         '/notifications',
        'milestone_key', r.milestone_key,
        'milestone_n',   r.milestone_n
      ),
      'milestone_' || r.milestone_key || '_' || r.profile_id::TEXT
    FROM rendered r
    ON CONFLICT DO NOTHING
    RETURNING profile_id
  ),
  -- Log the send. UNIQUE on (profile_id, milestone_key) protects
  -- against double-sends across cron runs; ON CONFLICT swallows
  -- the dup. The AFTER INSERT trigger fire_milestone_push() will
  -- queue the native push for each new log row.
  logged AS (
    INSERT INTO milestone_push_log (profile_id, gym_id, milestone_key, milestone_n)
    SELECT r.profile_id, r.gym_id, r.milestone_key, r.milestone_n
    FROM rendered r
    ON CONFLICT (profile_id, milestone_key) DO NOTHING
    RETURNING profile_id
  )
  SELECT COUNT(*)::INTEGER INTO v_sent FROM logged;

  RETURN QUERY SELECT v_sent;
END;
$$;

-- ── 6. Trigger: fire native push via pg_net → send-push-user ─
-- Mirrors fire_lifecycle_push from 0401. Graceful no-op when
-- vault secrets are missing — the in-app notification + log row
-- still landed via run_milestone_pushes_daily(); only the push
-- delivery is skipped.
CREATE OR REPLACE FUNCTION fire_milestone_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     TEXT;
  v_key     TEXT;
  v_full    TEXT;
  v_lang    TEXT;
  v_title   TEXT;
  v_body    TEXT;
  v_first   TEXT;
  v_req_id  BIGINT;
BEGIN
  -- Pull vault secrets. If missing, the in-app notification still
  -- landed via run_milestone_pushes_daily — we just skip the push.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG 'fire_milestone_push: vault secrets not configured, skipping push for %', NEW.id;
    RETURN NEW;
  END IF;

  -- Resolve recipient context.
  SELECT p.full_name, COALESCE(p.preferred_language, 'en')
    INTO v_full, v_lang
  FROM profiles p
  WHERE p.id = NEW.profile_id;

  -- Defensive: profile-row vanished (won't happen under normal use
  -- because of the FK CASCADE, but covers manual log inserts).
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Resolve template.
  SELECT title, body INTO v_title, v_body
  FROM milestone_template(NEW.milestone_key, v_lang);

  IF v_title IS NULL THEN
    RAISE LOG 'fire_milestone_push: no template for milestone % / lang %', NEW.milestone_key, v_lang;
    RETURN NEW;
  END IF;

  -- Interpolate {{first_name}}. Empty string when name is null —
  -- matches the in-app insert path in run_milestone_pushes_daily.
  v_first := COALESCE(NULLIF(SPLIT_PART(v_full, ' ', 1), ''), '');
  v_title := REPLACE(v_title, '{{first_name}}', v_first);
  v_body  := REPLACE(v_body,  '{{first_name}}', v_first);

  -- Fire the push asynchronously via pg_net. The return value is the
  -- pg_net request id (BIGINT), not the HTTP response — pg_net handles
  -- the HTTP call in a background worker.
  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push-user',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'profile_id',        NEW.profile_id,
      'gym_id',            NEW.gym_id,
      'title',             v_title,
      'body',              v_body,
      'data',              jsonb_build_object(
                              'route',         '/notifications',
                              'type',          'milestone',
                              'milestone_key', NEW.milestone_key,
                              'milestone_n',   NEW.milestone_n
                           ),
      'notification_type', 'milestone'
    )
  ) INTO v_req_id;

  -- Stamp the log row so we can audit later.
  UPDATE milestone_push_log
  SET push_request_id = v_req_id,
      push_queued_at  = NOW()
  WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Don't let push failures back out the log insert / cron run.
    RAISE WARNING 'fire_milestone_push trigger failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Lock down execution.
REVOKE EXECUTE ON FUNCTION fire_milestone_push()                FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_fire_milestone_push ON milestone_push_log;

-- Only create the trigger if pg_net extension is available
-- (matches the 0085 wallet trigger guard pattern).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    CREATE TRIGGER trg_fire_milestone_push
      AFTER INSERT ON milestone_push_log
      FOR EACH ROW
      EXECUTE FUNCTION fire_milestone_push();
  ELSE
    RAISE NOTICE 'pg_net extension not available — milestone push trigger not created. In-app notifications still flow via run_milestone_pushes_daily.';
  END IF;
END;
$$;

-- ── 7. Permissions ──────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION run_milestone_pushes_daily()         FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION run_milestone_pushes_daily()         TO service_role;

REVOKE EXECUTE ON FUNCTION milestone_template(TEXT, TEXT)       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION milestone_template(TEXT, TEXT)       TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION milestone_thresholds()               FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION milestone_thresholds()               TO authenticated, service_role;

-- ── 8. Daily cron — 16:00 UTC (= 12:00 AST in Puerto Rico) ──
-- PR is AST (UTC-4) year-round (no DST). 12:00 noon local is well
-- after lifecycle messages (10am, 0400) and any winback runs (~11am),
-- so they don't compete for pg_net workers. Midday is also a high
-- open-rate window — phones are out, lunch breaks, between meetings.
SELECT cron.schedule(
  'run-milestone-pushes',
  '0 16 * * *',
  $$ SELECT run_milestone_pushes_daily(); $$
);

NOTIFY pgrst, 'reload schema';
