-- Weekly admin digest settings
ALTER TABLE churn_followup_settings ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN DEFAULT false;
ALTER TABLE churn_followup_settings ADD COLUMN IF NOT EXISTS digest_day INTEGER DEFAULT 1; -- 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

-- A/B testing variant B for drip campaign steps
ALTER TABLE drip_campaign_steps ADD COLUMN IF NOT EXISTS message_b TEXT; -- variant B message (NULL = no A/B test)

-- Track which variant was sent in win-back attempts
ALTER TABLE win_back_attempts ADD COLUMN IF NOT EXISTS variant CHAR(1); -- 'A' or 'B', NULL for non-A/B attempts
