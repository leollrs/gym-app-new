-- =============================================================
-- 0420 — Retention timeline gap-fills
--
-- Closes the 5 gaps identified in docs/RETENTION_TIMELINE.md:
--
--   1. Day 5 silent gap (between Day 3 nudge and Day 7 win)
--      → conditional lifecycle push "Still here when you're ready"
--        — only fires if member hasn't logged a workout yet (don't
--        pester active members).
--
--   2. Day 60 silent gap (between tenure_30 and tenure_90)
--      → unconditional lifecycle push "Two months — not testing anymore"
--
--   3. workouts_250 push gap (card fires but no push companion)
--      → add to milestone_thresholds + bilingual template
--
--   4. habit_9in6 push gap (card fires with zero digital signal)
--      → AFTER INSERT trigger on print_cards for occasion='habit_9in6'
--        — fires push when cron queues the card (or admin pre-materializes)
--
--   5. First PR after 30d logging gap (no signal for the moment that
--      proves "your effort is producing measurable strength")
--      → AFTER INSERT trigger on personal_records — fires push only when
--        it's the member's FIRST PR AND they have ≥30 days of logging
--        (avoids fake-PR noise from early sessions with no baseline)
--
-- ── Schema change ──
-- lifecycle_steps gains `condition_key` column (NULL = always fire).
-- Recreating the function requires DROP CASCADE because the return type
-- changes; this also drops run_lifecycle_messages_daily which we recreate.
-- =============================================================

-- ── 1 + 2: Lifecycle gap-fill ────────────────────────────────
-- DROP CASCADE so the dependent run_lifecycle_messages_daily comes with it.
DROP FUNCTION IF EXISTS lifecycle_steps() CASCADE;

CREATE OR REPLACE FUNCTION lifecycle_steps()
RETURNS TABLE (
  step_key      TEXT,
  step_day      INTEGER,
  sort_order    INTEGER,
  condition_key TEXT     -- NULL = always fire; 'no_workouts_yet' = conditional
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('day_1',  1,  1, NULL),
    ('day_3',  3,  2, NULL),
    ('day_5',  5,  3, 'no_workouts_yet'),   -- soft re-engagement for non-starters
    ('day_7',  7,  4, NULL),
    ('day_14', 14, 5, NULL),
    ('day_21', 21, 6, NULL),
    ('day_30', 30, 7, NULL),
    ('day_60', 60, 8, NULL)                  -- bridges tenure_30 → tenure_90 silence
  ) AS t(step_key, step_day, sort_order, condition_key);
$$;

-- Template additions for day_5 + day_60 (bilingual).
CREATE OR REPLACE FUNCTION lifecycle_template(p_step_key TEXT, p_lang TEXT)
RETURNS TABLE (title TEXT, body TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH templates(step_key, lang, title, body) AS (
    VALUES
      ('day_1', 'en',
        'Welcome aboard, {{first_name}}',
        'Your first workout is the hardest. Let''s get it on the board this week.'),
      ('day_1', 'es',
        'Bienvenido, {{first_name}}',
        'El primero es el más difícil. Vamos a sacarlo esta semana.'),

      ('day_3', 'en',
        'Day 3 — keep the momentum',
        'Most people quit before day 5. Get one more session in and you''ve already beaten the average.'),
      ('day_3', 'es',
        'Día 3 — mantén el ritmo',
        'La mayoría se rinde antes del día 5. Una sesión más y ya estás por encima del promedio.'),

      -- NEW: Day 5 — only sent if no workouts yet (cron checks condition_key)
      ('day_5', 'en',
        'Still here when you''re ready, {{first_name}}',
        'No pressure on the first session — just walk in. Everything else gets easier from there.'),
      ('day_5', 'es',
        'Aquí cuando estés listo, {{first_name}}',
        'Sin presión con la primera sesión — solo entra. Todo lo demás se vuelve más fácil desde ahí.'),

      ('day_7', 'en',
        'One week down 🔥',
        'You stuck with it past the first week. Statistically that''s the hardest part — it gets easier from here.'),
      ('day_7', 'es',
        'Una semana 🔥',
        'Pasaste la primera semana. Estadísticamente, esa es la parte más difícil.'),

      ('day_14', 'en',
        'Two weeks in, {{first_name}}',
        'You''re past the cliff where most people drop off. The work is starting to compound.'),
      ('day_14', 'es',
        'Dos semanas, {{first_name}}',
        'Pasaste el punto donde la mayoría se rinde. El trabajo empieza a sumar.'),

      ('day_21', 'en',
        '21 days — habit territory',
        'Research says 21 days is when a behavior starts to stick. You did it. Now it''s about consistency.'),
      ('day_21', 'es',
        '21 días — territorio de hábito',
        '21 días es cuando un hábito empieza a pegarse. Lo lograste. Ahora es consistencia.'),

      ('day_30', 'en',
        'One month strong 💪',
        'A full month of showing up, {{first_name}}. That''s further than 80% of new members ever get. Proud of you.'),
      ('day_30', 'es',
        'Un mes fuerte 💪',
        'Un mes completo apareciendo, {{first_name}}. Eso es más lejos del 80% de nuevos miembros. Orgulloso de ti.'),

      -- NEW: Day 60 — bridges tenure_30 card to tenure_90 card
      ('day_60', 'en',
        'Two months — you''re not testing anymore',
        'Sixty days of training is past the "trying it out" phase. This is who you are now.'),
      ('day_60', 'es',
        'Dos meses — ya no estás probando',
        'Sesenta días de entrenar pasa la fase de "lo estoy probando". Esto es quien eres ahora.')
  )
  SELECT t.title, t.body
  FROM templates t
  WHERE t.step_key = p_step_key
    AND t.lang = COALESCE(NULLIF(p_lang, ''), 'en')
  UNION ALL
  -- Fallback to en if exact-lang match missing
  SELECT t.title, t.body
  FROM templates t
  WHERE t.step_key = p_step_key
    AND t.lang = 'en'
    AND NOT EXISTS (
      SELECT 1 FROM templates t2
      WHERE t2.step_key = p_step_key AND t2.lang = COALESCE(NULLIF(p_lang, ''), 'en')
    )
  LIMIT 1;
$$;

-- Cron — now respects `condition_key` per step. Currently the only
-- conditional is 'no_workouts_yet' for day_5; this is generalized in
-- the WHERE clause so future conditions ('no_pr_yet', etc.) drop in.
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
      s.sort_order,
      s.condition_key
    FROM active_members am
    CROSS JOIN lifecycle_steps() s
    WHERE am.tenure_days >= s.step_day
      AND NOT EXISTS (
        SELECT 1 FROM lifecycle_message_log lml
        WHERE lml.profile_id = am.profile_id
          AND lml.step_key   = s.step_key
      )
      -- Generalized condition gate. Add new condition_key branches here.
      AND (
        s.condition_key IS NULL
        OR (
          s.condition_key = 'no_workouts_yet'
          AND NOT EXISTS (
            SELECT 1 FROM workout_sessions ws
            WHERE ws.profile_id = am.profile_id
              AND ws.status = 'completed'
          )
        )
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
    CROSS JOIN LATERAL lifecycle_template(ds.step_key, ds.lang) tpl
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

REVOKE EXECUTE ON FUNCTION run_lifecycle_messages_daily() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION run_lifecycle_messages_daily() TO service_role;
REVOKE EXECUTE ON FUNCTION lifecycle_steps()              FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lifecycle_steps()              TO authenticated, service_role;
-- lifecycle_template grants are already in place from 0400 (OR REPLACE preserves them).

-- ── 3: workouts_250 milestone push ──────────────────────────
CREATE OR REPLACE FUNCTION milestone_thresholds()
RETURNS TABLE (
  milestone_key TEXT,
  milestone_n   INTEGER,
  sort_order    INTEGER
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('workouts_10',  10,  1),
    ('workouts_25',  25,  2),
    ('workouts_50',  50,  3),
    ('workouts_100', 100, 4),
    ('workouts_200', 200, 5),
    ('workouts_250', 250, 6),   -- NEW — was a print card with no push companion
    ('workouts_500', 500, 7)
  ) AS t(milestone_key, milestone_n, sort_order);
$$;

CREATE OR REPLACE FUNCTION milestone_template(p_milestone_key TEXT, p_lang TEXT)
RETURNS TABLE (title TEXT, body TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH templates(milestone_key, lang, title, body) AS (
    VALUES
      ('workouts_10',  'en', '10 workouts logged 🏆',  'Double digits. The pattern is forming.'),
      ('workouts_10',  'es', '10 entrenamientos 🏆',   'Dos dígitos. El patrón está formándose.'),
      ('workouts_25',  'en', '25 workouts logged 🏆',  'A quarter to the century mark. Real momentum.'),
      ('workouts_25',  'es', '25 entrenamientos 🏆',   'Un cuarto del camino a los cien. Esto va en serio.'),
      ('workouts_50',  'en', '50 workouts logged 🏆',  'Halfway to triple digits. You don''t miss anymore.'),
      ('workouts_50',  'es', '50 entrenamientos 🏆',   'A mitad de camino a los cien. Ya no faltas.'),
      ('workouts_100', 'en', '100 workouts logged 🏆', 'Triple digits. This is who you are now.'),
      ('workouts_100', 'es', '100 entrenamientos 🏆',  'Tres dígitos. Esto es quien eres ahora.'),
      ('workouts_200', 'en', '200 workouts logged 🏆', 'Two hundred and counting. Rare air.'),
      ('workouts_200', 'es', '200 entrenamientos 🏆',  'Doscientos y contando. Aire raro.'),
      -- NEW
      ('workouts_250', 'en', '250 workouts logged 🏆', 'Quarter-thousand sessions. The print card is on its way to the desk.'),
      ('workouts_250', 'es', '250 entrenamientos 🏆',  'Un cuarto de mil sesiones. La tarjeta impresa va para el mostrador.'),
      ('workouts_500', 'en', '500 workouts logged 🏆', 'Five hundred. Hall of fame territory — your folded card is being prepared.'),
      ('workouts_500', 'es', '500 entrenamientos 🏆',  'Quinientos. Salón de la fama — tu tarjeta plegada está preparándose.')
  )
  SELECT t.title, t.body
  FROM templates t
  WHERE t.milestone_key = p_milestone_key
    AND t.lang = COALESCE(NULLIF(p_lang, ''), 'en')
  UNION ALL
  SELECT t.title, t.body
  FROM templates t
  WHERE t.milestone_key = p_milestone_key
    AND t.lang = 'en'
    AND NOT EXISTS (
      SELECT 1 FROM templates t2
      WHERE t2.milestone_key = p_milestone_key AND t2.lang = COALESCE(NULLIF(p_lang, ''), 'en')
    )
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION milestone_thresholds()              FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION milestone_thresholds()              TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION milestone_template(TEXT, TEXT)      FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION milestone_template(TEXT, TEXT)      TO authenticated, service_role;

-- ── 4: habit_9in6 push companion ─────────────────────────────
-- Fires the moment a habit_9in6 card lands in print_cards (cron-generated
-- OR admin-materialized). Pairs the physical card with a digital ping —
-- the one occasion in the original timeline that had no companion push.
CREATE OR REPLACE FUNCTION fire_habit_9in6_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang  TEXT;
  v_title TEXT;
  v_body  TEXT;
BEGIN
  -- Only fire for the habit card occasion.
  IF NEW.occasion::TEXT <> 'habit_9in6' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(preferred_language, 'en')
    INTO v_lang
  FROM profiles
  WHERE id = NEW.profile_id;

  IF v_lang = 'es' THEN
    v_title := 'Construiste el hábito.';
    v_body  := 'Nueve sesiones en seis semanas. Eso ya cuenta.';
  ELSE
    v_title := 'You''ve built the habit.';
    v_body  := 'Nine sessions in six weeks. That counts.';
  END IF;

  -- dedup_key is per card so re-materializing after dismiss can re-fire
  -- (each card row gets exactly one push).
  INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
  VALUES (
    NEW.profile_id,
    NEW.gym_id,
    'system'::notification_type,
    v_title,
    v_body,
    'habit_9in6_push_' || NEW.id::TEXT
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't break the print_cards INSERT if push insert fails. Log and continue.
  RAISE WARNING 'fire_habit_9in6_push failed for card %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS habit_9in6_push_trigger ON print_cards;
CREATE TRIGGER habit_9in6_push_trigger
AFTER INSERT ON print_cards
FOR EACH ROW
EXECUTE FUNCTION fire_habit_9in6_push();

-- ── 5: first PR after 30 days of logging ─────────────────────
-- Standalone trigger so we don't have to touch the large complete_workout
-- RPC. Fires only when:
--   - this is the member's FIRST personal_records row, AND
--   - their first completed workout is ≥ 30 days old
-- The 30-day floor avoids the early-account-noise problem the timeline
-- doc flagged: any number is a "PR" when there's no baseline.
CREATE OR REPLACE FUNCTION fire_first_pr_after_30d_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pr_count           INTEGER;
  v_first_workout_date DATE;
  v_gym_id             UUID;
  v_lang               TEXT;
  v_title              TEXT;
  v_body               TEXT;
BEGIN
  -- Skip if this isn't the very first PR (NEW already inserted, so count = 1
  -- means "this one is the first").
  SELECT COUNT(*) INTO v_pr_count
  FROM personal_records
  WHERE profile_id = NEW.profile_id;

  IF v_pr_count > 1 THEN
    RETURN NEW;
  END IF;

  -- Member must have ≥30 days of logging tenure.
  SELECT MIN(completed_at::DATE)
    INTO v_first_workout_date
  FROM workout_sessions
  WHERE profile_id = NEW.profile_id
    AND status = 'completed';

  IF v_first_workout_date IS NULL OR (CURRENT_DATE - v_first_workout_date) < 30 THEN
    RETURN NEW;
  END IF;

  SELECT gym_id, COALESCE(preferred_language, 'en')
    INTO v_gym_id, v_lang
  FROM profiles
  WHERE id = NEW.profile_id;

  IF v_lang = 'es' THEN
    v_title := '¡Tu primer PR verificado!';
    v_body  := 'Después de un mes entrenando — esa marca cuenta.';
  ELSE
    v_title := 'Your first verified PR.';
    v_body  := 'A month in, and the number went up. That counts.';
  END IF;

  INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
  VALUES (
    NEW.profile_id,
    v_gym_id,
    'system'::notification_type,
    v_title,
    v_body,
    'first_pr_after_30d_' || NEW.profile_id::TEXT
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fire_first_pr_after_30d_push failed for profile %: %', NEW.profile_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS first_pr_after_30d_trigger ON personal_records;
CREATE TRIGGER first_pr_after_30d_trigger
AFTER INSERT ON personal_records
FOR EACH ROW
EXECUTE FUNCTION fire_first_pr_after_30d_push();

NOTIFY pgrst, 'reload schema';
