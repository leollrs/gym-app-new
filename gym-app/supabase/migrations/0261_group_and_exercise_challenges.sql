-- Group & Exercise Challenges: team challenges, specific lift, club/milestone
-- Leverages existing challenge_type enum (team, specific_lift already present),
-- challenge_teams table, and challenge_participants.team_id FK.

-- ── 1. Add 'milestone' to challenge_type enum ────────────────────────────────
ALTER TYPE challenge_type ADD VALUE IF NOT EXISTS 'milestone';

-- ── 2. Add new columns to challenges ─────────────────────────────────────────
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS team_size        INT,               -- admin-set per challenge (2=duo, 3=trio, etc.)
  ADD COLUMN IF NOT EXISTS milestone_target NUMERIC(14,2),     -- club threshold (e.g. 500, 1000). NULL = pure competitive
  ADD COLUMN IF NOT EXISTS scoring_metric   TEXT,              -- 'volume','1rm','consistency','pr_count','combined_1rm'
  ADD COLUMN IF NOT EXISTS exercise_ids     TEXT[];            -- for milestone: multiple exercises (squat+bench+deadlift)

-- ── 3. challenge_team_invites: friend-based team formation ───────────────────
CREATE TABLE IF NOT EXISTS challenge_team_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES challenge_teams(id) ON DELETE CASCADE,
  inviter_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invitee_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, invitee_id)
);

CREATE INDEX idx_team_invites_invitee ON challenge_team_invites(invitee_id, status);
CREATE INDEX idx_team_invites_team    ON challenge_team_invites(team_id);

ALTER TABLE challenge_team_invites ENABLE ROW LEVEL SECURITY;

-- Inviter can insert invites for teams they belong to
CREATE POLICY "team_invites_insert" ON challenge_team_invites
  FOR INSERT WITH CHECK (
    inviter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM challenge_participants cp
      WHERE cp.team_id = challenge_team_invites.team_id
        AND cp.profile_id = auth.uid()
    )
  );

-- Both inviter and invitee can see the invite
CREATE POLICY "team_invites_select" ON challenge_team_invites
  FOR SELECT USING (
    inviter_id = auth.uid() OR invitee_id = auth.uid()
  );

-- Only invitee can accept/decline
CREATE POLICY "team_invites_update" ON challenge_team_invites
  FOR UPDATE USING (invitee_id = auth.uid())
  WITH CHECK (invitee_id = auth.uid());

-- ── 4. RLS for challenge_teams (currently only SELECT exists) ────────────────

-- Members can create teams for challenges in their gym
CREATE POLICY "challenge_teams_insert" ON challenge_teams
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_id
        AND c.gym_id = public.current_gym_id()
        AND c.type = 'team'
    )
  );

-- Team members can update their team name
CREATE POLICY "challenge_teams_update" ON challenge_teams
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM challenge_participants cp
      WHERE cp.team_id = id
        AND cp.profile_id = auth.uid()
    )
  );

-- ── 5. Index for team-based participant lookups ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_challenge_participants_team
  ON challenge_participants(team_id) WHERE team_id IS NOT NULL;

-- ── 6. Add captain_id to challenge_teams ─────────────────────────────────────
ALTER TABLE challenge_teams
  ADD COLUMN IF NOT EXISTS captain_id UUID REFERENCES profiles(id);

-- ── 7. get_team_leaderboard RPC ──────────────────────────────────────────────
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
          'display_name', pl.display_name,
          'avatar_url', pl.avatar_url,
          'score', cp.score
        )
        ORDER BY cp.score DESC
      ) FILTER (WHERE cp.id IS NOT NULL),
      '[]'::jsonb
    )                                              AS members
  FROM challenge_teams ct
  LEFT JOIN challenge_participants cp ON cp.team_id = ct.id
  LEFT JOIN profile_lookup pl ON pl.id = cp.profile_id
  WHERE ct.challenge_id = p_challenge_id
  GROUP BY ct.id, ct.name, ct.captain_id
  ORDER BY team_score DESC;
END;
$$;

-- ── 8. Update increment_challenge_score delta cap ────────────────────────────
-- Volume scoring on heavy lifts can easily exceed 1000 (e.g. 5x5x315 = 7875)
-- Also milestone scoring sets absolute totals as delta.
-- Must DROP first: 0218 named param p_challenge_id, we rename to p_participant_id
-- to match the frontend call. The old function used challenge_id + auth.uid();
-- we use participant row id + auth.uid() which is what the frontend passes.
DROP FUNCTION IF EXISTS public.increment_challenge_score(UUID, NUMERIC);
CREATE OR REPLACE FUNCTION public.increment_challenge_score(
  p_participant_id UUID,
  p_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_delta <= 0 THEN
    RAISE EXCEPTION 'p_delta must be greater than 0';
  END IF;

  IF p_delta > 100000 THEN
    RAISE EXCEPTION 'p_delta exceeds maximum allowed value';
  END IF;

  -- Rate limit: max 20 calls per minute (best-effort)
  BEGIN
    PERFORM public.check_rate_limit('increment_challenge_score', 20, 1);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  UPDATE challenge_participants
  SET score = COALESCE(score, 0) + p_delta
  WHERE id = p_participant_id
    AND profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a participant in this challenge';
  END IF;
END;
$$;

-- ── 9. set_challenge_score RPC (for milestone: sets absolute score) ──────────
CREATE OR REPLACE FUNCTION public.set_challenge_score(
  p_participant_id UUID,
  p_score NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_score < 0 THEN
    RAISE EXCEPTION 'Score cannot be negative';
  END IF;

  IF p_score > 10000 THEN
    RAISE EXCEPTION 'Score exceeds maximum allowed value';
  END IF;

  UPDATE challenge_participants
  SET score = p_score
  WHERE id = p_participant_id
    AND profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a participant in this challenge';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
