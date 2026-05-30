-- Fix: process_birthdays() failed in the birthday-rewards-daily cron with
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- The notifications dedup index (idx_notifications_dedup_key, migration 0155) is a
-- PARTIAL unique index (WHERE dedup_key IS NOT NULL). For ON CONFLICT inference to
-- match a partial index, the statement must repeat the index predicate. Every other
-- notification insert already does this; process_birthdays() (last redefined in 0370)
-- was missing the predicate, so the conflict target matched nothing and the function
-- raised at runtime.
--
-- This recreates the 0370 version verbatim except for the corrected ON CONFLICT clause.

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
  _rewards_awarded  INT  := 0;
  _gym_enabled      BOOLEAN;
  _gym_points       INT;
  _gym_message      TEXT;
  _gym_name         TEXT;
  _gym_reward_id    UUID;
  _notif_title      TEXT;
  _notif_body       TEXT;
  _dedup_key        TEXT;
  _earned_id        UUID;
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
    SELECT g.birthday_rewards_enabled, g.birthday_reward_points, g.birthday_reward_message,
           g.name, g.birthday_reward_id
      INTO _gym_enabled, _gym_points, _gym_message, _gym_name, _gym_reward_id
      FROM gyms g
     WHERE g.id = _row.gym_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Build notification copy (unchanged from previous version)
    IF _row.preferred_language = 'es' THEN
      _notif_title := '🎉 ¡Feliz cumpleaños!';
      IF _gym_message IS NOT NULL AND length(trim(_gym_message)) > 0 THEN
        _notif_body := _gym_message;
      ELSIF _gym_enabled AND _gym_reward_id IS NOT NULL THEN
        _notif_body := COALESCE(_gym_name, 'Tu gimnasio') || ' tiene un regalo especial para ti 🎂';
      ELSIF _gym_enabled AND _gym_points > 0 THEN
        _notif_body := COALESCE(_gym_name, 'Tu gimnasio') || ' te regala ' || _gym_points || ' puntos por tu cumpleaños 🎂';
      ELSE
        _notif_body := COALESCE(_gym_name, 'Tu gimnasio') || ' te desea un feliz cumpleaños 🎂';
      END IF;
    ELSE
      _notif_title := '🎉 Happy Birthday!';
      IF _gym_message IS NOT NULL AND length(trim(_gym_message)) > 0 THEN
        _notif_body := _gym_message;
      ELSIF _gym_enabled AND _gym_reward_id IS NOT NULL THEN
        _notif_body := COALESCE(_gym_name, 'Your gym') || ' has a special gift for you 🎂';
      ELSIF _gym_enabled AND _gym_points > 0 THEN
        _notif_body := COALESCE(_gym_name, 'Your gym') || ' just gifted you ' || _gym_points || ' points for your birthday 🎂';
      ELSE
        _notif_body := COALESCE(_gym_name, 'Your gym') || ' wishes you a happy birthday 🎂';
      END IF;
    END IF;

    _dedup_key := 'birthday_' || _row.id::text || '_' || _current_year::text;

    -- Points portion (unchanged)
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

    -- Custom reward portion. Idempotent on dedup_key 'birthday_<profile>_<year>'
    IF _gym_enabled AND _gym_reward_id IS NOT NULL THEN
      _earned_id := public.award_earned_reward(
        p_profile_id => _row.id,
        p_reward_id  => _gym_reward_id,
        p_source     => 'birthday',
        p_source_id  => NULL,
        p_dedup_key  => _dedup_key
      );
      IF _earned_id IS NOT NULL THEN
        _rewards_awarded := _rewards_awarded + 1;
      END IF;
    END IF;

    -- Notification (always fires on a birthday)
    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key, created_at)
    VALUES (_row.id, _row.gym_id, 'birthday', _notif_title, _notif_body, _dedup_key, _now)
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

    UPDATE profiles
       SET birthday_celebrated_year = _current_year
     WHERE id = _row.id;

    _processed_count := _processed_count + 1;
  END LOOP;

  RETURN json_build_object(
    'processed', _processed_count,
    'points_awarded', _points_awarded,
    'rewards_awarded', _rewards_awarded,
    'date', _today
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_birthdays() TO service_role;
