-- ============================================================
-- 0350 — Birthday rewards system
-- ============================================================
-- New gym-configurable feature: on each member's birthday, the
-- system sends a celebration notification and (optionally) credits
-- a configurable points reward.
--
-- Schema additions:
--   gyms.birthday_rewards_enabled  BOOL  — gym master toggle
--   gyms.birthday_reward_points    INT   — points to gift (0 = none)
--   gyms.birthday_reward_message   TEXT  — custom celebration copy
--   profiles.birthday_celebrated_year INT — idempotency guard
--
-- New RPC `process_birthdays()` runs daily via pg_cron at 06:00 UTC.
-- Iterates over today's birthdays where the year hasn't been
-- celebrated yet, awards points (if enabled), inserts a
-- notification, and stamps profiles.birthday_celebrated_year.
-- ============================================================

-- Notification enum: extend with 'birthday' so the INSERT below
-- doesn't blow up against the existing notification_type enum
-- (defined in 0001, last extended in 0271).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'birthday';

ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS birthday_rewards_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS birthday_reward_points   INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS birthday_reward_message  TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birthday_celebrated_year INTEGER;

COMMENT ON COLUMN public.gyms.birthday_rewards_enabled IS
  'Master toggle for the birthday rewards feature. When false, no points are credited but the celebration notification is still sent.';
COMMENT ON COLUMN public.gyms.birthday_reward_points IS
  'Points credited to a member on their birthday. 0 disables the points portion (notification still fires).';
COMMENT ON COLUMN public.gyms.birthday_reward_message IS
  'Optional custom message shown in the birthday notification body. Falls back to a localized default if NULL.';
COMMENT ON COLUMN public.profiles.birthday_celebrated_year IS
  'Year (YYYY) of the most recent birthday celebration. Prevents process_birthdays() from double-firing if it runs more than once a day.';

-- ============================================================
-- process_birthdays() — daily sweep
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_birthdays()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row              RECORD;
  _now              TIMESTAMPTZ := NOW();
  _today            DATE := _now::date;
  _current_year     INT  := EXTRACT(YEAR FROM _today)::int;
  _processed_count  INT  := 0;
  _points_awarded   INT  := 0;
  _gym_enabled      BOOLEAN;
  _gym_points       INT;
  _gym_message      TEXT;
  _gym_name         TEXT;
  _notif_title      TEXT;
  _notif_body       TEXT;
  _dedup_key        TEXT;
BEGIN
  FOR _row IN
    SELECT p.id, p.gym_id, p.full_name, p.preferred_language, p.date_of_birth
      FROM profiles p
     WHERE p.date_of_birth IS NOT NULL
       AND EXTRACT(MONTH FROM p.date_of_birth)::int = EXTRACT(MONTH FROM _today)::int
       AND EXTRACT(DAY   FROM p.date_of_birth)::int = EXTRACT(DAY   FROM _today)::int
       AND (p.birthday_celebrated_year IS NULL OR p.birthday_celebrated_year < _current_year)
       AND p.is_onboarded = true
       AND p.gym_id IS NOT NULL
  LOOP
    SELECT g.birthday_rewards_enabled, g.birthday_reward_points, g.birthday_reward_message, g.name
      INTO _gym_enabled, _gym_points, _gym_message, _gym_name
      FROM gyms g
     WHERE g.id = _row.gym_id;

    -- Skip if gym is paused / inactive
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Build localized notification copy (Spanish vs English fallback)
    IF _row.preferred_language = 'es' THEN
      _notif_title := '🎉 ¡Feliz cumpleaños!';
      IF _gym_message IS NOT NULL AND length(trim(_gym_message)) > 0 THEN
        _notif_body := _gym_message;
      ELSIF _gym_enabled AND _gym_points > 0 THEN
        _notif_body := COALESCE(_gym_name, 'Tu gimnasio') || ' te regala ' || _gym_points || ' puntos por tu cumpleaños 🎂';
      ELSE
        _notif_body := COALESCE(_gym_name, 'Tu gimnasio') || ' te desea un feliz cumpleaños 🎂';
      END IF;
    ELSE
      _notif_title := '🎉 Happy Birthday!';
      IF _gym_message IS NOT NULL AND length(trim(_gym_message)) > 0 THEN
        _notif_body := _gym_message;
      ELSIF _gym_enabled AND _gym_points > 0 THEN
        _notif_body := COALESCE(_gym_name, 'Your gym') || ' just gifted you ' || _gym_points || ' points for your birthday 🎂';
      ELSE
        _notif_body := COALESCE(_gym_name, 'Your gym') || ' wishes you a happy birthday 🎂';
      END IF;
    END IF;

    _dedup_key := 'birthday_' || _row.id::text || '_' || _current_year::text;

    -- Award points (only if enabled and amount > 0). Bypass the
    -- whitelist in add_reward_points by inserting directly — this
    -- function runs SECURITY DEFINER from a trusted cron sweep, so
    -- the action is auditable without going through the player-
    -- facing RPC.
    IF _gym_enabled AND _gym_points > 0 THEN
      INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
      VALUES (_row.id, _row.gym_id, 'birthday_gift', _gym_points,
              'Birthday gift from ' || COALESCE(_gym_name, 'gym'), _now);

      INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
      VALUES (_row.id, _row.gym_id, _gym_points, _gym_points, _now)
      ON CONFLICT (profile_id) DO UPDATE SET
        total_points    = reward_points.total_points    + _gym_points,
        lifetime_points = reward_points.lifetime_points + _gym_points,
        last_updated    = _now;

      _points_awarded := _points_awarded + _gym_points;
    END IF;

    -- Notification (always fires, even if rewards disabled — this
    -- is a celebration, not just a reward delivery)
    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key, created_at)
    VALUES (_row.id, _row.gym_id, 'birthday', _notif_title, _notif_body, _dedup_key, _now)
    ON CONFLICT (dedup_key) DO NOTHING;

    -- Mark as celebrated for this year
    UPDATE profiles
       SET birthday_celebrated_year = _current_year
     WHERE id = _row.id;

    _processed_count := _processed_count + 1;
  END LOOP;

  RETURN json_build_object(
    'processed', _processed_count,
    'points_awarded', _points_awarded,
    'date', _today
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_birthdays() TO service_role;

-- ============================================================
-- Daily cron: 06:00 UTC (early local for US/EU members)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('birthday-rewards-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'birthday-rewards-daily');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'birthday-rewards-daily',
      '0 6 * * *',
      $cron$ SELECT public.process_birthdays(); $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule process_birthdays() manually (daily at 06:00 UTC) via Supabase Dashboard.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
