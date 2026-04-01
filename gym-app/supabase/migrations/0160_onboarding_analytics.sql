-- Add onboarding step tracking for funnel analytics
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;

-- Backfill: users who already completed onboarding get step 9 (all steps done)
UPDATE profiles SET onboarding_step = 9 WHERE is_onboarded = true AND (onboarding_step IS NULL OR onboarding_step = 0);
