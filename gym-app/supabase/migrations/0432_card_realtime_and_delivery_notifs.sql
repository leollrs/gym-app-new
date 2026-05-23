-- =============================================================
-- 0432_card_realtime_and_delivery_notifs.sql
--
-- Three related additions to the print-cards system:
--
--   1. Timezone fix — the delivery-Saturday math in 0430 reads gyms.timezone,
--      which defaulted to 'UTC'. Every current gym is in Puerto Rico, so
--      backfill UTC/NULL → 'America/Puerto_Rico' and change the default for
--      new gyms. (Set a gym's timezone explicitly if it isn't in PR.)
--
--   2. notify_gym_card_delivery(gym) — when the platform owner prints a
--      gym's batch centrally, this notifies that gym's admins ("cards on the
--      way, arriving <date>") so the front desk knows to expect the drop-off.
--      Called from the platform Card Queue after marking a batch printed.
--
--   3. Real-time card generation on workout completion — the daily cron
--      (0415) only queues welcome/milestone cards at 04:00, too late to hand
--      one over during the visit that earned it. This trigger detects the
--      first-ever workout (welcome) and the 100/250/500 crossings the moment
--      a session is completed, queues the card immediately (the dedup index
--      keeps the cron from double-queuing), and notifies the gym's admins
--      ("{name} earned a card today — hand it over while they're here").
-- =============================================================

-- ── 1 · Timezone backfill + default ─────────────────────────
UPDATE gyms SET timezone = 'America/Puerto_Rico'
 WHERE timezone IS NULL OR timezone = 'UTC';

ALTER TABLE gyms ALTER COLUMN timezone SET DEFAULT 'America/Puerto_Rico';

-- ── 2 · Platform → gym "cards on the way" notification ──────
CREATE OR REPLACE FUNCTION public.notify_gym_card_delivery(p_gym_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count   INT;
  v_date    TIMESTAMPTZ;
  v_admin   RECORD;
  v_notified INT := 0;
  v_title   TEXT;
  v_body    TEXT;
  v_datestr TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  -- The batch the gym is about to receive: printed, platform-fulfilled,
  -- not yet delivered, with a delivery date today or later.
  SELECT COUNT(*), MIN(expected_delivery_at)
    INTO v_count, v_date
    FROM print_cards
   WHERE gym_id = p_gym_id
     AND status = 'printed'
     AND delivery_fulfilled_by = 'platform'
     AND expected_delivery_at >= date_trunc('day', now());

  IF v_count = 0 OR v_date IS NULL THEN
    RETURN 0;
  END IF;

  v_datestr := to_char(v_date, 'FMMon FMDD');

  FOR v_admin IN
    SELECT id, COALESCE(preferred_language, 'en') AS lang
      FROM profiles
     WHERE gym_id = p_gym_id AND role IN ('admin', 'super_admin')
  LOOP
    IF v_admin.lang = 'es' THEN
      v_title := '📦 Tarjetas en camino';
      v_body  := v_count || ' tarjetas llegan el ' || v_datestr || ' — tenlas listas para entregar.';
    ELSE
      v_title := '📦 Cards on the way';
      v_body  := v_count || ' cards arriving ' || v_datestr || ' — have them ready to hand out.';
    END IF;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key)
    VALUES (
      v_admin.id, p_gym_id, 'admin_message'::notification_type,
      v_title, v_body,
      jsonb_build_object('route', '/admin/print-cards', 'count', v_count, 'deliver_at', v_date),
      'card_delivery:' || v_admin.id::text || ':' || p_gym_id::text || ':' || to_char(v_date, 'YYYY-MM-DD')
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

    v_notified := v_notified + 1;
  END LOOP;

  RETURN v_notified;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_gym_card_delivery(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.notify_gym_card_delivery(UUID) TO authenticated;

-- ── 3 · Real-time card generation on session completion ─────
CREATE OR REPLACE FUNCTION public.print_cards_on_session_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id    UUID;
  v_role      TEXT;
  v_status    TEXT;
  v_name      TEXT;
  v_count     INT;
  v_milestone INT;
  v_enabled   BOOLEAN;
  v_occasion  card_occasion;
  v_headline  TEXT;
  v_subline   TEXT;
  v_label_en  TEXT;
  v_label_es  TEXT;
  v_card_id   UUID;
  v_admin     RECORD;
  v_title     TEXT;
  v_body      TEXT;
BEGIN
  -- Fire only on a fresh transition into 'completed'.
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  -- Skip historical / backfilled sessions (bulk member imports insert
  -- completed sessions with old timestamps). Only a genuine same-visit
  -- completion should fire same-day cards + "earned a card" notifications;
  -- the daily cron still catches anything time-based.
  IF COALESCE(NEW.completed_at, NEW.started_at) < now() - INTERVAL '12 hours' THEN
    RETURN NEW;
  END IF;

  SELECT p.gym_id, p.role, p.membership_status, p.full_name
    INTO v_gym_id, v_role, v_status, v_name
    FROM profiles p WHERE p.id = NEW.profile_id;

  IF v_gym_id IS NULL OR v_role <> 'member' OR v_status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- Everything below is a courtesy side-effect. It must NEVER roll back the
  -- member's workout completion, so any failure here is swallowed.
  BEGIN

  SELECT COUNT(*) INTO v_count
    FROM workout_sessions
   WHERE profile_id = NEW.profile_id AND status = 'completed';

  -- Decide the occasion this completion just earned, honoring the gym's
  -- per-occasion enable flags (mirrors generate_print_cards_daily, 0415).
  IF v_count = 1 THEN
    IF COALESCE((SELECT enable_welcome FROM gym_card_settings WHERE gym_id = v_gym_id), TRUE) THEN
      v_occasion := 'welcome';
      v_headline := 'You showed up.';
      v_subline  := 'That was the hard part.';
      v_label_en := 'their first workout';
      v_label_es := 'su primer entrenamiento';
    END IF;
  ELSIF v_count IN (100, 250, 500) THEN
    v_milestone := v_count;
    SELECT CASE v_milestone
             WHEN 100 THEN COALESCE(enable_milestone_100, TRUE)
             WHEN 250 THEN COALESCE(enable_milestone_250, TRUE)
             WHEN 500 THEN COALESCE(enable_milestone_500, TRUE)
           END
      INTO v_enabled FROM gym_card_settings WHERE gym_id = v_gym_id;
    IF COALESCE(v_enabled, TRUE) THEN
      v_occasion := ('milestone_' || v_milestone)::card_occasion;
      v_headline := v_milestone || ' workouts logged';
      v_subline  := CASE v_milestone
        WHEN 100 THEN 'Triple digits. The work shows.'
        WHEN 250 THEN 'Quarter-thousand sessions. Rare company.'
        WHEN 500 THEN 'Five hundred. We''re honored you train here.'
      END;
      v_label_en := v_milestone || ' workouts';
      v_label_es := v_milestone || ' entrenamientos';
    END IF;
  END IF;

  IF v_occasion IS NULL THEN RETURN NEW; END IF;

  -- Enqueue now. enqueue_print_card returns NULL when the dedup index already
  -- has a pending card for this (profile, occasion) — in which case there's
  -- nothing new to announce, so we stop.
  v_card_id := enqueue_print_card(
    NEW.profile_id, v_gym_id, v_occasion, v_headline, v_subline,
    CASE WHEN v_milestone IS NOT NULL
      THEN jsonb_build_object('milestone_n', v_milestone)
      ELSE '{}'::jsonb END
  );

  IF v_card_id IS NULL THEN RETURN NEW; END IF;

  -- Notify each gym admin (localized), once per (admin, member, occasion).
  FOR v_admin IN
    SELECT id, COALESCE(preferred_language, 'en') AS lang
      FROM profiles
     WHERE gym_id = v_gym_id AND role IN ('admin', 'super_admin')
  LOOP
    IF v_admin.lang = 'es' THEN
      v_title := '🎁 ' || COALESCE(v_name, 'Un miembro') || ' ganó una tarjeta';
      v_body  := COALESCE(v_name, 'Un miembro') || ' alcanzó ' || v_label_es
                 || ' hoy — imprímela y entrégala mientras está en el gym.';
    ELSE
      v_title := '🎁 ' || COALESCE(v_name, 'A member') || ' earned a card';
      v_body  := COALESCE(v_name, 'A member') || ' hit ' || v_label_en
                 || ' today — print it and hand it over while they''re here.';
    END IF;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, data, dedup_key)
    VALUES (
      v_admin.id, v_gym_id, 'admin_message'::notification_type,
      v_title, v_body,
      jsonb_build_object('route', '/admin/print-cards', 'occasion', v_occasion,
                         'member_id', NEW.profile_id, 'card_id', v_card_id),
      'card_earned:' || v_admin.id::text || ':' || NEW.profile_id::text || ':' || v_occasion::text
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END LOOP;

  EXCEPTION WHEN OTHERS THEN
    -- Card generation / notification failed — the workout completion stands.
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_print_cards_on_session_complete ON workout_sessions;
CREATE TRIGGER trg_print_cards_on_session_complete
  AFTER INSERT OR UPDATE OF status ON workout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.print_cards_on_session_complete();

NOTIFY pgrst, 'reload schema';
