-- ══════════════════════════════════════════════════════════════════════
-- Security fix: Add SET search_path = public to remaining
-- SECURITY DEFINER functions that were missing it.
--
-- Audit of all 74 SECURITY DEFINER functions found 2 without an
-- explicit search_path:
--
--   1. check_daily_streaks        (0176 — never had it)
--   2. generate_referral_code     (0148 added via ALTER, but 0212
--                                  CREATE OR REPLACE overwrote it)
--
-- Without SET search_path, a malicious user could create objects in a
-- schema that shadows public tables, potentially hijacking queries
-- inside these privileged functions.
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. check_daily_streaks ──────────────────────────────────────────
-- Originally defined in 0176_daily_streak_check_rpc.sql
-- Runs daily (pg_cron) to detect missed training days and
-- auto-apply freezes or break streaks for all active users.

CREATE OR REPLACE FUNCTION check_daily_streaks()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        RECORD;
  v_training_dow INT[];
  v_gym_closed_dows INT[];
  v_closure_dates DATE[];
  v_gap_date    DATE;
  v_gap_dow     INT;
  v_freeze_month TEXT;
  v_freeze_id   UUID;
  v_freeze_used INT;
  v_freeze_max  INT;
  v_streak_broken BOOLEAN;
  v_today       DATE := CURRENT_DATE;
  v_yesterday   DATE := CURRENT_DATE - 1;
  v_broken_count INT := 0;
  v_frozen_count INT := 0;
  v_skipped_count INT := 0;
BEGIN
  -- Process all users with an active streak whose last activity is more than 1 day ago
  FOR v_user IN
    SELECT sc.profile_id, sc.gym_id, sc.current_streak_days, sc.last_activity_date,
           p.preferred_training_days
    FROM streak_cache sc
    JOIN profiles p ON p.id = sc.profile_id
    WHERE sc.current_streak_days > 0
      AND sc.last_activity_date < v_yesterday
  LOOP
    -- Convert training day names to dow numbers
    v_training_dow := '{}';
    IF v_user.preferred_training_days IS NOT NULL AND array_length(v_user.preferred_training_days, 1) > 0 THEN
      SELECT ARRAY(
        SELECT CASE day
          WHEN 'Sunday' THEN 0 WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2
          WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5
          WHEN 'Saturday' THEN 6
        END
        FROM unnest(v_user.preferred_training_days) AS day
      ) INTO v_training_dow;
    END IF;

    -- Get gym recurring closed days
    SELECT COALESCE(ARRAY(
      SELECT day_of_week FROM gym_hours
      WHERE gym_id = v_user.gym_id AND is_closed = TRUE
    ), '{}') INTO v_gym_closed_dows;

    -- Get specific closure dates in the gap range
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

    -- Walk through each gap day
    v_streak_broken := FALSE;
    v_gap_date := v_user.last_activity_date + 1;

    WHILE v_gap_date < v_today AND NOT v_streak_broken LOOP
      v_gap_dow := EXTRACT(DOW FROM v_gap_date)::INT;

      IF v_gap_date = ANY(v_closure_dates) THEN
        -- Specific closure — protected
        NULL;
      ELSIF v_gap_dow = ANY(v_gym_closed_dows) THEN
        -- Recurring gym closed day — protected
        NULL;
      ELSIF array_length(v_training_dow, 1) > 0 AND NOT (v_gap_dow = ANY(v_training_dow)) THEN
        -- Rest day — protected
        NULL;
      ELSE
        -- Unprotected missed training day — try freeze
        v_freeze_month := to_char(v_gap_date, 'YYYY-MM');

        SELECT id, used_count, max_allowed
          INTO v_freeze_id, v_freeze_used, v_freeze_max
          FROM streak_freezes
         WHERE profile_id = v_user.profile_id AND month = v_freeze_month;

        IF NOT FOUND THEN
          -- Auto-apply freeze (create row)
          INSERT INTO streak_freezes (profile_id, month, used_count, max_allowed, frozen_dates)
          VALUES (v_user.profile_id, v_freeze_month, 1, 2, ARRAY[v_gap_date]);
          v_frozen_count := v_frozen_count + 1;
        ELSIF v_freeze_used < v_freeze_max THEN
          -- Use a freeze
          UPDATE streak_freezes
             SET used_count = used_count + 1,
                 frozen_dates = array_append(COALESCE(frozen_dates, '{}'), v_gap_date)
           WHERE id = v_freeze_id;
          v_frozen_count := v_frozen_count + 1;
        ELSE
          -- No freeze available — streak breaks
          v_streak_broken := TRUE;
        END IF;
      END IF;

      v_gap_date := v_gap_date + 1;
    END LOOP;

    IF v_streak_broken THEN
      UPDATE streak_cache SET
        current_streak_days = 0,
        streak_broken_at    = now(),
        updated_at          = now()
      WHERE profile_id = v_user.profile_id;
      v_broken_count := v_broken_count + 1;
    ELSE
      v_skipped_count := v_skipped_count + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'streaks_broken', v_broken_count,
    'freezes_applied', v_frozen_count,
    'users_protected', v_skipped_count,
    'checked_at', now()
  );
END;
$$;


-- ── 2. generate_referral_code ───────────────────────────────────────
-- Originally defined in 0116, search_path added by ALTER in 0148,
-- but CREATE OR REPLACE in 0212 overwrote it without search_path.

CREATE OR REPLACE FUNCTION generate_referral_code(p_profile_id UUID, p_gym_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code TEXT;
  gym_short TEXT;
BEGIN
  IF p_profile_id != auth.uid() THEN
    RAISE EXCEPTION 'Can only generate own referral code';
  END IF;

  -- Get gym short name (first 4 chars uppercased)
  SELECT upper(substr(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'), 1, 4))
  INTO gym_short FROM gyms WHERE id = p_gym_id;

  -- Generate unique code
  LOOP
    new_code := 'REF-' || COALESCE(gym_short, 'GYM') || '-' || upper(substr(md5(random()::text), 1, 4));
    BEGIN
      INSERT INTO referral_codes (profile_id, gym_id, code)
      VALUES (p_profile_id, p_gym_id, new_code)
      ON CONFLICT (profile_id, gym_id) DO NOTHING;

      IF FOUND THEN
        RETURN new_code;
      ELSE
        -- Already exists for this user+gym, return existing
        SELECT code INTO new_code FROM referral_codes WHERE profile_id = p_profile_id AND gym_id = p_gym_id;
        RETURN new_code;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Code collision, try again
      CONTINUE;
    END;
  END LOOP;
END;
$$;


-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
