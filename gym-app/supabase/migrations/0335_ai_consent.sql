-- AI third-party consent tracking (Apple App Store guideline 5.1.2)
-- Stores per-feature consent timestamps + version for OpenAI Vision photo analysis
-- Shape: {"body": "2026-04-29T12:00:00Z", "food": "...", "menu": "...", "version": 1}

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_consent JSONB DEFAULT NULL;

COMMENT ON COLUMN profiles.ai_consent IS
  'Per-feature AI third-party processing consent timestamps. Required by Apple 5.1.2 before sharing photos with OpenAI. Shape: {body: ISO8601, food: ISO8601, menu: ISO8601, version: int}';
