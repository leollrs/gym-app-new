-- =============================================================
-- 0434_gym_daily_activity_rollup.sql
--
-- Removes the full-table scans from the activity-pulse RPCs (0433). Instead
-- of aggregating raw check_ins / workout_sessions on every platform read, we
-- maintain a tiny per-gym-per-day rollup that triggers keep current. Both
-- 0433 RPCs are rewritten to read this rollup, so they stay O(rollup rows)
-- forever — one row per gym per active day, not one per check-in/workout.
--
--   gym_daily_activity(gym_id, activity_date, checkins, workouts)
--     • day buckets are in the gym's LOCAL timezone (matches the chart)
--     • incremented by AFTER-INSERT trigger on check_ins
--     • incremented by completion trigger on workout_sessions
--     • backfilled once from existing history below
--
-- The triggers are SECURITY DEFINER + exception-guarded: a rollup hiccup must
-- never block a member's check-in or workout.
-- =============================================================

CREATE TABLE IF NOT EXISTS gym_daily_activity (
  gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  checkins      INT  NOT NULL DEFAULT 0,
  workouts      INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (gym_id, activity_date)
);

ALTER TABLE gym_daily_activity ENABLE ROW LEVEL SECURITY;

-- Read-only for super_admin (the RPCs are SECURITY DEFINER and bypass this;
-- the policy just covers any direct client read). No client writes — the
-- triggers own all mutations.
DROP POLICY IF EXISTS gym_daily_activity_super_admin ON gym_daily_activity;
CREATE POLICY gym_daily_activity_super_admin
  ON gym_daily_activity FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── One-time backfill from existing history ─────────────────
INSERT INTO gym_daily_activity (gym_id, activity_date, checkins, workouts)
SELECT gym_id, activity_date, SUM(ci)::INT, SUM(ws)::INT
FROM (
  SELECT c.gym_id,
         (c.checked_in_at AT TIME ZONE COALESCE(g.timezone, 'America/Puerto_Rico'))::date AS activity_date,
         1 AS ci, 0 AS ws
  FROM check_ins c JOIN gyms g ON g.id = c.gym_id
  UNION ALL
  SELECT s.gym_id,
         (COALESCE(s.completed_at, s.started_at) AT TIME ZONE COALESCE(g.timezone, 'America/Puerto_Rico'))::date,
         0, 1
  FROM workout_sessions s JOIN gyms g ON g.id = s.gym_id
  WHERE s.status = 'completed'
) x
GROUP BY gym_id, activity_date
ON CONFLICT (gym_id, activity_date)
  DO UPDATE SET checkins = EXCLUDED.checkins, workouts = EXCLUDED.workouts;

-- ── Trigger: check-in → rollup ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rollup_checkin_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  BEGIN
    SELECT COALESCE(timezone, 'America/Puerto_Rico') INTO v_tz FROM gyms WHERE id = NEW.gym_id;
    INSERT INTO gym_daily_activity (gym_id, activity_date, checkins, workouts)
    VALUES (NEW.gym_id, (NEW.checked_in_at AT TIME ZONE COALESCE(v_tz, 'America/Puerto_Rico'))::date, 1, 0)
    ON CONFLICT (gym_id, activity_date)
      DO UPDATE SET checkins = gym_daily_activity.checkins + 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- never block the check-in
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rollup_checkin_activity ON check_ins;
CREATE TRIGGER trg_rollup_checkin_activity
  AFTER INSERT ON check_ins
  FOR EACH ROW EXECUTE FUNCTION public.rollup_checkin_activity();

-- ── Trigger: completed workout → rollup ─────────────────────
CREATE OR REPLACE FUNCTION public.rollup_workout_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  -- Only count on a fresh transition into 'completed'.
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  BEGIN
    SELECT COALESCE(timezone, 'America/Puerto_Rico') INTO v_tz FROM gyms WHERE id = NEW.gym_id;
    INSERT INTO gym_daily_activity (gym_id, activity_date, checkins, workouts)
    VALUES (
      NEW.gym_id,
      (COALESCE(NEW.completed_at, NEW.started_at, now()) AT TIME ZONE COALESCE(v_tz, 'America/Puerto_Rico'))::date,
      0, 1
    )
    ON CONFLICT (gym_id, activity_date)
      DO UPDATE SET workouts = gym_daily_activity.workouts + 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- never block the workout completion
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rollup_workout_activity ON workout_sessions;
CREATE TRIGGER trg_rollup_workout_activity
  AFTER INSERT OR UPDATE OF status ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.rollup_workout_activity();

-- ── Rewrite the pulse RPC to read the rollup (no raw scans) ─
CREATE OR REPLACE FUNCTION public.platform_gym_activity_pulse(p_window_days INT DEFAULT 14)
RETURNS TABLE (
  gym_id          UUID,
  gym_name        TEXT,
  cur_checkins    BIGINT,
  prior_checkins  BIGINT,
  cur_workouts    BIGINT,
  prior_workouts  BIGINT,
  last_activity   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  RETURN QUERY
  WITH win AS (
    SELECT a.gym_id,
      COALESCE(SUM(a.checkins) FILTER (WHERE a.activity_date >  CURRENT_DATE - p_window_days), 0) AS cur_ci,
      COALESCE(SUM(a.checkins) FILTER (WHERE a.activity_date >  CURRENT_DATE - p_window_days * 2
                                         AND a.activity_date <= CURRENT_DATE - p_window_days), 0) AS prior_ci,
      COALESCE(SUM(a.workouts) FILTER (WHERE a.activity_date >  CURRENT_DATE - p_window_days), 0) AS cur_ws,
      COALESCE(SUM(a.workouts) FILTER (WHERE a.activity_date >  CURRENT_DATE - p_window_days * 2
                                         AND a.activity_date <= CURRENT_DATE - p_window_days), 0) AS prior_ws
    FROM gym_daily_activity a
    WHERE a.activity_date > CURRENT_DATE - p_window_days * 2
    GROUP BY a.gym_id
  ),
  last AS (
    SELECT a.gym_id, MAX(a.activity_date) AS last_day
    FROM gym_daily_activity a
    GROUP BY a.gym_id
  )
  SELECT
    g.id,
    g.name,
    COALESCE(win.cur_ci, 0)::BIGINT,
    COALESCE(win.prior_ci, 0)::BIGINT,
    COALESCE(win.cur_ws, 0)::BIGINT,
    COALESCE(win.prior_ws, 0)::BIGINT,
    last.last_day::timestamptz
  FROM gyms g
  LEFT JOIN win  ON win.gym_id  = g.id
  LEFT JOIN last ON last.gym_id = g.id
  WHERE g.is_active = TRUE
  ORDER BY g.name;
END;
$$;

-- ── Rewrite the daily-series RPC to read the rollup ─────────
CREATE OR REPLACE FUNCTION public.gym_activity_daily(p_gym_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE (
  day       DATE,
  checkins  BIGINT,
  workouts  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT COALESCE(timezone, 'America/Puerto_Rico') INTO v_tz FROM gyms WHERE id = p_gym_id;
  v_tz := COALESCE(v_tz, 'America/Puerto_Rico');

  RETURN QUERY
  SELECT
    gs::date,
    COALESCE(r.checkins, 0)::BIGINT,
    COALESCE(r.workouts, 0)::BIGINT
  FROM generate_series(
    (timezone(v_tz, now())::date - (p_days - 1)),
    (timezone(v_tz, now())::date),
    INTERVAL '1 day'
  ) gs
  LEFT JOIN gym_daily_activity r
    ON r.gym_id = p_gym_id AND r.activity_date = gs::date
  ORDER BY gs::date;
END;
$$;

NOTIFY pgrst, 'reload schema';
