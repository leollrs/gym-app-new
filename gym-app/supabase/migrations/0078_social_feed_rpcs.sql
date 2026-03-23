-- ============================================================
-- Social Feed RPCs — replace .in() queries with join-based lookups
-- ============================================================

-- RPC 1: get_friend_feed
-- Returns paginated feed items from friends + self, with profile data.
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
        'full_name',  p.full_name,
        'username',   p.username,
        'avatar_url', p.avatar_url
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
        afi.actor_id = uid          -- own items always included
        OR f.id IS NOT NULL         -- friend items via join
      )
      AND (p_cursor IS NULL OR afi.created_at < p_cursor)
    ORDER BY afi.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- RPC 2: get_feed_enrichment
-- Returns reaction counts, caller's reaction, and comment counts for a list of feed item IDs.
CREATE OR REPLACE FUNCTION public.get_feed_enrichment(p_item_ids UUID[])
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

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      item_id                AS feed_item_id,
      reaction_counts,
      my_reaction,
      comment_count
    FROM unnest(p_item_ids) AS item_id
    LEFT JOIN LATERAL (
      SELECT json_object_agg(reaction_type, cnt) AS reaction_counts
      FROM (
        SELECT reaction_type, COUNT(*)::INT AS cnt
        FROM feed_reactions
        WHERE feed_item_id = item_id
        GROUP BY reaction_type
      ) rc
    ) rc_agg ON true
    LEFT JOIN LATERAL (
      SELECT reaction_type AS my_reaction
      FROM feed_reactions
      WHERE feed_item_id = item_id
        AND profile_id = uid
      LIMIT 1
    ) my_r ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INT AS comment_count
      FROM feed_comments
      WHERE feed_item_id = item_id
        AND is_deleted = false
    ) cc ON true
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- RPC 3: get_friend_streaks
-- Returns current streak for each friend who has streak > 0.
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

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_friend_feed(INT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_feed_enrichment(UUID[])       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_friend_streaks()              TO authenticated;
