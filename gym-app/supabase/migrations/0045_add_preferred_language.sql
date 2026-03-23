-- Add preferred language column for i18n support (English + Spanish)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) NOT NULL DEFAULT 'en';

COMMENT ON COLUMN profiles.preferred_language IS 'ISO 639-1 language code (en, es)';
