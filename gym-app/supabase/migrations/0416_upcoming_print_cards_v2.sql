-- =============================================================
-- 0416 — Upcoming print cards v2: predict the new occasion set
--
-- Mirrors the daily generator's new triggers (0415) so the
-- "Coming up next" panel shows the same things the cron will
-- enqueue:
--
--   • Workout milestones    — 100 / 250 / 500 within N more workouts
--   • Tenure milestones     — 30 / 90 / 365 days within N more days
--   • Habit_9in6            — members at target-1 or target-2 in
--                             their trailing 42-day window (almost there)
--   • Birthdays             — within next N days
--
-- Skips members who already have a pending card for that occasion,
-- AND habit_9in6 members who got that card in the last 90 days.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_upcoming_print_cards(
  p_gym_id              UUID,
  p_lookahead_workouts  INT DEFAULT 5,
  p_lookahead_days      INT DEFAULT 7
)
RETURNS TABLE (
  occasion         card_occasion,
  profile_id       UUID,
  full_name        TEXT,
  avatar_url       TEXT,
  headline         TEXT,
  subline          TEXT,
  units_away       INT,
  unit_type        TEXT,            -- 'workouts' | 'days'
  predicted_at     TIMESTAMPTZ,
  current_value    INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND role IN ('admin', 'super_admin', 'trainer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  -- ── Workout milestones approaching (100 / 250 / 500) ──
  WITH session_counts AS (
    SELECT
      ws.profile_id, p.gym_id, p.full_name, p.avatar_url,
      COUNT(*)::INT AS current_count
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.status = 'completed'
      AND p.role = 'member' AND p.membership_status = 'active'
      AND p.gym_id = p_gym_id
    GROUP BY ws.profile_id, p.gym_id, p.full_name, p.avatar_url
  ),
  upcoming_milestones AS (
    SELECT
      sc.profile_id, sc.full_name, sc.avatar_url, sc.current_count,
      m.threshold AS next_threshold
    FROM session_counts sc
    CROSS JOIN LATERAL (
      SELECT t.threshold
      FROM (VALUES (100), (250), (500)) AS t(threshold)
      WHERE t.threshold > sc.current_count
        AND t.threshold - sc.current_count <= p_lookahead_workouts
      ORDER BY t.threshold ASC
      LIMIT 1
    ) m
    WHERE NOT EXISTS (
      SELECT 1 FROM print_cards pc
      WHERE pc.profile_id = sc.profile_id
        AND pc.status = 'pending'
        AND pc.occasion = (CASE m.threshold
          WHEN 100 THEN 'milestone_100'
          WHEN 250 THEN 'milestone_250'
          WHEN 500 THEN 'milestone_500'
        END)::card_occasion
    )
  )
  SELECT
    (CASE um.next_threshold
       WHEN 100 THEN 'milestone_100'
       WHEN 250 THEN 'milestone_250'
       WHEN 500 THEN 'milestone_500'
     END)::card_occasion AS occasion,
    um.profile_id,
    um.full_name,
    um.avatar_url,
    (um.next_threshold || ' workouts logged')::TEXT AS headline,
    (CASE um.next_threshold
       WHEN 100 THEN 'Triple digits. The work shows.'
       WHEN 250 THEN 'Quarter-thousand sessions. Rare company.'
       WHEN 500 THEN 'Five hundred. We''re honored you train here.'
     END)::TEXT AS subline,
    (um.next_threshold - um.current_count)::INT AS units_away,
    'workouts'::TEXT AS unit_type,
    NULL::TIMESTAMPTZ AS predicted_at,
    um.current_count AS current_value
  FROM upcoming_milestones um

  UNION ALL

  -- ── Tenure marks coming up (30 / 90 / 365) ──
  SELECT
    (CASE t_hit.threshold
       WHEN 30  THEN 'tenure_30'
       WHEN 90  THEN 'tenure_90'
       WHEN 365 THEN 'tenure_365'
     END)::card_occasion AS occasion,
    p.id AS profile_id,
    p.full_name,
    p.avatar_url,
    (CASE t_hit.threshold
       WHEN 30  THEN 'One month in.'
       WHEN 90  THEN 'Ninety days strong.'
       WHEN 365 THEN 'One year here.'
     END)::TEXT AS headline,
    (CASE t_hit.threshold
       WHEN 30  THEN 'Past the trial-period brain — you''re a regular now.'
       WHEN 90  THEN 'You''re past the cliff. This is your gym.'
       WHEN 365 THEN 'Twelve months of showing up. Few do this.'
     END)::TEXT AS subline,
    (t_hit.threshold - (CURRENT_DATE - p.created_at::DATE)::INT)::INT AS units_away,
    'days'::TEXT AS unit_type,
    (p.created_at::DATE + t_hit.threshold)::TIMESTAMPTZ AS predicted_at,
    NULL::INT AS current_value
  FROM profiles p
  CROSS JOIN LATERAL (
    SELECT t.threshold
    FROM (VALUES (30), (90), (365)) AS t(threshold)
    WHERE t.threshold > (CURRENT_DATE - p.created_at::DATE)::INT
      AND t.threshold - (CURRENT_DATE - p.created_at::DATE)::INT <= p_lookahead_days
    ORDER BY t.threshold ASC
    LIMIT 1
  ) t_hit
  WHERE p.gym_id = p_gym_id
    AND p.role = 'member'
    AND p.membership_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM print_cards pc
      WHERE pc.profile_id = p.id
        AND pc.status = 'pending'
        AND pc.occasion = (CASE t_hit.threshold
          WHEN 30  THEN 'tenure_30'
          WHEN 90  THEN 'tenure_90'
          WHEN 365 THEN 'tenure_365'
        END)::card_occasion
    )

  UNION ALL

  -- ── habit_9in6 approaching (at target-1 or target-2 in window) ──
  -- "Close to crossing" = within 2 workouts of the gym's configured
  -- habit target inside their rolling habit window. Read settings
  -- per gym so each owner's tuning is honored.
  SELECT
    'habit_9in6'::card_occasion AS occasion,
    sc.profile_id,
    p.full_name,
    p.avatar_url,
    'You''re building the habit.'::TEXT AS headline,
    ('Nine sessions in six weeks — keep going.')::TEXT AS subline,
    (COALESCE(s.habit_target_count, 9) - sc.window_count)::INT AS units_away,
    'workouts'::TEXT AS unit_type,
    NULL::TIMESTAMPTZ AS predicted_at,
    sc.window_count AS current_value
  FROM (
    SELECT
      ws.profile_id,
      p2.gym_id,
      COUNT(*)::INT AS window_count
    FROM workout_sessions ws
    JOIN profiles p2 ON p2.id = ws.profile_id
    LEFT JOIN gym_card_settings s2 ON s2.gym_id = p2.gym_id
    WHERE ws.status = 'completed'
      AND ws.completed_at >= NOW() - (COALESCE(s2.habit_window_days, 42) || ' days')::INTERVAL
      AND p2.role = 'member' AND p2.membership_status = 'active'
      AND p2.gym_id = p_gym_id
    GROUP BY ws.profile_id, p2.gym_id
  ) sc
  JOIN profiles p ON p.id = sc.profile_id
  LEFT JOIN gym_card_settings s ON s.gym_id = sc.gym_id
  WHERE sc.window_count >= COALESCE(s.habit_target_count, 9) - 2
    AND sc.window_count < COALESCE(s.habit_target_count, 9)
    AND NOT EXISTS (
      SELECT 1 FROM print_cards pc
      WHERE pc.profile_id = sc.profile_id
        AND pc.occasion = 'habit_9in6'::card_occasion
        AND pc.created_at >= NOW() - (COALESCE(s.habit_dedup_days, 90) || ' days')::INTERVAL
    )

  UNION ALL

  -- ── Upcoming birthdays (next N days, wrap-around safe) ──
  SELECT
    'birthday'::card_occasion AS occasion,
    p.id AS profile_id,
    p.full_name,
    p.avatar_url,
    'Happy birthday.'::TEXT AS headline,
    'On the house today. Take it easy.'::TEXT AS subline,
    GREATEST(0, (
      CASE
        WHEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) >= CURRENT_DATE
        THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
        ELSE MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
      END
    ))::INT AS units_away,
    'days'::TEXT AS unit_type,
    (CASE
       WHEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                      EXTRACT(MONTH FROM p.date_of_birth)::INT,
                      EXTRACT(DAY FROM p.date_of_birth)::INT) >= CURRENT_DATE
       THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                      EXTRACT(MONTH FROM p.date_of_birth)::INT,
                      EXTRACT(DAY FROM p.date_of_birth)::INT)
       ELSE MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1,
                      EXTRACT(MONTH FROM p.date_of_birth)::INT,
                      EXTRACT(DAY FROM p.date_of_birth)::INT)
     END)::TIMESTAMPTZ AS predicted_at,
    NULL::INT AS current_value
  FROM profiles p
  WHERE p.gym_id = p_gym_id
    AND p.role = 'member'
    AND p.membership_status = 'active'
    AND p.date_of_birth IS NOT NULL
    AND (
      CASE
        WHEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) >= CURRENT_DATE
        THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
        ELSE MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
      END
    ) BETWEEN 0 AND p_lookahead_days
    AND NOT EXISTS (
      SELECT 1 FROM print_cards pc
      WHERE pc.profile_id = p.id
        AND pc.status = 'pending'
        AND pc.occasion = 'birthday'::card_occasion
    )

  ORDER BY units_away ASC, occasion;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_upcoming_print_cards(UUID, INT, INT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
