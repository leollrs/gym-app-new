-- =============================================================
-- 0414 — Upcoming print cards RPC
--
-- The daily generator (0399) creates print cards AFTER a milestone
-- crosses. Owners asked: "let me see what's coming so I can prep
-- the cards before the moment." This RPC returns the predictable
-- upcoming occasions:
--
--   • Workout milestones — members within N workouts of crossing
--     25 / 100 / 500. Tuneable via p_lookahead_workouts.
--   • Birthdays         — members with date_of_birth within the
--     next p_lookahead_days days (default 7), wrap-around-safe.
--
-- Not predicted (returned empty): welcome (no prior signal),
-- returning (depends on whether they come back), first_pr (depends
-- on exercise of the day).
--
-- Output shape mirrors the print_cards card preview so the UI can
-- render the same headline/subline format consumers already know.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_upcoming_print_cards(
  p_gym_id              UUID,
  p_lookahead_workouts  INT DEFAULT 5,
  p_lookahead_days      INT DEFAULT 7
)
RETURNS TABLE (
  occasion             card_occasion,
  profile_id           UUID,
  full_name            TEXT,
  avatar_url           TEXT,
  headline             TEXT,
  subline              TEXT,
  -- Predictive metric: number of workouts away (for milestone) OR
  -- days away (for birthday). Always positive integer.
  units_away           INT,
  unit_type            TEXT,            -- 'workouts' | 'days'
  predicted_at         TIMESTAMPTZ,     -- best-effort eta (birthday only)
  current_value        INT              -- current workout count or NULL
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admin/staff of this gym can read this.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND role IN ('admin', 'super_admin', 'trainer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  -- ── Upcoming milestone crossings (25 / 100 / 500) ──
  WITH session_counts AS (
    SELECT
      ws.profile_id,
      p.gym_id,
      p.full_name,
      p.avatar_url,
      COUNT(*)::INT AS current_count
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.status = 'completed'
      AND p.role = 'member'
      AND p.membership_status = 'active'
      AND p.gym_id = p_gym_id
    GROUP BY ws.profile_id, p.gym_id, p.full_name, p.avatar_url
  ),
  upcoming_milestones AS (
    SELECT
      sc.profile_id,
      sc.full_name,
      sc.avatar_url,
      sc.current_count,
      m.threshold AS next_threshold
    FROM session_counts sc
    CROSS JOIN LATERAL (
      -- For each member, pick the nearest threshold that's STRICTLY ahead.
      SELECT t.threshold
      FROM (VALUES (25), (100), (500)) AS t(threshold)
      WHERE t.threshold > sc.current_count
        AND t.threshold - sc.current_count <= p_lookahead_workouts
      ORDER BY t.threshold ASC
      LIMIT 1
    ) m
    WHERE
      -- Skip if a pending card for this exact milestone is already queued
      -- (avoids the upcoming list double-showing what's already in print queue)
      NOT EXISTS (
        SELECT 1 FROM print_cards pc
        WHERE pc.profile_id = sc.profile_id
          AND pc.status = 'pending'
          AND pc.occasion = (
            CASE m.threshold
              WHEN 25  THEN 'milestone_25'
              WHEN 100 THEN 'milestone_100'
              WHEN 500 THEN 'milestone_500'
            END
          )::card_occasion
      )
  )
  SELECT
    (CASE um.next_threshold
       WHEN 25  THEN 'milestone_25'
       WHEN 100 THEN 'milestone_100'
       WHEN 500 THEN 'milestone_500'
     END)::card_occasion AS occasion,
    um.profile_id,
    um.full_name,
    um.avatar_url,
    (um.next_threshold || ' workouts logged')::TEXT AS headline,
    'I see the work you''re putting in.'::TEXT AS subline,
    (um.next_threshold - um.current_count)::INT AS units_away,
    'workouts'::TEXT AS unit_type,
    NULL::TIMESTAMPTZ AS predicted_at,
    um.current_count AS current_value
  FROM upcoming_milestones um

  UNION ALL

  -- ── Upcoming birthdays (next N days, wrap-around safe) ──
  SELECT
    'birthday'::card_occasion AS occasion,
    p.id AS profile_id,
    p.full_name,
    p.avatar_url,
    'Happy birthday'::TEXT AS headline,
    'On the house — your day to take it easy.'::TEXT AS subline,
    -- Days until next birthday. `date - date` returns INTEGER directly
    -- in Postgres, so no EXTRACT wrapper needed. Cross-year wrap is
    -- handled by adding 1y if today is past the birthday's MM-DD.
    GREATEST(
      0,
      (
        CASE
          WHEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                         EXTRACT(MONTH FROM p.date_of_birth)::INT,
                         EXTRACT(DAY FROM p.date_of_birth)::INT)
               >= CURRENT_DATE
          THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                         EXTRACT(MONTH FROM p.date_of_birth)::INT,
                         EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
          ELSE MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1,
                         EXTRACT(MONTH FROM p.date_of_birth)::INT,
                         EXTRACT(DAY FROM p.date_of_birth)::INT) - CURRENT_DATE
        END
      )
    )::INT AS units_away,
    'days'::TEXT AS unit_type,
    (
      CASE
        WHEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT)
             >= CURRENT_DATE
        THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT)
        ELSE MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1,
                       EXTRACT(MONTH FROM p.date_of_birth)::INT,
                       EXTRACT(DAY FROM p.date_of_birth)::INT)
      END
    )::TIMESTAMPTZ AS predicted_at,
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
                       EXTRACT(DAY FROM p.date_of_birth)::INT)
             >= CURRENT_DATE
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

  ORDER BY occasion, units_away ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_upcoming_print_cards(UUID, INT, INT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
