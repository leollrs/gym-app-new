-- =============================================================
-- Remove Twilio / SMS infrastructure
-- Migration: 0231_remove_twilio_sms.sql
--
-- The app now uses push notifications and email for all member
-- communication. Twilio SMS is no longer needed. This migration
-- drops all SMS-related tables, policies, functions, types,
-- and the has_number_bundle column from gyms.
-- =============================================================

-- ── 1. Drop RLS policies ────────────────────────────────────

DROP POLICY IF EXISTS "sms_messages_admin"        ON sms_messages;
DROP POLICY IF EXISTS "sms_messages_super_admin"   ON sms_messages;
DROP POLICY IF EXISTS "sms_conversations_admin"    ON sms_conversations;
DROP POLICY IF EXISTS "sms_conversations_super_admin" ON sms_conversations;
DROP POLICY IF EXISTS "twilio_config_super_admin"  ON gym_twilio_config;
DROP POLICY IF EXISTS "super_admin_manage_twilio"  ON gym_twilio_config;
DROP POLICY IF EXISTS "sms_usage_admin"            ON sms_usage_monthly;
DROP POLICY IF EXISTS "sms_usage_super_admin"      ON sms_usage_monthly;
DROP POLICY IF EXISTS "sms_rates_super_admin"      ON platform_sms_rates;

-- ── 2. Drop functions ───────────────────────────────────────

DROP FUNCTION IF EXISTS public.increment_sms_usage(UUID, TEXT, INTEGER);

-- ── 3. Drop tables (order matters for foreign keys) ─────────

DROP TABLE IF EXISTS sms_messages       CASCADE;
DROP TABLE IF EXISTS sms_conversations  CASCADE;
DROP TABLE IF EXISTS sms_usage_monthly  CASCADE;
DROP TABLE IF EXISTS platform_sms_rates CASCADE;
DROP TABLE IF EXISTS gym_twilio_config  CASCADE;

-- ── 4. Drop custom enum types ───────────────────────────────

DROP TYPE IF EXISTS sms_direction;
DROP TYPE IF EXISTS sms_status;

-- ── 5. Remove SMS-related columns from other tables ─────────

ALTER TABLE gyms     DROP COLUMN IF EXISTS has_number_bundle;
ALTER TABLE profiles DROP COLUMN IF EXISTS phone_number;

NOTIFY pgrst, 'reload schema';
