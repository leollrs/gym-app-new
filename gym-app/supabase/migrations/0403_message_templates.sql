-- =============================================================
-- MESSAGE TEMPLATES — per-gym overrides for lifecycle + winback
-- Migration: 0403_message_templates.sql
--
-- Replaces the hardcoded SQL VALUES tables in 0400 (lifecycle) and
-- 0402 (winback) with a real `message_templates` table. Global
-- defaults are seeded with gym_id IS NULL; gyms can layer per-gym
-- overrides on top. This solves the brittle "platform decides what
-- the gym gives away" problem the win-back copy review surfaced:
-- a gym that wants to offer "free month back" can write its own
-- copy without us promising it on their behalf.
--
-- Lookup precedence (gym-specific beats global; exact lang beats en):
--   1. (gym_id, kind, step, lang, category)        ← perfect match
--   2. (gym_id, kind, step, 'en', category)        ← gym's en fallback
--   3. (NULL,   kind, step, lang, category)        ← global lang match
--   4. (NULL,   kind, step, 'en', category)        ← global en
--   5. same chain with category = 'other'          ← category fallback
--   6. same chain with category IS NULL            ← step-insensitive
--   No match → empty result → caller skips that send.
--
-- A disabled override (enabled=false) wins precedence — it lets a
-- gym EXPLICITLY OPT OUT of a step (e.g., "don't send Day 30
-- win-backs at our gym"). Returning empty for a disabled match
-- skips the send entirely rather than falling through to defaults.
-- =============================================================

-- ── Table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID REFERENCES gyms(id) ON DELETE CASCADE,    -- NULL = global default
  kind        TEXT NOT NULL CHECK (kind IN ('lifecycle', 'winback')),
  step_key    TEXT NOT NULL,
  language    TEXT NOT NULL,                                 -- 'en', 'es'
  category    cancellation_reason_category,                  -- NULL for lifecycle or category-insensitive winback
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULLS NOT DISTINCT so two rows with NULL category collide on the
  -- unique constraint (Postgres 15+). Same for NULL gym_id.
  UNIQUE NULLS NOT DISTINCT (gym_id, kind, step_key, language, category)
);

CREATE INDEX idx_message_templates_lookup
  ON message_templates (kind, step_key, language, gym_id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- Read: anyone authenticated can see global defaults; staff can see
-- their gym's overrides on top.
CREATE POLICY "message_templates_read"
  ON message_templates FOR SELECT
  USING (
    gym_id IS NULL
    OR gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- Write: admin/super_admin can manage ONLY their own gym's rows.
-- Global defaults (gym_id IS NULL) are seeded by migration and
-- editable only via SQL — never via the app.
CREATE POLICY "message_templates_write"
  ON message_templates FOR ALL
  USING (
    gym_id IS NOT NULL
    AND gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    gym_id IS NOT NULL
    AND gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- ── Updated_at maintenance ──────────────────────────────────
CREATE OR REPLACE FUNCTION touch_message_templates_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_templates_updated_at ON message_templates;
CREATE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW
  EXECUTE FUNCTION touch_message_templates_updated_at();

-- ── Seed global defaults (gym_id IS NULL) ───────────────────
-- Lifecycle: 6 steps × 2 languages = 12 rows. Copy mirrors 0400.
INSERT INTO message_templates (gym_id, kind, step_key, language, category, title, body) VALUES
  (NULL, 'lifecycle', 'day_1',  'en', NULL,
    'Welcome aboard, {{first_name}}',
    'Your first workout is the hardest. Let''s get it on the board this week.'),
  (NULL, 'lifecycle', 'day_1',  'es', NULL,
    'Bienvenido a bordo, {{first_name}}',
    'El primer entrenamiento es el más difícil. Vamos a meterlo en el récord esta semana.'),
  (NULL, 'lifecycle', 'day_3',  'en', NULL,
    'Day 3 — keep the momentum',
    'Most people quit before day 5. Get one more session in and you''ve already beaten the average.'),
  (NULL, 'lifecycle', 'day_3',  'es', NULL,
    'Día 3 — mantén el ritmo',
    'La mayoría se rinde antes del día 5. Una sesión más y ya superas el promedio.'),
  (NULL, 'lifecycle', 'day_7',  'en', NULL,
    'One week down 🔥',
    'You stuck with it past the first week. Statistically that''s the hardest part — it gets easier from here.'),
  (NULL, 'lifecycle', 'day_7',  'es', NULL,
    'Una semana lista 🔥',
    'Aguantaste la primera semana. Estadísticamente esa es la parte más difícil — de aquí en adelante se pone más fácil.'),
  (NULL, 'lifecycle', 'day_14', 'en', NULL,
    'Two weeks in, {{first_name}}',
    'You''re past the cliff where most people drop off. The work is starting to compound.'),
  (NULL, 'lifecycle', 'day_14', 'es', NULL,
    'Dos semanas, {{first_name}}',
    'Ya pasaste el acantilado donde la mayoría abandona. El trabajo empieza a acumularse.'),
  (NULL, 'lifecycle', 'day_21', 'en', NULL,
    '21 days — habit territory',
    'Research says 21 days is when a behavior starts to stick. You did it. Now it''s about consistency.'),
  (NULL, 'lifecycle', 'day_21', 'es', NULL,
    '21 días — territorio de hábito',
    'La ciencia dice que a los 21 días un hábito empieza a asentarse. Lo lograste. Ahora es cuestión de consistencia.'),
  (NULL, 'lifecycle', 'day_30', 'en', NULL,
    'One month strong 💪',
    'A full month of showing up, {{first_name}}. That''s further than 80% of new members ever get. Proud of you.'),
  (NULL, 'lifecycle', 'day_30', 'es', NULL,
    'Un mes fuerte 💪',
    'Un mes completo apareciendo, {{first_name}}. Eso es más lejos de lo que llega el 80% de los miembros nuevos. Orgullosos de ti.');

-- Winback: Day 7 (2) + Day 30 (10) + Day 60 (2) = 14 rows. Copy mirrors 0402 (post-offer-strip revision).
INSERT INTO message_templates (gym_id, kind, step_key, language, category, title, body) VALUES
  -- Day 7 — warm acknowledgment, category-insensitive
  (NULL, 'winback', 'day_7',  'en', NULL,
    'We''re thinking of you',
    'The gym''s not the same without you. No pressure, no pitch — just wanted you to know you''re missed.'),
  (NULL, 'winback', 'day_7',  'es', NULL,
    'Pensamos en ti',
    'El gimnasio no es lo mismo sin ti. Sin presión, sin venta — solo queríamos que supieras que te extrañamos.'),
  -- Day 30 — category-aware tone, no offers
  (NULL, 'winback', 'day_30', 'en', 'financial',
    'We get it',
    'Fitness shouldn''t feel like a luxury. We''re here when the time''s right for you.'),
  (NULL, 'winback', 'day_30', 'es', 'financial',
    'Entendemos',
    'El fitness no debería sentirse como un lujo. Estamos aquí cuando sea el momento adecuado para ti.'),
  (NULL, 'winback', 'day_30', 'en', 'time',
    'Life gets crowded',
    'When things slow down and you''re ready to come back, we''ll be here. No rush.'),
  (NULL, 'winback', 'day_30', 'es', 'time',
    'La vida se llena',
    'Cuando las cosas se calmen y estés listo para regresar, aquí estaremos. Sin prisa.'),
  (NULL, 'winback', 'day_30', 'en', 'no_results',
    'Progress is slow before it isn''t',
    'If you''re ever ready to give it another shot, the door''s open.'),
  (NULL, 'winback', 'day_30', 'es', 'no_results',
    'El progreso es lento hasta que deja de serlo',
    'Si en algún momento estás listo para intentarlo de nuevo, la puerta está abierta.'),
  (NULL, 'winback', 'day_30', 'en', 'experience',
    'Thanks for being honest with us',
    'Your feedback helps us get better. If you want to give us another try someday, you know where to find us.'),
  (NULL, 'winback', 'day_30', 'es', 'experience',
    'Gracias por tu honestidad',
    'Tu retroalimentación nos ayuda a mejorar. Si quieres darnos otra oportunidad algún día, ya sabes dónde encontrarnos.'),
  (NULL, 'winback', 'day_30', 'en', 'other',
    'Whenever you''re ready',
    'No pressure, no pitch. Just an open door if you ever want to come back.'),
  (NULL, 'winback', 'day_30', 'es', 'other',
    'Cuando estés listo',
    'Sin presión, sin venta. Solo una puerta abierta si alguna vez quieres regresar.'),
  -- Day 60 — gentle closure
  (NULL, 'winback', 'day_60', 'en', 'other',
    'We''ll stop here',
    'This is the last time we''ll reach out — promise. The door stays open. Take care.'),
  (NULL, 'winback', 'day_60', 'es', 'other',
    'Aquí lo dejamos',
    'Esta es la última vez que te contactamos — palabra. La puerta sigue abierta. Cuídate.');

-- ── Refactored template lookup functions ────────────────────
-- Drop old hardcoded versions and replace with table-driven lookup.
-- New signature adds p_gym_id so per-gym overrides are honoured.

DROP FUNCTION IF EXISTS lifecycle_template(TEXT, TEXT);
DROP FUNCTION IF EXISTS winback_template(TEXT, TEXT, cancellation_reason_category);

-- Lifecycle: no category dimension. Falls back to global defaults
-- when no per-gym row exists. Honours `enabled=false` as opt-out.
CREATE OR REPLACE FUNCTION lifecycle_template(
  p_step_key TEXT,
  p_lang     TEXT,
  p_gym_id   UUID DEFAULT NULL
)
RETURNS TABLE (title TEXT, body TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title    TEXT;
  v_body     TEXT;
  v_enabled  BOOLEAN;
BEGIN
  -- Try gym-specific first (any enabled state — disabled OVERRIDES default to "skip").
  IF p_gym_id IS NOT NULL THEN
    SELECT mt.title, mt.body, mt.enabled
      INTO v_title, v_body, v_enabled
    FROM message_templates mt
    WHERE mt.gym_id   = p_gym_id
      AND mt.kind     = 'lifecycle'
      AND mt.step_key = p_step_key
      AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
    ORDER BY (mt.language = COALESCE(p_lang, 'en')) DESC
    LIMIT 1;

    IF FOUND THEN
      -- Disabled gym override = explicit opt-out. Return empty so caller skips.
      IF NOT v_enabled THEN RETURN; END IF;
      RETURN QUERY SELECT v_title, v_body;
      RETURN;
    END IF;
  END IF;

  -- Fall back to global defaults.
  SELECT mt.title, mt.body
    INTO v_title, v_body
  FROM message_templates mt
  WHERE mt.gym_id IS NULL
    AND mt.kind     = 'lifecycle'
    AND mt.step_key = p_step_key
    AND mt.enabled
    AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
  ORDER BY (mt.language = COALESCE(p_lang, 'en')) DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_title, v_body;
  END IF;
END;
$$;

-- Winback: same idea, plus the category dimension and its fallback
-- chain ((step, lang, exact_category) → (step, lang, 'other') → NULL).
CREATE OR REPLACE FUNCTION winback_template(
  p_step_key TEXT,
  p_lang     TEXT,
  p_category cancellation_reason_category,
  p_gym_id   UUID DEFAULT NULL
)
RETURNS TABLE (title TEXT, body TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title   TEXT;
  v_body    TEXT;
  v_enabled BOOLEAN;
BEGIN
  -- Gym-specific lookup first.
  IF p_gym_id IS NOT NULL THEN
    SELECT mt.title, mt.body, mt.enabled
      INTO v_title, v_body, v_enabled
    FROM message_templates mt
    WHERE mt.gym_id   = p_gym_id
      AND mt.kind     = 'winback'
      AND mt.step_key = p_step_key
      AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
      AND (
        mt.category IS NOT DISTINCT FROM p_category
        OR mt.category = 'other'::cancellation_reason_category
        OR mt.category IS NULL
      )
    ORDER BY
      (mt.language = COALESCE(p_lang, 'en')) DESC,
      (mt.category IS NOT DISTINCT FROM p_category) DESC,
      (mt.category = 'other'::cancellation_reason_category) DESC,
      (mt.category IS NOT NULL) DESC
    LIMIT 1;

    IF FOUND THEN
      IF NOT v_enabled THEN RETURN; END IF;
      RETURN QUERY SELECT v_title, v_body;
      RETURN;
    END IF;
  END IF;

  -- Global defaults.
  SELECT mt.title, mt.body
    INTO v_title, v_body
  FROM message_templates mt
  WHERE mt.gym_id IS NULL
    AND mt.kind     = 'winback'
    AND mt.step_key = p_step_key
    AND mt.enabled
    AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
    AND (
      mt.category IS NOT DISTINCT FROM p_category
      OR mt.category = 'other'::cancellation_reason_category
      OR mt.category IS NULL
    )
  ORDER BY
    (mt.language = COALESCE(p_lang, 'en')) DESC,
    (mt.category IS NOT DISTINCT FROM p_category) DESC,
    (mt.category = 'other'::cancellation_reason_category) DESC,
    (mt.category IS NOT NULL) DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_title, v_body;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION lifecycle_template(TEXT, TEXT, UUID)                              FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lifecycle_template(TEXT, TEXT, UUID)                              TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION winback_template(TEXT, TEXT, cancellation_reason_category, UUID)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION winback_template(TEXT, TEXT, cancellation_reason_category, UUID)  TO authenticated, service_role;

-- ── Update callers to pass gym_id ───────────────────────────
-- run_lifecycle_messages_daily — pass member's gym_id to template lookup.
CREATE OR REPLACE FUNCTION run_lifecycle_messages_daily()
RETURNS TABLE (sent_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sent INTEGER := 0;
BEGIN
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
    CROSS JOIN LATERAL lifecycle_template(ds.step_key, ds.lang, ds.gym_id) tpl
    WHERE tpl.title IS NOT NULL    -- gym opt-out via disabled override → tpl is empty → skip
  ),
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

-- fire_lifecycle_push — pass NEW.gym_id to template lookup.
CREATE OR REPLACE FUNCTION fire_lifecycle_push()
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
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG 'fire_lifecycle_push: vault secrets not configured, skipping push for %', NEW.id;
    RETURN NEW;
  END IF;

  SELECT p.full_name, COALESCE(p.preferred_language, 'en')
    INTO v_full, v_lang
  FROM profiles p WHERE p.id = NEW.profile_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT title, body INTO v_title, v_body
  FROM lifecycle_template(NEW.step_key, v_lang, NEW.gym_id);

  IF v_title IS NULL THEN
    RAISE LOG 'fire_lifecycle_push: no template for step % / lang % / gym %', NEW.step_key, v_lang, NEW.gym_id;
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
                              'route', '/notifications',
                              'type',  'system',
                              'lifecycle_step', NEW.step_key
                           ),
      'notification_type', 'system'
    )
  ) INTO v_req_id;

  UPDATE lifecycle_message_log
  SET push_request_id = v_req_id,
      push_queued_at  = NOW()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- run_winback_messages_daily — pass gym_id to template lookup.
CREATE OR REPLACE FUNCTION run_winback_messages_daily()
RETURNS TABLE (sent_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sent INTEGER := 0;
BEGIN
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
  eligible_cancellations AS (
    SELECT lc.*
    FROM latest_cancellations lc
    WHERE lc.category IS DISTINCT FROM 'moved'::cancellation_reason_category
  ),
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
    CROSS JOIN LATERAL winback_template(d.step_key, COALESCE(p.preferred_language, 'en'), d.category, d.gym_id) tpl
    WHERE tpl.title IS NOT NULL
  ),
  finalized AS (
    SELECT
      r.*,
      REPLACE(r.raw_title, '{{first_name}}',
              COALESCE(NULLIF(SPLIT_PART(r.full_name, ' ', 1), ''), '')) AS title,
      REPLACE(r.raw_body,  '{{first_name}}',
              COALESCE(NULLIF(SPLIT_PART(r.full_name, ' ', 1), ''), '')) AS body
    FROM rendered r
  ),
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

-- fire_winback_push — pass NEW.gym_id to template lookup.
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
  FROM winback_template(NEW.step_key, v_lang, NEW.category, NEW.gym_id);

  IF v_title IS NULL THEN
    RAISE LOG 'fire_winback_push: no template for step %, lang %, category %, gym %',
              NEW.step_key, v_lang, NEW.category, NEW.gym_id;
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
                              'route',         '/notifications',
                              'type',          'win_back',
                              'winback_step',  NEW.step_key
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
