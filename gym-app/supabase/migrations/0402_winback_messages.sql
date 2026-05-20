-- =============================================================
-- WIN-BACK AUTOMATION — closes the cancellation loop
-- Migration: 0402_winback_messages.sql
--
-- Reads cancellation_reasons (0396) to drive category-aware
-- win-back outreach at Day 7 / Day 30 / Day 60 post-cancellation.
-- Each touchpoint is digital (in-app + push) — fits the <1% revenue
-- ceiling. Lob mail / SMS is intentionally NOT used; PR economics
-- already killed that vector.
--
-- Why this matters: the exit survey is the only place a former
-- member ever tells us why they left and what would bring them back.
-- Without an automation that USES that data, the survey is just an
-- audit trail. With this automation, the data becomes a feedback
-- loop — "told us price → got a price-relevant offer 30 days later".
--
-- Thesis discipline: these are programmed-everyone messages, so they
-- don't violate witnessing-at-scale. They look auto, they ARE auto,
-- and they leave space for the owner to follow up personally (which
-- the orchestrator queue handles via the 'churned' segment).
--
-- Cadence (catch-up semantics same as lifecycle messages):
--   Day 7   — warm acknowledgment, category-insensitive
--   Day 30  — acknowledgment with category-aware TONE (no offer)
--   Day 60  — gentle closure, "we'll stop here"
--   Day 60+ — silent (member is "respectfully done")
--
-- DEFAULTS DO NOT PROMISE OFFERS. Specific incentives (discounts, free
-- passes, free trainer sessions) are gym-owner business decisions, not
-- platform decisions. The auto-pushes acknowledge the relationship and
-- stay warm; offers happen in real owner conversations via the
-- orchestrator queue (0398). Gyms that want to surface their own
-- offers can override defaults via per-gym templates (future ticket).
--
-- Categories with special handling:
--   moved   — skip all touchpoints (geography isn't addressable)
--   health  — skip Day 30 + Day 60 (sensitive); only Day 7 warm note
-- =============================================================

-- ── Sent-step log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS winback_message_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id            UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  -- The cancellation_reasons row that drove this send (kept FK so
  -- if the cancellation gets purged, the log goes too — preserves
  -- audit integrity).
  cancellation_id   UUID REFERENCES cancellation_reasons(id) ON DELETE CASCADE,
  step_key          TEXT NOT NULL,    -- 'day_7','day_30','day_60'
  -- Snapshot of which category drove the template choice. Stored so
  -- we can A/B analyse later ("did 'financial' Day-30 outperform 'time'?")
  category          cancellation_reason_category,

  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  push_request_id   BIGINT,           -- mirrors lifecycle_message_log
  push_queued_at    TIMESTAMPTZ,

  UNIQUE (profile_id, cancellation_id, step_key)
);

CREATE INDEX idx_winback_log_gym_step
  ON winback_message_log (gym_id, step_key, sent_at DESC);

ALTER TABLE winback_message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "winback_log_read_staff"
  ON winback_message_log
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- ── Step definitions ────────────────────────────────────────
CREATE OR REPLACE FUNCTION winback_steps()
RETURNS TABLE (step_key TEXT, step_day INTEGER, sort_order INTEGER)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('day_7',  7,  1),
    ('day_30', 30, 2),
    ('day_60', 60, 3)
  ) AS t(step_key, step_day, sort_order);
$$;

-- ── Templates: keyed by (step_key, language, category) ──────
-- Day 7 is category-insensitive (always warm acknowledgment).
-- Day 30 + Day 60 vary by category. NULL category falls back to a
-- generic template via the COALESCE chain in the lookup function.
--
-- 'moved' and 'health' rows are deliberately omitted for Day 30/60 —
-- the lookup returns 0 rows for those, signaling the cron to skip.
CREATE OR REPLACE FUNCTION winback_template(
  p_step_key TEXT,
  p_lang     TEXT,
  p_category cancellation_reason_category
)
RETURNS TABLE (title TEXT, body TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  -- Defaults are deliberately acknowledgment-only — NO promises of
  -- discounts, free passes, or specific gym offerings. That kind of
  -- offer is a gym-owner business decision, not a platform decision.
  -- The owner makes specific offers via real conversations (handled by
  -- the orchestrator queue, migration 0398). This automation just
  -- keeps the relationship warm without putting words in the owner's
  -- mouth. Per-gym overrides can layer on offers later via DB.
  WITH all_templates AS (
    SELECT * FROM (VALUES
      -- ── DAY 7 — warm acknowledgment, category-insensitive ──
      ('day_7', 'en', NULL::cancellation_reason_category,
        'We''re thinking of you',
        'The gym''s not the same without you. No pressure, no pitch — just wanted you to know you''re missed.'),
      ('day_7', 'es', NULL::cancellation_reason_category,
        'Pensamos en ti',
        'El gimnasio no es lo mismo sin ti. Sin presión, sin venta — solo queríamos que supieras que te extrañamos.'),

      -- ── DAY 30 — category-aware TONE, no offers ──
      ('day_30', 'en', 'financial'::cancellation_reason_category,
        'We get it',
        'Fitness shouldn''t feel like a luxury. We''re here when the time''s right for you.'),
      ('day_30', 'es', 'financial'::cancellation_reason_category,
        'Entendemos',
        'El fitness no debería sentirse como un lujo. Estamos aquí cuando sea el momento adecuado para ti.'),

      ('day_30', 'en', 'time'::cancellation_reason_category,
        'Life gets crowded',
        'When things slow down and you''re ready to come back, we''ll be here. No rush.'),
      ('day_30', 'es', 'time'::cancellation_reason_category,
        'La vida se llena',
        'Cuando las cosas se calmen y estés listo para regresar, aquí estaremos. Sin prisa.'),

      ('day_30', 'en', 'no_results'::cancellation_reason_category,
        'Progress is slow before it isn''t',
        'If you''re ever ready to give it another shot, the door''s open.'),
      ('day_30', 'es', 'no_results'::cancellation_reason_category,
        'El progreso es lento hasta que deja de serlo',
        'Si en algún momento estás listo para intentarlo de nuevo, la puerta está abierta.'),

      ('day_30', 'en', 'experience'::cancellation_reason_category,
        'Thanks for being honest with us',
        'Your feedback helps us get better. If you want to give us another try someday, you know where to find us.'),
      ('day_30', 'es', 'experience'::cancellation_reason_category,
        'Gracias por tu honestidad',
        'Tu retroalimentación nos ayuda a mejorar. Si quieres darnos otra oportunidad algún día, ya sabes dónde encontrarnos.'),

      -- Day 30 generic fallback (NULL or 'other' category)
      ('day_30', 'en', 'other'::cancellation_reason_category,
        'Whenever you''re ready',
        'No pressure, no pitch. Just an open door if you ever want to come back.'),
      ('day_30', 'es', 'other'::cancellation_reason_category,
        'Cuando estés listo',
        'Sin presión, sin venta. Solo una puerta abierta si alguna vez quieres regresar.'),

      -- ── DAY 60 — gentle closure, no offers ──
      -- Same copy across all categories: we tried twice, time to let it rest.
      ('day_60', 'en', 'other'::cancellation_reason_category,
        'We''ll stop here',
        'This is the last time we''ll reach out — promise. The door stays open. Take care.'),
      ('day_60', 'es', 'other'::cancellation_reason_category,
        'Aquí lo dejamos',
        'Esta es la última vez que te contactamos — palabra. La puerta sigue abierta. Cuídate.')

    ) AS t(k, l, c, title, body)
  )
  -- Resolution order (tied keys broken by ORDER BY):
  --   1. exact (step, lang, category)            ← perfect match
  --   2. exact (step, en,  category)             ← lang fallback
  --   3. exact (step, lang, 'other')             ← category fallback
  --   4. exact (step, en,  'other')              ← both fallbacks
  --   5. (step, lang, NULL)                      ← category-insensitive
  --                                                (Day 7 lives here)
  --   6. (step, en,  NULL)
  -- No match → 0 rows → caller skips.
  SELECT title, body
  FROM all_templates
  WHERE k = p_step_key
    AND (l = COALESCE(p_lang, 'en') OR l = 'en')
    AND (
      c IS NOT DISTINCT FROM p_category                          -- exact match
      OR c = 'other'::cancellation_reason_category               -- generic fallback
      OR c IS NULL                                                -- category-insensitive (Day 7)
    )
  ORDER BY
    (l = COALESCE(p_lang, 'en')) DESC,                            -- prefer requested language
    (c IS NOT DISTINCT FROM p_category) DESC,                     -- prefer exact category
    (c = 'other'::cancellation_reason_category) DESC,             -- prefer 'other' over NULL
    (c IS NOT NULL) DESC                                          -- NULL is the catch-all
  LIMIT 1;
$$;

-- ── Send function ───────────────────────────────────────────
-- Daily cron. For each member with a cancellation in the right
-- window, finds the earliest unsent step and sends it.
--
-- Special-case skip rules:
--   - category = 'moved'  → skip all steps
--   - category = 'health' → skip Day 30 + Day 60 (only Day 7 warm note)
--   - membership reactivated  → SKIP. We only send win-back while the
--                                member is currently in 'cancelled' status.
--                                If they re-cancel later, a fresh
--                                cancellation_reasons row starts the
--                                cadence over.
CREATE OR REPLACE FUNCTION run_winback_messages_daily()
RETURNS TABLE (sent_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sent INTEGER := 0;
BEGIN
  -- Latest cancellation per CURRENTLY-CANCELLED member.
  -- Joining against profiles + filtering on membership_status here
  -- means reactivated members are dropped from the funnel.
  WITH latest_cancellations AS (
    SELECT DISTINCT ON (cr.profile_id)
      cr.id                AS cancellation_id,
      cr.profile_id,
      cr.gym_id,
      cr.category,
      cr.recorded_at,
      EXTRACT(DAY FROM (NOW() - cr.recorded_at))::INTEGER AS days_since
    FROM cancellation_reasons cr
    JOIN profiles p ON p.id = cr.profile_id
    WHERE p.membership_status = 'cancelled'
    ORDER BY cr.profile_id, cr.recorded_at DESC
  ),
  -- Filter to actionable categories
  eligible_cancellations AS (
    SELECT lc.*
    FROM latest_cancellations lc
    WHERE lc.category IS DISTINCT FROM 'moved'::cancellation_reason_category
  ),
  -- Cross-join with steps; filter to eligible+unsent; pick earliest per member
  due_sends AS (
    SELECT DISTINCT ON (ec.profile_id)
      ec.cancellation_id,
      ec.profile_id,
      ec.gym_id,
      ec.category,
      s.step_key,
      s.step_day,
      s.sort_order
    FROM eligible_cancellations ec
    CROSS JOIN winback_steps() s
    WHERE ec.days_since >= s.step_day
      -- 'health' category: only Day 7 (skip 30 + 60 for sensitivity)
      AND NOT (
        ec.category = 'health'::cancellation_reason_category
        AND s.step_key IN ('day_30', 'day_60')
      )
      AND NOT EXISTS (
        SELECT 1 FROM winback_message_log wml
        WHERE wml.profile_id      = ec.profile_id
          AND wml.cancellation_id = ec.cancellation_id
          AND wml.step_key        = s.step_key
      )
    ORDER BY ec.profile_id, s.sort_order ASC
  ),
  -- Resolve recipient + template
  rendered AS (
    SELECT
      d.cancellation_id,
      d.profile_id,
      d.gym_id,
      d.category,
      d.step_key,
      p.full_name,
      COALESCE(p.preferred_language, 'en') AS lang,
      tpl.title AS raw_title,
      tpl.body  AS raw_body
    FROM due_sends d
    JOIN profiles p ON p.id = d.profile_id
    CROSS JOIN LATERAL winback_template(d.step_key, COALESCE(p.preferred_language, 'en'), d.category) tpl
    WHERE tpl.title IS NOT NULL    -- skip if no template (e.g. unknown category)
  ),
  -- Interpolate {{first_name}}
  finalized AS (
    SELECT
      r.*,
      REPLACE(r.raw_title, '{{first_name}}',
              COALESCE(NULLIF(SPLIT_PART(r.full_name, ' ', 1), ''), '')) AS title,
      REPLACE(r.raw_body,  '{{first_name}}',
              COALESCE(NULLIF(SPLIT_PART(r.full_name, ' ', 1), ''), '')) AS body
    FROM rendered r
  ),
  -- Insert the in-app notification (dedup via dedup_key)
  inserted_notifs AS (
    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
    SELECT
      f.profile_id,
      f.gym_id,
      'win_back'::notification_type,
      f.title,
      f.body,
      'winback_' || f.step_key || '_' || f.cancellation_id::TEXT
    FROM finalized f
    ON CONFLICT DO NOTHING
    RETURNING profile_id
  ),
  -- Log the send. UNIQUE on (profile_id, cancellation_id, step_key)
  -- is the dedup guard; AFTER INSERT trigger fires push for each row.
  logged AS (
    INSERT INTO winback_message_log
      (profile_id, gym_id, cancellation_id, step_key, category)
    SELECT
      f.profile_id, f.gym_id, f.cancellation_id, f.step_key, f.category
    FROM finalized f
    ON CONFLICT (profile_id, cancellation_id, step_key) DO NOTHING
    RETURNING profile_id
  )
  SELECT COUNT(*)::INTEGER INTO v_sent FROM logged;

  RETURN QUERY SELECT v_sent;
END;
$$;

-- ── Push delivery trigger ───────────────────────────────────
-- Mirrors lifecycle_message_log's trigger (0401) — every win-back
-- log row inserted fires a native push via send-push-user.
CREATE OR REPLACE FUNCTION fire_winback_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_key    TEXT;
  v_full   TEXT;
  v_lang   TEXT;
  v_title  TEXT;
  v_body   TEXT;
  v_first  TEXT;
  v_req_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG 'fire_winback_push: vault secrets not configured, skipping push for %', NEW.id;
    RETURN NEW;
  END IF;

  SELECT p.full_name, COALESCE(p.preferred_language, 'en')
    INTO v_full, v_lang
  FROM profiles p WHERE p.id = NEW.profile_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT title, body INTO v_title, v_body
  FROM winback_template(NEW.step_key, v_lang, NEW.category);

  IF v_title IS NULL THEN
    RAISE LOG 'fire_winback_push: no template for step %, lang %, category %',
              NEW.step_key, v_lang, NEW.category;
    RETURN NEW;
  END IF;

  v_first := COALESCE(NULLIF(SPLIT_PART(v_full, ' ', 1), ''), '');
  v_title := REPLACE(v_title, '{{first_name}}', v_first);
  v_body  := REPLACE(v_body,  '{{first_name}}', v_first);

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
                              'route',          '/notifications',
                              'type',           'win_back',
                              'winback_step',   NEW.step_key
                           ),
      'notification_type', 'win_back'
    )
  ) INTO v_req_id;

  UPDATE winback_message_log
  SET push_request_id = v_req_id,
      push_queued_at  = NOW()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fire_winback_push() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_fire_winback_push ON winback_message_log;
CREATE TRIGGER trg_fire_winback_push
  AFTER INSERT ON winback_message_log
  FOR EACH ROW
  EXECUTE FUNCTION fire_winback_push();

-- ── Permissions ─────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION run_winback_messages_daily()                                                 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION run_winback_messages_daily()                                                 TO service_role;
REVOKE EXECUTE ON FUNCTION winback_steps()                                                              FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION winback_steps()                                                              TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION winback_template(TEXT, TEXT, cancellation_reason_category)                   FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION winback_template(TEXT, TEXT, cancellation_reason_category)                   TO authenticated, service_role;

-- ── Daily cron: 15:00 UTC (= 11:00 AST in Puerto Rico) ──────
-- One hour after lifecycle messages (14:00 UTC) so the two batches
-- don't compete for pg_net workers.
SELECT cron.schedule(
  'run-winback-messages',
  '0 15 * * *',
  $$ SELECT run_winback_messages_daily(); $$
);
