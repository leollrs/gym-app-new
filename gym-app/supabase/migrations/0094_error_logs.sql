CREATE TABLE IF NOT EXISTS error_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID REFERENCES gyms(id) ON DELETE SET NULL,
  profile_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,  -- 'react_crash', 'js_error', 'promise_rejection', 'api_error'
  message     TEXT NOT NULL,
  stack       TEXT,
  page        TEXT,
  component   TEXT,
  device_info JSONB,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_error_logs_gym ON error_logs(gym_id, created_at DESC);
CREATE INDEX idx_error_logs_profile ON error_logs(profile_id, created_at DESC);
CREATE INDEX idx_error_logs_type ON error_logs(type, created_at DESC);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_read_errors" ON error_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'));

CREATE POLICY "admin_read_errors" ON error_logs FOR SELECT
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "anyone_insert_errors" ON error_logs FOR INSERT WITH CHECK (true);
