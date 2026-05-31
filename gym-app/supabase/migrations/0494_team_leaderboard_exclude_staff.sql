-- 0494_team_leaderboard_exclude_staff.sql
--
-- Staff-invisibility sweep: keep STAFF out of the team-challenge leaderboard
-- shown to members. Reproduces the live 0265 get_team_leaderboard body VERBATIM
-- and adds a single staff filter on the participant join, so a trainer who
-- joins a team challenge doesn't count toward team score / member count / the
-- member list members see.
--
-- (The individual leaderboards + the TV are already handled by 0493, which
-- forces leaderboard_visible=false for staff — every per-person leaderboard
-- filters that flag. Team leaderboards don't, so they need this explicit fix.)
--
-- Requires profiles.is_staff from 0493. ⚠️ Apply via Supabase Dashboard SQL
-- Editor, AFTER 0493.

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
  -- Verify caller is in the same gym as the challenge
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
    -- Staff (trainer/admin) never count toward a team members compete on.
    AND (cp.id IS NULL OR NOT p.is_staff)
  GROUP BY ct.id, ct.name, ct.captain_id
  ORDER BY team_score DESC;
END;
$$;

NOTIFY pgrst, 'reload schema';
