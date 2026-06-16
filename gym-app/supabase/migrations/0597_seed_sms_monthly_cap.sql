-- =============================================================
-- 0597_seed_sms_monthly_cap.sql
--
-- Single-source the per-gym MONTHLY SMS cap from platform_config.
--
-- Background: the original SMS infra (0257) hard-capped 200 SMS/month
-- per gym, enforced via the SMS_MONTHLY_CAP env var in the send-sms /
-- send-invite edge functions (default '200'). SmsUsageCard reads the
-- platform_config key 'sms_monthly_cap' to DISPLAY the limit — but that
-- key was NEVER seeded, so the card always fell back to its 200 default
-- and the edge functions always fell back to their 200 env default. The
-- enforced and displayed caps were two independent constants.
--
-- This seeds 'sms_monthly_cap' = 500 so both the UI (SmsUsageCard) and
-- the edge functions read the same value. Format matches the existing
-- feature-flag rows (0277/0551): the JSONB value is a stringified
-- literal ('"500"'), which `value #>> '{}'` extracts as the bare text
-- "500" and SmsUsageCard's quote-strip + parseInt also resolves to 500.
--
-- Idempotent: ON CONFLICT updates the value so re-applying / future cap
-- bumps converge. Apply manually (supabase db push or SQL editor).
-- =============================================================

INSERT INTO platform_config (key, value)
VALUES ('sms_monthly_cap', '"500"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

NOTIFY pgrst, 'reload schema';
