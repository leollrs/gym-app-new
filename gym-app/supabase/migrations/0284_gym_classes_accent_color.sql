-- =============================================================
-- Add accent_color column to gym_classes
-- Used for visual branding of each class in the admin dashboard
-- =============================================================

ALTER TABLE gym_classes
  ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#D4AF37';

COMMENT ON COLUMN gym_classes.accent_color IS
  'Hex color used for class card accents and schedule indicators in admin UI';
