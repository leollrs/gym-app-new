-- Add variant tracking to win_back_attempts
ALTER TABLE win_back_attempts
  ADD COLUMN IF NOT EXISTS variant TEXT DEFAULT 'control',
  ADD COLUMN IF NOT EXISTS message_template TEXT,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- Win-back campaign templates for A/B testing
CREATE TABLE IF NOT EXISTS winback_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    variant_a JSONB NOT NULL DEFAULT '{}',
    variant_b JSONB NOT NULL DEFAULT '{}',
    target_tier TEXT DEFAULT 'high',
    started_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_winback_campaigns_gym ON winback_campaigns(gym_id) WHERE is_active;

ALTER TABLE winback_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "winback_campaigns_admin" ON winback_campaigns FOR ALL
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));
