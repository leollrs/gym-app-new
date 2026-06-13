-- ============================================================
-- 0562 — get_profile_preview: let accepted friends view each other
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor.
--
-- profiles.privacy_public defaults to FALSE (private), and get_profile_preview
-- (migration 0225) only exempted self / admin / trainer from the privacy gate
-- — NOT friends. So tapping a friend's avatar in the feed or the friend-streaks
-- row returned NULL and the preview card rendered empty ("Member", 0 workouts /
-- 0 streak / 0 PRs). Friends should obviously be able to see each other's basic
-- stats — the feed already shows friends' workout posts.
--
-- This adds an "accepted friendship (either direction)" branch to the gate.
-- Everything else is byte-identical to the 0225 definition.

CREATE OR REPLACE FUNCTION public.get_profile_preview(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          UUID;
  my_gym       UUID;
  their_gym    UUID;
  their_role   TEXT;
  is_private   BOOLEAN;
  caller_role  TEXT;
  result       JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- Own profile — always allowed
  IF uid = p_user_id THEN
    NULL;
  ELSE
    -- Get caller's gym and role
    SELECT pl.gym_id, pl.role::TEXT INTO my_gym, caller_role
      FROM profile_lookup pl WHERE pl.id = uid;

    -- Get target's gym and privacy flag
    SELECT p.gym_id, p.privacy_public INTO their_gym, is_private
      FROM profiles p WHERE p.id = p_user_id;

    -- privacy_public = FALSE means the profile is private (confusing name).

    -- Enforce same-gym boundary
    IF my_gym IS NULL OR their_gym IS NULL OR my_gym != their_gym THEN
      RETURN NULL;
    END IF;

    -- Privacy check: if target is private, only admins / trainers / accepted
    -- friends may view.
    IF is_private = FALSE THEN
      -- Caller is admin or super_admin — allowed
      IF caller_role IN ('admin', 'super_admin') THEN
        NULL;
      -- Caller is a trainer of this user — allowed
      ELSIF EXISTS (
        SELECT 1 FROM trainer_clients
        WHERE trainer_id = uid AND client_id = p_user_id AND is_active = TRUE
      ) THEN
        NULL;
      -- Caller is an accepted friend (either direction) — allowed
      ELSIF EXISTS (
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = uid AND addressee_id = p_user_id)
            OR (requester_id = p_user_id AND addressee_id = uid))
      ) THEN
        NULL;
      ELSE
        -- Regular member viewing a private, non-friend profile — blocked
        RETURN NULL;
      END IF;
    END IF;
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
