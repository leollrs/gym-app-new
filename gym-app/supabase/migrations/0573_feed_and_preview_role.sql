-- ============================================================
-- 0573 — Expose actor/profile `role` in the social RPCs so member-facing
--         surfaces can badge trainers/admins next to their name.
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor.
--
-- Messages.jsx already badges trainers/admins next to their name (it has the
-- role from a direct profiles read). The social feed and the profile-preview
-- card did NOT, because their backing RPCs never returned `role`. This adds a
-- single `'role', p.role` field to each RPC's returned profile JSON. Everything
-- else (security, privacy, pagination, joins, block filter) is byte-identical to
-- the latest definitions:
--   • get_friend_feed      — copied verbatim from 0527 (the trainer-of-record arm)
--   • get_profile_preview  — copied verbatim from 0562 (the friends arm)
-- ============================================================

-- ── get_friend_feed: + 'role' in the actor profiles json ──────────────────
-- Exact copy of the 0527 definition (which itself copied 0338 + the trainer
-- arm). ONLY change: one new line in the json_build_object for `profiles`.
CREATE OR REPLACE FUNCTION public.get_friend_feed(
  p_limit  INT         DEFAULT 30,
  p_cursor TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid    UUID;
  my_gym UUID;
  result JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN '[]'::JSON; END IF;

  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;
  IF my_gym IS NULL THEN RETURN '[]'::JSON; END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      afi.id,
      afi.gym_id,
      afi.actor_id,
      afi.type,
      afi.data,
      afi.is_public,
      afi.created_at,
      json_build_object(
        'full_name',    p.full_name,
        'username',     p.username,
        'avatar_url',   p.avatar_url,
        'avatar_type',  p.avatar_type,
        'avatar_value', p.avatar_value,
        'role',         p.role
      ) AS profiles
    FROM activity_feed_items afi
    JOIN profiles p ON p.id = afi.actor_id
    LEFT JOIN friendships f
      ON (
        (f.requester_id = uid AND f.addressee_id = afi.actor_id)
        OR
        (f.addressee_id = uid AND f.requester_id = afi.actor_id)
      )
      AND f.status = 'accepted'
    WHERE afi.gym_id = my_gym
      AND (
        afi.actor_id = uid
        OR f.id IS NOT NULL
        -- Trainer-of-record sees ACTIVE clients' activity (is_trainer_of
        -- checks the live trainer_clients link for auth.uid()).
        OR public.is_trainer_of(afi.actor_id)
      )
      AND (p_cursor IS NULL OR afi.created_at < p_cursor)
      -- BLOCK FILTER: hide items from anyone the caller blocked
      -- AND from anyone who blocked the caller.
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE (b.blocker_id = uid          AND b.blocked_id = afi.actor_id)
           OR (b.blocker_id = afi.actor_id AND b.blocked_id = uid)
      )
    ORDER BY afi.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- ── get_profile_preview: + 'role' in the profile json ─────────────────────
-- Exact copy of the 0562 definition (which itself copied 0225 + the friends
-- arm). ONLY change: one new line in the inner json_build_object for `profile`.
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
        'goal',         mo.primary_goal,
        'role',         p.role
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

NOTIFY pgrst, 'reload schema';
