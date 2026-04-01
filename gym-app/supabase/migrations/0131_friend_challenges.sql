-- ============================================================
-- 0131 — Friend Challenges (1v1 Duels from Leaderboard)
-- ============================================================

CREATE TABLE IF NOT EXISTS friend_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  challenged_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL CHECK (metric IN ('volume', 'workouts', 'prs')),
  start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE NOT NULL DEFAULT (CURRENT_DATE + 7),
  challenger_score NUMERIC DEFAULT 0,
  challenged_score NUMERIC DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'completed', 'declined')),
  winner_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookup by participant
CREATE INDEX idx_friend_challenges_challenger ON friend_challenges (challenger_id);
CREATE INDEX idx_friend_challenges_challenged ON friend_challenges (challenged_id);
CREATE INDEX idx_friend_challenges_status     ON friend_challenges (status) WHERE status IN ('pending', 'active');

-- RLS
ALTER TABLE friend_challenges ENABLE ROW LEVEL SECURITY;

-- Participants can view their own challenges
CREATE POLICY "Users can view own friend challenges"
  ON friend_challenges FOR SELECT
  USING (auth.uid() IN (challenger_id, challenged_id));

-- Only the challenger can create a challenge
CREATE POLICY "Users can create friend challenges"
  ON friend_challenges FOR INSERT
  WITH CHECK (auth.uid() = challenger_id);

-- Participants can update their own challenges (accept/decline/score updates)
CREATE POLICY "Participants can update friend challenges"
  ON friend_challenges FOR UPDATE
  USING (auth.uid() IN (challenger_id, challenged_id));

-- Challenger can delete a pending challenge they created
CREATE POLICY "Challenger can delete pending challenges"
  ON friend_challenges FOR DELETE
  USING (auth.uid() = challenger_id AND status = 'pending');
