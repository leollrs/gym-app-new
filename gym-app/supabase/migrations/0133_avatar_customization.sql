-- Avatar customization: let members choose a color, gradient design, or uploaded photo
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_type TEXT DEFAULT 'color' CHECK (avatar_type IN ('photo', 'color', 'design')),
  ADD COLUMN IF NOT EXISTS avatar_value TEXT DEFAULT '#6366F1';
-- avatar_value stores: hex color for 'color' type, design key for 'design' type, or NULL for 'photo' (uses avatar_url)
