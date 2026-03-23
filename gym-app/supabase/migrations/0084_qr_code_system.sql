-- =============================================================
-- QR Code System for gym check-in integration
-- Migration: 0084_qr_code_system.sql
--
-- Adds per-gym QR configuration and per-member QR payloads.
-- The member's QR code is displayed in-app (and downloadable
-- to Apple/Google Wallet) for scanning at the gym's existing
-- access system. Our bridge software handles the dual action:
-- gym system validation + check-in recorded in our platform.
-- =============================================================

-- ── Enum for QR payload type ────────────────────────────────
DO $$ BEGIN
  CREATE TYPE qr_payload_type AS ENUM (
    'auto_id',        -- system-generated unique code (default)
    'external_id',    -- gym provides their own member code per user
    'custom_template' -- template string resolved per member
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Enum for QR display format ──────────────────────────────
DO $$ BEGIN
  CREATE TYPE qr_display_format AS ENUM (
    'qr_code',      -- standard QR code (default)
    'barcode_128',   -- Code 128 barcode
    'barcode_39'     -- Code 39 barcode
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Gym-level QR configuration ──────────────────────────────
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS qr_enabled        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qr_payload_type   qr_payload_type DEFAULT 'auto_id',
  ADD COLUMN IF NOT EXISTS qr_display_format qr_display_format DEFAULT 'qr_code',
  ADD COLUMN IF NOT EXISTS qr_payload_template TEXT DEFAULT NULL;
  -- template examples: '{member_id}', 'GYM-{slug}-{member_id}', '{external_id}'

-- ── Per-member QR payload ───────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS qr_code_payload TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS qr_external_id  TEXT DEFAULT NULL;
  -- qr_code_payload: the resolved string encoded in the QR
  -- qr_external_id:  the code from the gym's existing system (e.g. keypad code)

-- Index for external ID lookups (used by bridge software)
CREATE INDEX IF NOT EXISTS idx_profiles_qr_external_id
  ON profiles(gym_id, qr_external_id) WHERE qr_external_id IS NOT NULL;

-- Index for QR payload lookups
CREATE INDEX IF NOT EXISTS idx_profiles_qr_code_payload
  ON profiles(gym_id, qr_code_payload) WHERE qr_code_payload IS NOT NULL;

-- ── Auto-generate QR payload for existing members ───────────
-- For gyms using auto_id, generate a short unique code from the profile id
UPDATE profiles
SET qr_code_payload = UPPER(SUBSTRING(REPLACE(id::TEXT, '-', '') FROM 1 FOR 8))
WHERE qr_code_payload IS NULL;

-- ── Function to auto-generate QR payload on new profile ─────
CREATE OR REPLACE FUNCTION generate_qr_payload()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.qr_code_payload IS NULL THEN
    NEW.qr_code_payload := UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', '') FROM 1 FOR 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_qr_payload ON profiles;
CREATE TRIGGER trg_generate_qr_payload
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_qr_payload();

-- ── RLS: members can read their own QR payload ──────────────
-- (Existing profile RLS policies already cover SELECT on own row)
-- Admin can update qr_external_id via existing admin update policies
