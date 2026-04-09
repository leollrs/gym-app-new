-- Add missing followup columns to churn_risk_scores
-- These were in 0001_initial_schema but the table was recreated in 0030
-- without them. The admin panel queries these columns.

ALTER TABLE churn_risk_scores
  ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS followup_outcome TEXT;

NOTIFY pgrst, 'reload schema';
