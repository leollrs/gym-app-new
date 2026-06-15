-- ============================================================
-- 0577 — Streak + team-challenge leaderboard tie-breaks
-- ============================================================
-- Extends the first-to-reach tie-break (0570) to the two boards it didn't
-- cover: the individual STREAK leaderboard and the TEAM-challenge leaderboard.
--
--   • Streaks: among members tied on streak length, the one who EXTENDED their
--     streak earlier (streak_cache.updated_at — i.e. trained/checked-in first
--     today to reach the count) ranks higher. profile_id stays as the final
--     stable tiebreak.
--   • Teams: among teams tied on total score, the team whose last member
--     score-change is OLDEST reached the total first → ranks higher. Uses the
--     challenge_participants.score_updated_at column added in 0570.
--
-- Bodies are otherwise verbatim from 0524 (streaks) and 0494 (team).
-- Requires 0570 (score_updated_at) to have been applied first.
-- ============================================================

-- ── get_leaderboard_streaks ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_leaderboard_streaks(
  p_gym_id UUID,
  p_tier   TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF p_gym_id != public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      sc.profile_id AS id,
      p.full_name AS name,
      p.avatar_url AS avatar,
      sc.current_streak_days::int AS score,
      mo.fitness_level AS tier
    FROM streak_cache sc
    JOIN profiles p ON p.id = sc.profile_id
    LEFT JOIN member_onboarding mo ON mo.profile_id = sc.profile_id
    WHERE sc.gym_id = p_gym_id
      AND sc.current_streak_days > 0
      AND p.leaderboard_visible = TRUE
      AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
    -- Tie-break: earlier streak extension (reached the count first) ranks
    -- higher; profile_id keeps it deterministic beyond that.
    ORDER BY score DESC, sc.updated_at ASC, sc.profile_id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard_streaks(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_streaks(UUID, TEXT, INT) TO authenticated;

-- ── get_team_leaderboard ────────────────────────────────────────
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
  ORDER BY team_score DESC, MAX(cp.score_updated_at) ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
