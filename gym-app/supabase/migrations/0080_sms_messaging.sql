-- =============================================================
-- SMS / MESSAGING INFRASTRUCTURE
-- Migration: 0080_sms_messaging.sql
--
-- Adds Twilio SMS support: per-gym config, conversations,
-- messages, monthly usage tracking, and platform rate config.
-- =============================================================

-- ── 1. Number bundle flag on gyms ───────────────────────────
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS has_number_bundle BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Phone number on profiles ─────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- ── 3. Twilio config per gym ────────────────────────────────
CREATE TABLE IF NOT EXISTS gym_twilio_config (
    gym_id              UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
    twilio_phone_number TEXT NOT NULL,
    twilio_account_sid  TEXT NOT NULL,
    twilio_auth_token   TEXT NOT NULL,
    is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gym_twilio_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "twilio_config_super_admin" ON gym_twilio_config
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 4. SMS conversations ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_preview TEXT,
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    unread_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(gym_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_sms_conversations_gym
  ON sms_conversations(gym_id, last_message_at DESC);

ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_conversations_admin" ON sms_conversations
  FOR ALL USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );
CREATE POLICY "sms_conversations_super_admin" ON sms_conversations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 5. SMS messages ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE sms_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sms_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'received');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sms_messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES sms_conversations(id) ON DELETE CASCADE,
    gym_id            UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    direction         sms_direction NOT NULL,
    status            sms_status NOT NULL DEFAULT 'queued',
    body              TEXT NOT NULL,
    from_number       TEXT NOT NULL,
    to_number         TEXT NOT NULL,
    twilio_sid        TEXT,
    error_code        TEXT,
    error_message     TEXT,
    sent_by           UUID REFERENCES profiles(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_conversation
  ON sms_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_messages_gym_month
  ON sms_messages(gym_id, created_at DESC);

ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_messages_admin" ON sms_messages
  FOR ALL USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );
CREATE POLICY "sms_messages_super_admin" ON sms_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 6. Monthly SMS usage tracking ───────────────────────────
CREATE TABLE IF NOT EXISTS sms_usage_monthly (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id            UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    month             DATE NOT NULL,
    messages_sent     INTEGER NOT NULL DEFAULT 0,
    messages_received INTEGER NOT NULL DEFAULT 0,
    segments_sent     INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(gym_id, month)
);

ALTER TABLE sms_usage_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_usage_admin" ON sms_usage_monthly
  FOR SELECT USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );
CREATE POLICY "sms_usage_super_admin" ON sms_usage_monthly
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 7. Platform-level SMS rate config ───────────────────────
CREATE TABLE IF NOT EXISTS platform_sms_rates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cost_per_sms_segment    NUMERIC(6,4) NOT NULL DEFAULT 0.0079,
    cost_per_mms            NUMERIC(6,4) NOT NULL DEFAULT 0.0200,
    cost_per_number_monthly NUMERIC(8,2) NOT NULL DEFAULT 1.15,
    markup_percentage       NUMERIC(5,2) NOT NULL DEFAULT 20.00,
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE platform_sms_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_rates_super_admin" ON platform_sms_rates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- Seed default rates
INSERT INTO platform_sms_rates (cost_per_sms_segment, cost_per_mms, cost_per_number_monthly, markup_percentage)
VALUES (0.0079, 0.0200, 1.15, 20.00);

-- ── 8. Increment usage RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_sms_usage(
  p_gym_id UUID,
  p_direction TEXT,
  p_segments INTEGER DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  INSERT INTO sms_usage_monthly (gym_id, month, messages_sent, messages_received, segments_sent)
  VALUES (
    p_gym_id, v_month,
    CASE WHEN p_direction = 'sent' THEN 1 ELSE 0 END,
    CASE WHEN p_direction = 'received' THEN 1 ELSE 0 END,
    CASE WHEN p_direction = 'sent' THEN p_segments ELSE 0 END
  )
  ON CONFLICT (gym_id, month) DO UPDATE SET
    messages_sent = sms_usage_monthly.messages_sent + CASE WHEN p_direction = 'sent' THEN 1 ELSE 0 END,
    messages_received = sms_usage_monthly.messages_received + CASE WHEN p_direction = 'received' THEN 1 ELSE 0 END,
    segments_sent = sms_usage_monthly.segments_sent + CASE WHEN p_direction = 'sent' THEN p_segments ELSE 0 END,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_sms_usage(UUID, TEXT, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
