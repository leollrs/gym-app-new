-- Add missing notification_type enum values used across the codebase
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'admin_message';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'win_back';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'milestone';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'system';

NOTIFY pgrst, 'reload schema';
