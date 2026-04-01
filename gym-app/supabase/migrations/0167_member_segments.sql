CREATE TABLE IF NOT EXISTS member_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    filters JSONB NOT NULL DEFAULT '{}',
    color TEXT DEFAULT '#D4AF37',
    icon TEXT DEFAULT 'users',
    is_pinned BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_segments_gym ON member_segments(gym_id);
ALTER TABLE member_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "segments_admin" ON member_segments FOR ALL
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));
