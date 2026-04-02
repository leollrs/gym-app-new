-- ============================================================
-- 0187 — Centralized gym rewards catalog + referral milestones
-- ============================================================

-- ── gym_rewards: configurable reward catalog per gym ────────
CREATE TABLE gym_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_es TEXT,
  description TEXT,
  description_es TEXT,
  cost_points INT NOT NULL DEFAULT 0,
  reward_type TEXT NOT NULL DEFAULT 'custom' CHECK (reward_type IN (
    'smoothie', 'guest_pass', 'merch', 'pt_session', 'free_month',
    'class_pass', 'discount', 'bring_friend', 'custom'
  )),
  emoji_icon TEXT DEFAULT '🎁',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gym_rewards_gym ON gym_rewards(gym_id);
CREATE INDEX idx_gym_rewards_active ON gym_rewards(gym_id, is_active) WHERE is_active = true;

-- RLS
ALTER TABLE gym_rewards ENABLE ROW LEVEL SECURITY;

-- Admins: full CRUD on own gym
CREATE POLICY gym_rewards_admin_all ON gym_rewards
  FOR ALL
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Members: SELECT active rewards for own gym
CREATE POLICY gym_rewards_member_select ON gym_rewards
  FOR SELECT
  USING (
    is_active = true
    AND gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_gym_rewards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gym_rewards_updated_at
  BEFORE UPDATE ON gym_rewards
  FOR EACH ROW
  EXECUTE FUNCTION update_gym_rewards_updated_at();


-- ── referral_milestones: referral count → reward mapping ────
CREATE TABLE referral_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  referral_count INT NOT NULL,
  reward_id UUID NOT NULL REFERENCES gym_rewards(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(gym_id, referral_count)
);

CREATE INDEX idx_referral_milestones_gym ON referral_milestones(gym_id);

-- RLS
ALTER TABLE referral_milestones ENABLE ROW LEVEL SECURITY;

-- Admins: full CRUD on own gym
CREATE POLICY referral_milestones_admin_all ON referral_milestones
  FOR ALL
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Members: SELECT active milestones for own gym
CREATE POLICY referral_milestones_member_select ON referral_milestones
  FOR SELECT
  USING (
    is_active = true
    AND gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
    )
  );
