-- ============================================================
-- 0041 — Add monthly_price to gyms for revenue tracking
-- ============================================================

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS monthly_price decimal(10,2) DEFAULT 0;

-- Default pricing by tier (adjust as needed)
UPDATE gyms SET monthly_price = CASE subscription_tier
  WHEN 'free'       THEN 0
  WHEN 'starter'    THEN 49
  WHEN 'pro'        THEN 99
  WHEN 'enterprise' THEN 199
  ELSE 0
END
WHERE monthly_price = 0 OR monthly_price IS NULL;
