-- ============================================================
-- 0172: Recurring Announcements
-- Adds recurrence fields to announcements table.
-- ============================================================

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS recurrence_rule TEXT; -- 'daily', 'weekly', 'biweekly', 'monthly'
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS recurrence_day INT; -- 0-6 for weekly (Sun=0), 1-28 for monthly
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS recurrence_end DATE; -- NULL = no end
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS last_recurrence_at TIMESTAMPTZ;
