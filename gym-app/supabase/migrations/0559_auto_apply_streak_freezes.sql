-- 0559_auto_apply_streak_freezes.sql
-- ----------------------------------------------------------------------------
-- Auto-apply streak freezes (Duolingo-style).
--
-- Background: migration 0318 removed the auto-burn of streak freezes and
-- pointed at a manual use_streak_freeze() RPC + "Use freeze" button — neither
-- of which were ever built. Net result: the freeze a member sees ("1 freeze
-- available") could NEVER be consumed, so any unprotected missed training day
-- broke the streak even when the member had freezes left.
--
-- This restores auto-apply, but as a dedicated, idempotent batch step rather
-- than re-touching the big streak RPCs: for each member with a recent,
-- still-savable streak, walk the gap days and — for any day that ISN'T already
-- protected (rest day / gym closure / already-frozen) — consume one of the
-- member's monthly freezes (max_allowed, default 2) and record the date in
-- streak_freezes.frozen_dates.
--
-- Because complete_workout / check_daily_streaks / log_cardio_session already
-- treat any date in frozen_dates as protected (via _streak_gap_day_protected),
-- and the client's calendar streak counts 'frozen' days, those days are now
-- saved everywhere with no change to those functions. Scheduled at 05:20 UTC,
-- 10 min BEFORE the daily streak-break cron (05:30), so a day is frozen before
-- anything tries to break on it.
--
-- Visibility (addresses 0318's "silent burn" concern): the day shows as a
-- frozen/ice day on the streak calendar, the remaining-freezes count drops,
-- and we insert a (deduped) notification telling the member a freeze was used.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_apply_streak_freezes(p_notify BOOLEAN DEFAULT TRUE)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user            RECORD;
  v_training_dow    INT[];
  v_gym_closed_dows INT[];
  v_closure_dates   DATE[];
  v_frozen_dates    DATE[];
  v_gap_date        DATE;
  v_today           DATE := CURRENT_DATE;
  v_month           TEXT;
  v_used            INT;
  v_max             INT;
  v_applied         INT := 0;
  v_users           INT := 0;
BEGIN
  FOR v_user IN
    SELECT sc.profile_id, sc.gym_id, sc.last_activity_date, p.preferred_training_days
    FROM streak_cache sc
    JOIN profiles p ON p.id = sc.profile_id
    WHERE sc.current_streak_days >= 1               -- had an active streak
      AND sc.last_activity_date < v_today - 1        -- a real gap exists
      AND sc.last_activity_date >= v_today - 31       -- still recent / savable
  LOOP
    v_users := v_users + 1;

    -- Member's training days → DOW ints (empty = no preference)
    v_training_dow := '{}';
    IF v_user.preferred_training_days IS NOT NULL
       AND array_length(v_user.preferred_training_days, 1) > 0 THEN
      SELECT ARRAY(
        SELECT CASE day
          WHEN 'Sunday' THEN 0 WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2
          WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5
          WHEN 'Saturday' THEN 6
        END
        FROM unnest(v_user.preferred_training_days) AS day
      ) INTO v_training_dow;
    END IF;

    -- Recurring weekly gym closures
    SELECT COALESCE(ARRAY(
      SELECT day_of_week FROM gym_hours
      WHERE gym_id = v_user.gym_id AND is_closed = TRUE
    ), '{}') INTO v_gym_closed_dows;

    -- One-off closures / holidays in the gap range
    SELECT COALESCE(ARRAY(
      SELECT closure_date FROM gym_closures
      WHERE gym_id = v_user.gym_id
        AND closure_date > v_user.last_activity_date
        AND closure_date < v_today
      UNION
      SELECT date FROM gym_holidays
      WHERE gym_id = v_user.gym_id
        AND date > v_user.last_activity_date
        AND date < v_today
        AND is_closed = TRUE
    ), '{}') INTO v_closure_dates;

    -- Already-frozen dates (any month)
    SELECT COALESCE(ARRAY(
      SELECT UNNEST(frozen_dates) FROM streak_freezes
      WHERE profile_id = v_user.profile_id AND frozen_dates IS NOT NULL
    ), '{}') INTO v_frozen_dates;

    v_gap_date := v_user.last_activity_date + 1;

    WHILE v_gap_date < v_today LOOP
      -- Only act on days that aren't already protected (rest / closure / frozen)
      IF NOT public._streak_gap_day_protected(
        v_gap_date, v_user.last_activity_date, v_today,
        v_training_dow, v_gym_closed_dows, v_closure_dates, v_frozen_dates
      ) THEN
        v_month := to_char(v_gap_date, 'YYYY-MM');

        SELECT used_count, max_allowed INTO v_used, v_max
        FROM streak_freezes
        WHERE profile_id = v_user.profile_id AND month = v_month;

        IF NOT FOUND THEN
          v_used := 0; v_max := 2;   -- table default max_allowed = 2 / month
        END IF;

        IF v_used < COALESCE(v_max, 2) THEN
          -- Consume one freeze for this day
          INSERT INTO streak_freezes (profile_id, month, used_count, max_allowed, frozen_dates)
          VALUES (v_user.profile_id, v_month, 1, COALESCE(v_max, 2), ARRAY[v_gap_date])
          ON CONFLICT (profile_id, month) DO UPDATE SET
            used_count   = streak_freezes.used_count + 1,
            frozen_dates = array_append(COALESCE(streak_freezes.frozen_dates, '{}'::date[]), v_gap_date);

          v_frozen_dates := array_append(v_frozen_dates, v_gap_date);  -- keep snapshot fresh
          v_applied := v_applied + 1;

          -- Tell the member (deduped per day; survives re-runs). Suppressed
          -- for the one-time backfill so old gaps don't fire a notification burst.
          IF p_notify THEN
            INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
            SELECT v_user.profile_id, v_user.gym_id, 'streak_warning'::notification_type,
                   'Streak freeze used 🧊',
                   'We used one of your streak freezes to protect your streak for '
                     || to_char(v_gap_date, 'Mon DD') || '.',
                   'streak_freeze:' || v_gap_date::text
            WHERE NOT EXISTS (
              SELECT 1 FROM notifications n
              WHERE n.profile_id = v_user.profile_id
                AND n.dedup_key = 'streak_freeze:' || v_gap_date::text
            );
          END IF;
        ELSE
          EXIT;  -- out of freezes this month → let the streak break naturally
        END IF;
      END IF;

      v_gap_date := v_gap_date + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'users_checked',   v_users,
    'freezes_applied', v_applied,
    'ran_at',          now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_apply_streak_freezes(boolean) FROM PUBLIC;

-- Run daily at 05:20 UTC — 10 min BEFORE the streak-break cron (05:30, mig 0177)
-- so save-worthy days are frozen before anything tries to break on them.
-- cron.schedule upserts by job name, so re-running this migration is safe.
SELECT cron.schedule(
  'auto-apply-streak-freezes',
  '20 5 * * *',
  $$ SELECT public.auto_apply_streak_freezes(); $$
);

-- One-time backfill: protect any currently-savable streaks right now, silently
-- (no notification spam for already-past gaps — the calendar shows the freeze).
SELECT public.auto_apply_streak_freezes(FALSE);

NOTIFY pgrst, 'reload schema';
