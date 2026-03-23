-- ============================================================
-- 0043 — Proper pricing model for gyms
-- ============================================================

-- Add founding flag and plan type
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS is_founding boolean DEFAULT false;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS plan_type text DEFAULT 'starter';
-- plan_type: 'starter', 'pro', 'lifetime'
-- monthly_price stays as manual override for custom quotes

-- Drop the old simple tier column default
-- subscription_tier is kept for backwards compat but plan_type is the source of truth
