-- ============================================================
-- 0132 — Gym Palette Support (White-Label Color Themes)
-- ============================================================

-- Add palette selection and surface color override to gym_branding
ALTER TABLE gym_branding
  ADD COLUMN IF NOT EXISTS palette_name TEXT DEFAULT 'obsidian_amber',
  ADD COLUMN IF NOT EXISTS surface_color TEXT;

-- Add comment for documentation
COMMENT ON COLUMN gym_branding.palette_name IS 'Predefined palette key from palettes.js (e.g., obsidian_amber, electric_night, crimson_power)';
COMMENT ON COLUMN gym_branding.surface_color IS 'Optional hex color override for background surface tinting. If null, auto-derived from primary_color hue.';

-- Update default primary_color for new gyms (Obsidian Amber)
ALTER TABLE gym_branding ALTER COLUMN primary_color SET DEFAULT '#F0A500';
ALTER TABLE gym_branding ALTER COLUMN accent_color SET DEFAULT '#22D3A7';
