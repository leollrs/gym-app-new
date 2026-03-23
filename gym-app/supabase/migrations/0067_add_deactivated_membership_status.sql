-- Add 'deactivated' to membership_status enum
-- Used when a super admin deactivates an individual member account
ALTER TYPE membership_status ADD VALUE IF NOT EXISTS 'deactivated';
