-- =============================================================
-- LIFECYCLE MESSAGE SEQUENCES — Phase 2 retention
-- Migration: 0400_lifecycle_messages.sql
--
-- Scheduled, programmed-everyone messages at habit-formation
-- milestones (Day 1, 3, 7, 14, 21, 30 after joining the gym).
-- These do NOT violate the witnessing-at-scale thesis because they
-- are clearly system-generated — they don't pretend to come from
-- the owner. They handle the maintenance layer for healthy
-- members; the orchestrator queue (migration 0398) handles the
-- high-touch witnessing layer for at-risk members.
--
-- Why pure SQL (no edge function in V1):
--   The send path is just an INSERT into `notifications` — the
--   member sees the message in their in-app inbox on next open.
--   Adding native push delivery is straightforward later via an
--   edge function + pg_net cron, but doubles the surface area.
--   PR-economy thinking: ship the simpler thing, measure, iterate.
--
-- Catch-up semantics:
--   The function sends AT MOST ONE step per member per day,
--   picking the EARLIEST unsent eligible step. So a member who
--   joined 30 days ago and never received any lifecycle message
--   will get Day 1 today, Day 3 tomorrow, Day 7 next, etc.
--   Polite to new gyms — backfilling without spamming.
-- =============================================================

-- ── Sent-step log (dedup guarantee) ─────────────────────────
-- One row per (member, step) — strict UNIQUE prevents re-sends
-- even if the cron runs twice on the same day.
CREATE TABLE IF NOT EXISTS lifecycle_message_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  step_key    TEXT NOT NULL,    -- 'day_1','day_3','day_7','day_14','day_21','day_30'
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, step_key)
);

CREATE INDEX idx_lifecycle_log_gym_step
  ON lifecycle_message_log (gym_id, step_key, sent_at DESC);

ALTER TABLE lifecycle_message_log ENABLE ROW LEVEL SECURITY;

-- Admins/super_admins/trainers can read for their gym (effectiveness
-- analysis: "of members who got Day 7, how many were still active
-- at Day 60?"). Writes only via the cron SECURITY DEFINER function.
CREATE POLICY "lifecycle_log_read_staff"
  ON lifecycle_message_log
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- ── Step definitions ────────────────────────────────────────
-- Returns one row per defined step. Centralized so the cron and any
-- future admin UI both pull from the same source of truth.
CREATE OR REPLACE FUNCTION lifecycle_steps()
RETURNS TABLE (step_key TEXT, step_day INTEGER, sort_order INTEGER)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('day_1',  1,  1),
    ('day_3',  3,  2),
    ('day_7',  7,  3),
    ('day_14', 14, 4),
    ('day_21', 21, 5),
    ('day_30', 30, 6)
  ) AS t(step_key, step_day, sort_order);
$$;

-- ── Template lookup ─────────────────────────────────────────
-- Hardcoded EN + ES copy. Returns (title, body) for a given
-- (step_key, language). {{first_name}} is interpolated by the caller.
-- Future: move to a `lifecycle_message_templates` table when an admin
-- UI exists for editing copy.
CREATE OR REPLACE FUNCTION lifecycle_template(p_step_key TEXT, p_lang TEXT)
RETURNS TABLE (title TEXT, body TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT title, body FROM (VALUES
    -- Day 1 — welcome
    ('day_1', 'en',
      'Welcome aboard, {{first_name}}',
      'Your first workout is the hardest. Let''s get it on the board this week.'),
    ('day_1', 'es',
      'Bienvenido a bordo, {{first_name}}',
      'El primer entrenamiento es el más difícil. Vamos a meterlo en el récord esta semana.'),
    -- Day 3 — habit nudge
    ('day_3', 'en',
      'Day 3 — keep the momentum',
      'Most people quit before day 5. Get one more session in and you''ve already beaten the average.'),
    ('day_3', 'es',
      'Día 3 — mantén el ritmo',
      'La mayoría se rinde antes del día 5. Una sesión más y ya superas el promedio.'),
    -- Day 7 — week one
    ('day_7', 'en',
      'One week down 🔥',
      'You stuck with it past the first week. Statistically that''s the hardest part — it gets easier from here.'),
    ('day_7', 'es',
      'Una semana lista 🔥',
      'Aguantaste la primera semana. Estadísticamente esa es la parte más difícil — de aquí en adelante se pone más fácil.'),
    -- Day 14 — two weeks
    ('day_14', 'en',
      'Two weeks in, {{first_name}}',
      'You''re past the cliff where most people drop off. The work is starting to compound.'),
    ('day_14', 'es',
      'Dos semanas, {{first_name}}',
      'Ya pasaste el acantilado donde la mayoría abandona. El trabajo empieza a acumularse.'),
    -- Day 21 — habit anchor
    ('day_21', 'en',
      '21 days — habit territory',
      'Research says 21 days is when a behavior starts to stick. You did it. Now it''s about consistency.'),
    ('day_21', 'es',
      '21 días — territorio de hábito',
      'La ciencia dice que a los 21 días un hábito empieza a asentarse. Lo lograste. Ahora es cuestión de consistencia.'),
    -- Day 30 — one month
    ('day_30', 'en',
      'One month strong 💪',
      'A full month of showing up, {{first_name}}. That''s further than 80% of new members ever get. Proud of you.'),
    ('day_30', 'es',
      'Un mes fuerte 💪',
      'Un mes completo apareciendo, {{first_name}}. Eso es más lejos de lo que llega el 80% de los miembros nuevos. Orgullosos de ti.')
  ) AS t(k, l, title, body)
  WHERE k = p_step_key
    AND (l = COALESCE(p_lang, 'en') OR l = 'en')
  ORDER BY (l = COALESCE(p_lang, 'en')) DESC   -- prefer exact lang match, fall back to en
  LIMIT 1;
$$;

-- ── The send function ───────────────────────────────────────
-- Daily cron handler. Idempotent (UNIQUE constraint prevents re-sends).
-- Sends at most ONE step per member per run — earliest unsent eligible
-- step. Returns counts for the cron log.
CREATE OR REPLACE FUNCTION run_lifecycle_messages_daily()
RETURNS TABLE (sent_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sent INTEGER := 0;
BEGIN
  -- For each active member, find the earliest eligible step they
  -- haven't received yet and send it.
  --
  -- Eligibility = tenure_days >= step_day. The earliest unsent
  -- eligible step is the one to send today (catch-up semantics).
  WITH active_members AS (
    SELECT
      p.id AS profile_id,
      p.gym_id,
      p.full_name,
      COALESCE(p.preferred_language, 'en') AS lang,
      GREATEST(
        0,
        (CURRENT_DATE - COALESCE(p.membership_started_at, (p.created_at AT TIME ZONE 'UTC')::DATE))::INTEGER
      ) AS tenure_days
    FROM profiles p
    WHERE p.role = 'member'
      AND p.membership_status = 'active'
      AND p.gym_id IS NOT NULL
  ),
  -- Cross-join members with steps; filter to eligible+unsent;
  -- pick the earliest per member.
  due_steps AS (
    SELECT DISTINCT ON (am.profile_id)
      am.profile_id,
      am.gym_id,
      am.full_name,
      am.lang,
      s.step_key,
      s.step_day,
      s.sort_order
    FROM active_members am
    CROSS JOIN lifecycle_steps() s
    WHERE am.tenure_days >= s.step_day
      AND NOT EXISTS (
        SELECT 1 FROM lifecycle_message_log lml
        WHERE lml.profile_id = am.profile_id
          AND lml.step_key   = s.step_key
      )
    ORDER BY am.profile_id, s.sort_order ASC
  ),
  -- Materialize the rendered template for each due send.
  rendered AS (
    SELECT
      ds.profile_id,
      ds.gym_id,
      ds.step_key,
      REPLACE(tpl.title, '{{first_name}}',
              COALESCE(NULLIF(SPLIT_PART(ds.full_name, ' ', 1), ''), '')) AS title,
      REPLACE(tpl.body,  '{{first_name}}',
              COALESCE(NULLIF(SPLIT_PART(ds.full_name, ' ', 1), ''), '')) AS body
    FROM due_steps ds
    CROSS JOIN LATERAL lifecycle_template(ds.step_key, ds.lang) tpl
  ),
  -- Insert the in-app notifications. The notifications table has a
  -- unique partial index on (profile_id, dedup_key) — we use a stable
  -- dedup_key per (member, step) so even a double-run is safe.
  inserted_notifs AS (
    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
    SELECT
      r.profile_id,
      r.gym_id,
      'system'::notification_type,
      r.title,
      r.body,
      'lifecycle_' || r.step_key || '_' || r.profile_id::TEXT
    FROM rendered r
    ON CONFLICT DO NOTHING
    RETURNING profile_id
  ),
  -- Log the send. UNIQUE on (profile_id, step_key) protects against
  -- double-sends across cron runs; ON CONFLICT swallows the dup.
  logged AS (
    INSERT INTO lifecycle_message_log (profile_id, gym_id, step_key)
    SELECT r.profile_id, r.gym_id, r.step_key
    FROM rendered r
    ON CONFLICT (profile_id, step_key) DO NOTHING
    RETURNING profile_id
  )
  SELECT COUNT(*)::INTEGER INTO v_sent FROM logged;

  RETURN QUERY SELECT v_sent;
END;
$$;

REVOKE EXECUTE ON FUNCTION run_lifecycle_messages_daily()       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION run_lifecycle_messages_daily()       TO service_role;
REVOKE EXECUTE ON FUNCTION lifecycle_template(TEXT, TEXT)       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lifecycle_template(TEXT, TEXT)       TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION lifecycle_steps()                    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lifecycle_steps()                    TO authenticated, service_role;

-- ── Daily cron: 14:00 UTC (= 10:00 AST in Puerto Rico) ──────
-- Mid-morning local — high open-rate window when members are most
-- likely to see the in-app notification on their phone.
SELECT cron.schedule(
  'run-lifecycle-messages',
  '0 14 * * *',
  $$ SELECT run_lifecycle_messages_daily(); $$
);
