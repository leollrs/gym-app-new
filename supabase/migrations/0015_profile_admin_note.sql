-- Add admin_note field to profiles so gym admins can leave
-- internal notes on individual members (e.g. "Reached out on Jan 5, no response")
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_note TEXT;
