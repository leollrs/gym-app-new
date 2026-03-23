-- Add preferred_language to profiles for i18n support (en / es)
-- Re-issued as 0058 because 0045_add_preferred_language.sql was never
-- applied due to a duplicate 0045_ prefix collision.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) NOT NULL DEFAULT 'en';

COMMENT ON COLUMN profiles.preferred_language IS 'ISO 639-1 language code (en, es)';
