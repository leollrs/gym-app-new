-- Streak freezes — database-backed instead of localStorage
CREATE TABLE IF NOT EXISTS streak_freezes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- format: '2026-03'
  used_count INTEGER DEFAULT 0,
  max_allowed INTEGER DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profile_id, month)
);

-- Gym closure calendar — admin-managed
CREATE TABLE IF NOT EXISTS gym_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  closure_date DATE NOT NULL,
  reason TEXT, -- 'holiday', 'maintenance', 'special_event', etc.
  name TEXT, -- e.g., "Christmas Day", "Maintenance"
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gym_id, closure_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_streak_freezes_profile_month ON streak_freezes(profile_id, month);
CREATE INDEX IF NOT EXISTS idx_gym_closures_gym_date ON gym_closures(gym_id, closure_date);

-- RLS
ALTER TABLE streak_freezes ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own freezes" ON streak_freezes FOR ALL USING (auth.uid() = profile_id);
CREATE POLICY "Users can read gym closures" ON gym_closures FOR SELECT USING (true);
CREATE POLICY "Admins can manage closures" ON gym_closures FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND gym_id = gym_closures.gym_id AND role IN ('admin', 'super_admin'))
);
