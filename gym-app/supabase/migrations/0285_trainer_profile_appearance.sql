-- Add accent_color and trainer_icon columns to profiles for trainer appearance customization
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS accent_color TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trainer_icon TEXT;

COMMENT ON COLUMN profiles.accent_color IS 'Trainer accent color hex for avatar background when no photo is set';
COMMENT ON COLUMN profiles.trainer_icon IS 'Trainer icon identifier (e.g. dumbbell, running, yoga)';
