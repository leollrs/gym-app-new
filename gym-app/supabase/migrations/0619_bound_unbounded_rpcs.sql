-- ============================================================
-- 0619 — bound the unbounded set-returning RPCs
-- ============================================================
-- get_friend_streaks + get_team_leaderboard returned every row with no LIMIT,
-- so their result silently clamps at the ~1000 PostgREST cap on a member with a
-- huge friend list / a challenge with a huge number of teams. Both feed ranked,
-- top-of-list UI (a friend-streak avatar rail, a team leaderboard), so a LIMIT
-- well above any realistic count — but under the cap — bounds them without
-- dropping anything a user would actually see. Bodies reproduced verbatim from
-- 0338 / 0577 with only the trailing LIMIT added.
--
-- (platform_feature_adoption is NOT changed — it GROUPs BY gym_id, i.e. one row
-- per gym, so it only clamps past ~1000 GYMS, far beyond the near-term fleet.)
-- ============================================================

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
      -- BLOCK FILTER: hide blocked friends from streaks rail.
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE (b.blocker_id = uid  AND b.blocked_id = p.id)
           OR (b.blocker_id = p.id AND b.blocked_id = uid)
      )
    ORDER BY sc.current_streak_days DESC
    LIMIT 200
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_leaderboard(p_challenge_id UUID)
RETURNS TABLE (
  team_id      UUID,
  team_name    TEXT,
  captain_id   UUID,
  team_score   NUMERIC,
  member_count BIGINT,
  members      JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM challenges c
    WHERE c.id = p_challenge_id
      AND c.gym_id = current_gym_id()
  ) THEN
    RAISE EXCEPTION 'Challenge not found in your gym';
  END IF;

  RETURN QUERY
  SELECT
    ct.id                                          AS team_id,
    ct.name                                        AS team_name,
    ct.captain_id                                  AS captain_id,
    COALESCE(SUM(cp.score), 0)                     AS team_score,
    COUNT(cp.id)                                   AS member_count,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'profile_id', cp.profile_id,
          'display_name', p.full_name,
          'avatar_url', p.avatar_url,
          'score', cp.score
        )
        ORDER BY cp.score DESC
      ) FILTER (WHERE cp.id IS NOT NULL),
      '[]'::jsonb
    )                                              AS members
  FROM challenge_teams ct
  LEFT JOIN challenge_participants cp ON cp.team_id = ct.id
  LEFT JOIN profiles p ON p.id = cp.profile_id
  WHERE ct.challenge_id = p_challenge_id
    AND (cp.id IS NULL OR NOT p.is_staff)
  GROUP BY ct.id, ct.name, ct.captain_id
  -- Tie-break: the team whose last member score-change is oldest reached the
  -- total first → ranks higher (empty teams sort last via NULLS LAST).
  ORDER BY team_score DESC, MAX(cp.score_updated_at) ASC NULLS LAST
  LIMIT 200;
END;
$$;

NOTIFY pgrst, 'reload schema';
