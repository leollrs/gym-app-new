-- Add rest_seconds to routine_exercises in get_dashboard_data RPC
-- so the Dashboard time estimate matches the WorkoutBuilder
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

    -- User's routines with exercises (now includes rest_seconds)
    'routines', (
      SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json)
        FROM (
          SELECT r.id, r.name, r.description, r.created_at,
                 (
                   SELECT COALESCE(json_agg(
                     json_build_object(
                       'id',           re.id,
                       'exercise_id',  re.exercise_id,
                       'target_sets',  re.target_sets,
                       'target_reps',  re.target_reps,
                       'rest_seconds', re.rest_seconds,
                       'position',     re.position,
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
          SELECT id, program_start, split_type, expires_at, routines_a_count, duration_weeks, schedule_map
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

NOTIFY pgrst, 'reload schema';
