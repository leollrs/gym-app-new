-- RPC for profile preview: returns profile + stats for a same-gym member
-- Uses SECURITY DEFINER to bypass per-row RLS while enforcing gym boundary

CREATE OR REPLACE FUNCTION public.get_profile_preview(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid       UUID;
  my_gym    UUID;
  their_gym UUID;
  result    JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- Get caller's gym
  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  -- Get target's gym
  SELECT gym_id INTO their_gym FROM profiles WHERE id = p_user_id;

  -- Enforce same-gym boundary
  IF my_gym IS NULL OR their_gym IS NULL OR my_gym != their_gym THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'profile', (
      SELECT json_build_object(
        'id',           p.id,
        'username',     p.username,
        'full_name',    p.full_name,
        'avatar_url',   p.avatar_url,
        'avatar_type',  p.avatar_type,
        'avatar_value', p.avatar_value,
        'created_at',   p.created_at,
        'fitness_level', mo.fitness_level,
        'goal',         mo.primary_goal
      )
      FROM profiles p
      LEFT JOIN member_onboarding mo ON mo.profile_id = p.id
      WHERE p.id = p_user_id
    ),
    'workouts', (
      SELECT COUNT(*)::INT FROM workout_sessions WHERE profile_id = p_user_id
    ),
    'prs', (
      SELECT COUNT(*)::INT FROM personal_records WHERE profile_id = p_user_id
    ),
    'streak', (
      SELECT COALESCE(current_streak_days, 0)
      FROM streak_cache WHERE profile_id = p_user_id
    ),
    'latest_achievement', (
      SELECT achievement_key
      FROM user_achievements
      WHERE profile_id = p_user_id OR user_id = p_user_id
      ORDER BY unlocked_at DESC
      LIMIT 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_profile_preview(UUID) TO authenticated;
