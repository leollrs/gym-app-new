-- Add avatar_type and avatar_value to social feed RPCs so custom avatars render everywhere

-- Update get_friend_feed to include avatar customization fields
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
  uid    := auth.uid();
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
        'avatar_value', p.avatar_value
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
      )
      AND (p_cursor IS NULL OR afi.created_at < p_cursor)
    ORDER BY afi.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- Update get_friend_streaks to include avatar customization fields
CREATE OR REPLACE FUNCTION public.get_friend_streaks()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid    UUID;
  result JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN '[]'::JSON; END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      p.id,
      p.full_name  AS name,
      p.avatar_url,
      p.avatar_type,
      p.avatar_value,
      sc.current_streak_days AS streak
    FROM friendships f
    JOIN profiles p
      ON p.id = CASE
        WHEN f.requester_id = uid THEN f.addressee_id
        ELSE f.requester_id
      END
    JOIN streak_cache sc ON sc.profile_id = p.id
    WHERE (f.requester_id = uid OR f.addressee_id = uid)
      AND f.status = 'accepted'
      AND sc.current_streak_days > 0
    ORDER BY sc.current_streak_days DESC
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;
