-- ============================================================
-- 0154: Consolidated RPCs for Dashboard & Auth Context
-- Eliminates query waterfalls by batching multiple queries
-- into single round-trips.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. get_dashboard_data()
-- Returns all data the Dashboard page needs in one call.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_data()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid       UUID := auth.uid();
  _gym_id    UUID;
  _result    JSON;
BEGIN
  -- Resolve the user's gym
  SELECT gym_id INTO _gym_id
    FROM profiles
   WHERE id = _uid;

  SELECT json_build_object(
    -- Recent completed sessions (last 50)
    'sessions', (
      SELECT COALESCE(json_agg(s ORDER BY s.completed_at DESC), '[]'::json)
        FROM (
          SELECT id, name, completed_at, total_volume_lbs,
                 duration_seconds, routine_id
            FROM workout_sessions
           WHERE profile_id = _uid
             AND status = 'completed'
           ORDER BY completed_at DESC
           LIMIT 50
        ) s
    ),

    -- User's routines with exercises
    'routines', (
      SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json)
        FROM (
          SELECT r.id, r.name, r.description, r.created_at,
                 (
                   SELECT COALESCE(json_agg(
                     json_build_object(
                       'id',          re.id,
                       'exercise_id', re.exercise_id,
                       'target_sets', re.target_sets,
                       'target_reps', re.target_reps,
                       'position',    re.position,
                       'exercises',   json_build_object(
                         'name',      e.name,
                         'name_es',   e.name_es,
                         'video_url', e.video_url
                       )
                     ) ORDER BY re.position
                   ), '[]'::json)
                   FROM routine_exercises re
                   LEFT JOIN exercises e ON e.id = re.exercise_id
                  WHERE re.routine_id = r.id
                 ) AS routine_exercises
            FROM routines r
           WHERE r.created_by = _uid
             AND r.is_template = FALSE
           ORDER BY r.created_at DESC
        ) r
    ),

    -- Workout schedule
    'schedule', (
      SELECT COALESCE(json_agg(
        json_build_object('day_of_week', ws.day_of_week, 'routine_id', ws.routine_id)
      ), '[]'::json)
        FROM workout_schedule ws
       WHERE ws.profile_id = _uid
    ),

    -- Active generated program (not expired)
    'program', (
      SELECT row_to_json(p)
        FROM (
          SELECT id, program_start, split_type, expires_at, routines_a_count
            FROM generated_programs
           WHERE profile_id = _uid
             AND expires_at > NOW()
           ORDER BY created_at DESC
           LIMIT 1
        ) p
    ),

    -- Gym hours
    'gym_hours', (
      SELECT COALESCE(json_agg(
        json_build_object('day_of_week', gh.day_of_week, 'is_closed', gh.is_closed)
      ), '[]'::json)
        FROM gym_hours gh
       WHERE gh.gym_id = _gym_id
    ),

    -- Streak cache
    'streak', (
      SELECT row_to_json(sc)
        FROM (
          SELECT current_streak_days, longest_streak_days
            FROM streak_cache
           WHERE profile_id = _uid
        ) sc
    ),

    -- Reward points (current balance + lifetime)
    'points', (
      SELECT row_to_json(rp)
        FROM (
          SELECT total_points, lifetime_points
            FROM reward_points
           WHERE profile_id = _uid
        ) rp
    ),

    -- Active challenge for the user's gym
    'challenge', (
      SELECT row_to_json(c)
        FROM (
          SELECT id, name, type, start_date, end_date
            FROM challenges
           WHERE gym_id = _gym_id
             AND start_date <= NOW()
             AND end_date   >= NOW()
           ORDER BY start_date ASC
           LIMIT 1
        ) c
    )
  ) INTO _result;

  RETURN _result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_dashboard_data() TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 2. get_auth_context()
-- Returns profile, gym branding, gym info, and unread
-- notification count in one call.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid      UUID := auth.uid();
  _result   JSON;
BEGIN
  SELECT json_build_object(
    -- Profile row
    'profile', (
      SELECT row_to_json(p)
        FROM (
          SELECT id, gym_id, full_name, username, role, is_onboarded,
                 avatar_url, avatar_type, avatar_value,
                 preferred_language, membership_status,
                 last_active_at, qr_code_payload,
                 preferred_training_days, skip_suggestion_date
            FROM profiles
           WHERE id = _uid
        ) p
    ),

    -- Gym branding
    'branding', (
      SELECT row_to_json(b)
        FROM (
          SELECT gb.primary_color, gb.accent_color, gb.palette_name,
                 gb.logo_url, gb.custom_app_name, gb.surface_color
            FROM gym_branding gb
           INNER JOIN profiles pr ON pr.id = _uid AND pr.gym_id = gb.gym_id
        ) b
    ),

    -- Gym basic info
    'gym', (
      SELECT row_to_json(g)
        FROM (
          SELECT gy.name, gy.is_active, gy.qr_enabled, gy.qr_display_format
            FROM gyms gy
           INNER JOIN profiles pr ON pr.id = _uid AND pr.gym_id = gy.id
        ) g
    ),

    -- Unread notification count
    'unread_count', (
      SELECT COUNT(*)::int
        FROM notifications
       WHERE profile_id = _uid
         AND read_at IS NULL
    ),

    -- Lifetime points for level calculation
    'lifetime_points', (
      SELECT COALESCE(rp.lifetime_points, 0)
        FROM reward_points rp
       WHERE rp.profile_id = _uid
    )
  ) INTO _result;

  RETURN _result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_auth_context() TO authenticated;
