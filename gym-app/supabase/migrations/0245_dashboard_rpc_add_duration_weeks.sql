-- Update get_dashboard_data to include duration_weeks from generated_programs
CREATE OR REPLACE FUNCTION public.get_dashboard_data()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _gym_id UUID;
BEGIN
  SELECT gym_id INTO _gym_id FROM profiles WHERE id = _uid;

  RETURN json_build_object(
    -- Active generated program (not expired)
    'program', (
      SELECT row_to_json(p)
        FROM (
          SELECT id, program_start, split_type, expires_at, routines_a_count, duration_weeks
            FROM generated_programs
           WHERE profile_id = _uid
             AND expires_at > NOW()
           ORDER BY created_at DESC
           LIMIT 1
        ) p
    ),

    -- Gym hours
    'gym_hours', (
      SELECT COALESCE(json_agg(row_to_json(h)), '[]'::json)
        FROM (
          SELECT day_of_week, open_time, close_time, is_closed
            FROM gym_hours
           WHERE gym_id = _gym_id
        ) h
    ),

    -- Streak from streak_cache
    'streak', (
      SELECT row_to_json(s)
        FROM (
          SELECT current_streak_days, longest_streak_days, last_activity_date
            FROM streak_cache
           WHERE profile_id = _uid
        ) s
    ),

    -- Points
    'points', (
      SELECT COALESCE(SUM(points), 0)
        FROM reward_points
       WHERE profile_id = _uid
    )
  );
END;
$$;
