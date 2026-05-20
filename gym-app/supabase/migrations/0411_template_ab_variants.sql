-- =============================================================
-- TEMPLATE A/B VARIANTS — multiple variants per slot
-- Migration: 0411_template_ab_variants.sql
--
-- Migration 0403 created `message_templates` with UNIQUE
-- (gym_id, kind, step_key, language, category) NULLS NOT DISTINCT,
-- which caps each slot at one template. The retention thesis says
-- gym owners discover what resonates with THEIR members by trying
-- copy variants and watching what lands — so we widen the unique
-- key with a `variant_label` column and pick randomly at send time.
--
-- Critical correctness invariant: the cron picks the variant once
-- and records it on the log row. The push trigger reads that label
-- back and renders the EXACT same row, so the in-app notification
-- and the push payload always match. Without this, the trigger
-- would roll the dice again and a member could get push copy that
-- doesn't match the row in their notifications tab.
--
-- Existing seeded rows (variant_label='A' via DEFAULT) continue to
-- behave exactly as today — single-variant slots collapse to a
-- deterministic SELECT-LIMIT-1 over one row.
-- =============================================================

-- ── 1. message_templates: add variant_label + widen unique key ──
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS variant_label TEXT NOT NULL DEFAULT 'A';

-- Backfill is a no-op (DEFAULT 'A' covers every existing row), but
-- be explicit so the migration is self-documenting under a replay.
UPDATE message_templates SET variant_label = 'A' WHERE variant_label IS NULL;

-- Drop the old single-variant constraint and re-create with the
-- variant column included. We discover the auto-generated name via
-- the catalog because 0403 used an unnamed inline UNIQUE clause.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname
    INTO v_conname
  FROM pg_constraint con
  JOIN pg_class    cls ON cls.oid = con.conrelid
  WHERE cls.relname = 'message_templates'
    AND con.contype = 'u'
    AND ARRAY(
      SELECT attname::TEXT
      FROM pg_attribute
      WHERE attrelid = cls.oid
        AND attnum = ANY(con.conkey)
      ORDER BY attname
    ) = ARRAY['category','gym_id','kind','language','step_key']::TEXT[];

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE message_templates DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE message_templates
  ADD CONSTRAINT message_templates_slot_variant_unique
  UNIQUE NULLS NOT DISTINCT
  (gym_id, kind, step_key, language, category, variant_label);

-- ── 2. log tables: record which variant was sent ───────────────
-- Historical rows stay NULL (they were sent before A/B existed);
-- new rows always carry the variant_label the cron picked.
ALTER TABLE lifecycle_message_log
  ADD COLUMN IF NOT EXISTS variant_label TEXT DEFAULT NULL;

ALTER TABLE winback_message_log
  ADD COLUMN IF NOT EXISTS variant_label TEXT DEFAULT NULL;

-- ── 3. Lookup functions: random variant pick ───────────────────
-- The old 0403 functions are dropped because the RETURNS TABLE
-- shape changes (adds variant_label). Re-create returning the
-- chosen label so callers can persist it.

DROP FUNCTION IF EXISTS lifecycle_template(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS winback_template(TEXT, TEXT, cancellation_reason_category, UUID);

-- Lifecycle: when multiple ENABLED rows match the most-specific
-- WHERE clause (same gym, same step, same lang), random()-pick one.
-- Disabled overrides at the per-gym level still short-circuit the
-- whole lookup ("skip this step entirely") — same precedence as 0403.
CREATE OR REPLACE FUNCTION lifecycle_template(
  p_step_key TEXT,
  p_lang     TEXT,
  p_gym_id   UUID DEFAULT NULL
)
RETURNS TABLE (title TEXT, body TEXT, variant_label TEXT)
LANGUAGE plpgsql
-- Not STABLE — random() makes this VOLATILE by definition.
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title    TEXT;
  v_body     TEXT;
  v_label    TEXT;
  v_enabled  BOOLEAN;
  v_has_any  BOOLEAN := FALSE;
BEGIN
  -- Gym-specific lookup first. We look for ANY row (enabled or not);
  -- a disabled row means "opt out" and overrides global defaults.
  IF p_gym_id IS NOT NULL THEN
    -- Does this gym have any override (enabled or disabled) for this
    -- slot in the requested lang? If so, we commit to gym-level.
    SELECT EXISTS (
      SELECT 1 FROM message_templates mt
      WHERE mt.gym_id   = p_gym_id
        AND mt.kind     = 'lifecycle'
        AND mt.step_key = p_step_key
        AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
    ) INTO v_has_any;

    IF v_has_any THEN
      -- If ANY matching gym row is disabled, that's an explicit opt-out → skip.
      IF EXISTS (
        SELECT 1 FROM message_templates mt
        WHERE mt.gym_id    = p_gym_id
          AND mt.kind      = 'lifecycle'
          AND mt.step_key  = p_step_key
          AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
          AND mt.enabled   = FALSE
      ) THEN
        RETURN;
      END IF;

      -- All matching gym rows are enabled — pick a random variant,
      -- preferring the requested language over 'en' fallback.
      SELECT mt.title, mt.body, mt.variant_label
        INTO v_title, v_body, v_label
      FROM message_templates mt
      WHERE mt.gym_id    = p_gym_id
        AND mt.kind      = 'lifecycle'
        AND mt.step_key  = p_step_key
        AND mt.enabled
        AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
      ORDER BY
        (mt.language = COALESCE(p_lang, 'en')) DESC,
        random()
      LIMIT 1;

      IF v_title IS NOT NULL THEN
        RETURN QUERY SELECT v_title, v_body, v_label;
      END IF;
      RETURN;
    END IF;
  END IF;

  -- Fall back to global defaults.
  SELECT mt.title, mt.body, mt.variant_label
    INTO v_title, v_body, v_label
  FROM message_templates mt
  WHERE mt.gym_id IS NULL
    AND mt.kind     = 'lifecycle'
    AND mt.step_key = p_step_key
    AND mt.enabled
    AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
  ORDER BY
    (mt.language = COALESCE(p_lang, 'en')) DESC,
    random()
  LIMIT 1;

  IF v_title IS NOT NULL THEN
    RETURN QUERY SELECT v_title, v_body, v_label;
  END IF;
END;
$$;

-- Winback: same idea, plus the category dimension. Within the
-- best-matching (lang, category) bucket, pick a random variant.
CREATE OR REPLACE FUNCTION winback_template(
  p_step_key TEXT,
  p_lang     TEXT,
  p_category cancellation_reason_category,
  p_gym_id   UUID DEFAULT NULL
)
RETURNS TABLE (title TEXT, body TEXT, variant_label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title   TEXT;
  v_body    TEXT;
  v_label   TEXT;
  v_has_any BOOLEAN := FALSE;
BEGIN
  -- Gym-specific path
  IF p_gym_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM message_templates mt
      WHERE mt.gym_id    = p_gym_id
        AND mt.kind      = 'winback'
        AND mt.step_key  = p_step_key
        AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
        AND (
          mt.category IS NOT DISTINCT FROM p_category
          OR mt.category = 'other'::cancellation_reason_category
          OR mt.category IS NULL
        )
    ) INTO v_has_any;

    IF v_has_any THEN
      -- Opt-out: if there's a disabled row in the matching set, skip.
      IF EXISTS (
        SELECT 1 FROM message_templates mt
        WHERE mt.gym_id    = p_gym_id
          AND mt.kind      = 'winback'
          AND mt.step_key  = p_step_key
          AND mt.enabled   = FALSE
          AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
          AND (
            mt.category IS NOT DISTINCT FROM p_category
            OR mt.category = 'other'::cancellation_reason_category
            OR mt.category IS NULL
          )
      ) THEN
        RETURN;
      END IF;

      -- Pick the best (lang/category) bucket, then random within it.
      SELECT mt.title, mt.body, mt.variant_label
        INTO v_title, v_body, v_label
      FROM message_templates mt
      WHERE mt.gym_id    = p_gym_id
        AND mt.kind      = 'winback'
        AND mt.step_key  = p_step_key
        AND mt.enabled
        AND (mt.language = COALESCE(p_lang, 'en') OR mt.language = 'en')
        AND (
          mt.category IS NOT DISTINCT FROM p_category
          OR mt.category = 'other'::cancellation_reason_category
          OR mt.category IS NULL
        )
      ORDER BY
        (mt.language = COALESCE(p_lang, 'en'))                          DESC,
        (mt.category IS NOT DISTINCT FROM p_category)                   DESC,
        (mt.category = 'other'::cancellation_reason_category)           DESC,
        (mt.category IS NOT NULL)                                       DESC,
        random()
      LIMIT 1;

      IF v_title IS NOT NULL THEN
        RETURN QUERY SELECT v_title, v_body, v_label;
      END IF;
      RETURN;
    END IF;
  END IF;

  -- Global defaults
  SELECT mt.title, mt.body, mt.variant_label
    INTO v_title, v_body, v_label
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
    (mt.language = COALESCE(p_lang, 'en'))                            DESC,
    (mt.category IS NOT DISTINCT FROM p_category)                     DESC,
    (mt.category = 'other'::cancellation_reason_category)             DESC,
    (mt.category IS NOT NULL)                                         DESC,
    random()
  LIMIT 1;

  IF v_title IS NOT NULL THEN
    RETURN QUERY SELECT v_title, v_body, v_label;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION lifecycle_template(TEXT, TEXT, UUID)                              FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lifecycle_template(TEXT, TEXT, UUID)                              TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION winback_template(TEXT, TEXT, cancellation_reason_category, UUID)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION winback_template(TEXT, TEXT, cancellation_reason_category, UUID)  TO authenticated, service_role;

-- ── 4. Daily run functions: log the chosen variant ──────────────
-- Drop first because the rendered CTE shape changes (carries
-- variant_label through to the INSERT).

DROP FUNCTION IF EXISTS run_lifecycle_messages_daily();

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
      tpl.variant_label,
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
    INSERT INTO lifecycle_message_log (profile_id, gym_id, step_key, variant_label)
    SELECT r.profile_id, r.gym_id, r.step_key, r.variant_label
    FROM rendered r
    ON CONFLICT (profile_id, step_key) DO NOTHING
    RETURNING profile_id
  )
  SELECT COUNT(*)::INTEGER INTO v_sent FROM logged;

  RETURN QUERY SELECT v_sent;
END;
$$;

DROP FUNCTION IF EXISTS run_winback_messages_daily();

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
      tpl.title         AS raw_title,
      tpl.body          AS raw_body,
      tpl.variant_label AS variant_label
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
      (profile_id, gym_id, cancellation_id, step_key, category, variant_label)
    SELECT
      f.profile_id, f.gym_id, f.cancellation_id, f.step_key, f.category, f.variant_label
    FROM finalized f
    ON CONFLICT (profile_id, cancellation_id, step_key) DO NOTHING
    RETURNING profile_id
  )
  SELECT COUNT(*)::INTEGER INTO v_sent FROM logged;

  RETURN QUERY SELECT v_sent;
END;
$$;

-- ── 5. Push triggers: render the EXACT variant the cron picked ──
-- This is the correctness fix the migration is really about. The
-- trigger fires after the cron has inserted the log row, so we can
-- read the variant_label off NEW and SELECT that exact row from
-- message_templates instead of re-resolving (which would pick a
-- different random variant most of the time and break consistency
-- between the in-app notification and the push payload).

DROP FUNCTION IF EXISTS fire_lifecycle_push() CASCADE;

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

  -- Look up the EXACT variant the cron chose, falling back to the
  -- global default of the same variant if the gym row is gone. If
  -- the log row has NULL variant (historical row replayed somehow,
  -- or a manual insert), fall back through the lookup function.
  IF NEW.variant_label IS NOT NULL THEN
    -- Prefer the gym's row at the chosen variant; if it's been
    -- deleted between cron and trigger, fall back to global default
    -- at the same variant; finally fall back to any enabled row at
    -- that variant.
    SELECT mt.title, mt.body
      INTO v_title, v_body
    FROM message_templates mt
    WHERE mt.kind          = 'lifecycle'
      AND mt.step_key      = NEW.step_key
      AND mt.variant_label = NEW.variant_label
      AND mt.enabled
      AND (mt.language = v_lang OR mt.language = 'en')
      AND (mt.gym_id   = NEW.gym_id OR mt.gym_id IS NULL)
    ORDER BY
      (mt.gym_id   = NEW.gym_id) DESC,        -- gym-specific beats global
      (mt.language = v_lang)     DESC         -- requested lang beats 'en'
    LIMIT 1;
  END IF;

  -- Either no recorded variant or the row vanished — resolve via
  -- the normal lookup function (will random()-pick a fresh variant).
  IF v_title IS NULL THEN
    SELECT title, body INTO v_title, v_body
    FROM lifecycle_template(NEW.step_key, v_lang, NEW.gym_id);
  END IF;

  IF v_title IS NULL THEN
    RAISE LOG 'fire_lifecycle_push: no template for step % / lang % / gym % / variant %',
              NEW.step_key, v_lang, NEW.gym_id, NEW.variant_label;
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
                              'type',           'system',
                              'lifecycle_step', NEW.step_key,
                              'variant_label',  NEW.variant_label
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

-- Re-attach the AFTER INSERT trigger (CASCADE above dropped it).
DROP TRIGGER IF EXISTS trg_fire_lifecycle_push ON lifecycle_message_log;
CREATE TRIGGER trg_fire_lifecycle_push
  AFTER INSERT ON lifecycle_message_log
  FOR EACH ROW
  EXECUTE FUNCTION fire_lifecycle_push();

DROP FUNCTION IF EXISTS fire_winback_push() CASCADE;

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

  -- Same variant-pinning logic as the lifecycle trigger. The
  -- category column also needs to match the row we'd actually have
  -- rendered, so the fallback chain mirrors the lookup function.
  IF NEW.variant_label IS NOT NULL THEN
    SELECT mt.title, mt.body
      INTO v_title, v_body
    FROM message_templates mt
    WHERE mt.kind          = 'winback'
      AND mt.step_key      = NEW.step_key
      AND mt.variant_label = NEW.variant_label
      AND mt.enabled
      AND (mt.language = v_lang OR mt.language = 'en')
      AND (mt.gym_id   = NEW.gym_id OR mt.gym_id IS NULL)
      AND (
        mt.category IS NOT DISTINCT FROM NEW.category
        OR mt.category = 'other'::cancellation_reason_category
        OR mt.category IS NULL
      )
    ORDER BY
      (mt.gym_id   = NEW.gym_id)                                       DESC,
      (mt.language = v_lang)                                            DESC,
      (mt.category IS NOT DISTINCT FROM NEW.category)                   DESC,
      (mt.category = 'other'::cancellation_reason_category)             DESC,
      (mt.category IS NOT NULL)                                         DESC
    LIMIT 1;
  END IF;

  IF v_title IS NULL THEN
    SELECT title, body INTO v_title, v_body
    FROM winback_template(NEW.step_key, v_lang, NEW.category, NEW.gym_id);
  END IF;

  IF v_title IS NULL THEN
    RAISE LOG 'fire_winback_push: no template for step %, lang %, category %, gym %, variant %',
              NEW.step_key, v_lang, NEW.category, NEW.gym_id, NEW.variant_label;
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
                              'winback_step',  NEW.step_key,
                              'variant_label', NEW.variant_label
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

DROP TRIGGER IF EXISTS trg_fire_winback_push ON winback_message_log;
CREATE TRIGGER trg_fire_winback_push
  AFTER INSERT ON winback_message_log
  FOR EACH ROW
  EXECUTE FUNCTION fire_winback_push();

-- ── 6. Sanity check on seeded rows ──────────────────────────────
-- Self-test: every row from the 0403 seed must have variant_label='A'.
-- We DO NOT raise on failure here (migrations should be idempotent
-- and replayable in dev environments that have hand-edited data),
-- but a LOG line surfaces if anything is off.
DO $$
DECLARE
  v_bad INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_bad
  FROM message_templates
  WHERE gym_id IS NULL
    AND (variant_label IS DISTINCT FROM 'A');

  IF v_bad > 0 THEN
    RAISE LOG '0411_template_ab_variants: % seeded rows have non-A variant_label (expected 0)', v_bad;
  END IF;
END $$;
