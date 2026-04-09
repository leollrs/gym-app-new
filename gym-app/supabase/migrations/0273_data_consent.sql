-- Track that users have accepted the data collection disclosure
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS data_consent_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS data_consent_version TEXT DEFAULT NULL;

COMMENT ON COLUMN profiles.data_consent_at IS 'Timestamp when user accepted the data collection disclosure';
COMMENT ON COLUMN profiles.data_consent_version IS 'Version of the disclosure the user accepted';
