-- =============================================================
-- FIX WALLET PASS UPDATE FLOW
-- Migration: 0087_fix_wallet_pass_updates.sql
--
-- Fixes the race condition where devices query for updated passes
-- before the push function has bumped updated_at. Instead of
-- relying on wallet_pass_registrations.updated_at, we now track
-- pass_data_updated_at on profiles — set BEFORE pushes are sent.
--
-- Also updates the vault secret placeholder reminder.
-- =============================================================

-- ── 1. Add pass_data_updated_at to profiles ─────────────────
--    This column tracks when the member's pass data (punch cards,
--    membership info) last changed. It is bumped BEFORE APNs
--    pushes are sent, so the webhook can reliably answer
--    "what changed since X?"

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pass_data_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill: set to now for all existing profiles
UPDATE profiles SET pass_data_updated_at = NOW() WHERE pass_data_updated_at IS NULL;

-- ── 2. Update notify_wallet_pass_update to bump the timestamp ─
--    This runs inside the purchase transaction, so the timestamp
--    is set before any push is triggered.

CREATE OR REPLACE FUNCTION public.notify_wallet_pass_update(
  p_profile_id UUID,
  p_reason     TEXT DEFAULT 'punch_card_update'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bump pass data timestamp FIRST — before any push is sent.
  -- This ensures the webhook can answer "what changed?" correctly
  -- even if the device queries before push-wallet-update finishes.
  UPDATE profiles
  SET pass_data_updated_at = NOW()
  WHERE id = p_profile_id;

  -- Log the update request
  INSERT INTO wallet_pass_update_log (profile_id, reason)
  VALUES (p_profile_id, p_reason);

  -- pg_notify as fallback
  PERFORM pg_notify('wallet_pass_update', json_build_object(
    'profile_id', p_profile_id,
    'reason', p_reason
  )::text);
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_wallet_pass_update(UUID, TEXT) TO authenticated;

-- ── 3. Remind about vault secrets ──────────────────────────
-- The trigger_wallet_push() function reads from vault.secrets.
-- If you haven't replaced the placeholder, pushes won't fire.
-- Run this in the Supabase SQL editor with your REAL keys:
--
--   UPDATE vault.secrets
--   SET secret = 'eyJhbGciOi...<your real service role key>'
--   WHERE name = 'service_role_key';
--
-- You can verify with:
--   SELECT name, LEFT(decrypted_secret, 20) || '...'
--   FROM vault.decrypted_secrets
--   WHERE name IN ('supabase_url', 'service_role_key');

NOTIFY pgrst, 'reload schema';


