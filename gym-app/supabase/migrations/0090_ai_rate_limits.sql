-- Rate limiting for AI analysis endpoints (body + food photo)
-- Tracks per-user request counts with a sliding window

CREATE TABLE IF NOT EXISTS ai_rate_limits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,  -- 'analyze-body-photo' | 'analyze-food-photo'
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_rate_limits_lookup
  ON ai_rate_limits (profile_id, endpoint, requested_at DESC);

-- Auto-cleanup: delete records older than 24 hours (keeps table small)
-- Run via pg_cron or manual periodic cleanup
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
  DELETE FROM ai_rate_limits WHERE requested_at < now() - interval '24 hours';
$$ LANGUAGE sql;

-- RLS: users can only see/insert their own rate limit records
ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own rate limits"
  ON ai_rate_limits FOR ALL
  USING (profile_id = auth.uid());
