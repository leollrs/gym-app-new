-- ============================================================
-- 0478 — QR single-use enforcement (consumed-nonce store)
-- ============================================================
-- Follow-up flagged in the 2026-05-30 edge-function security audit.
--
-- verify-qr validates HMAC-signed payloads of the form
-- `<subject>:<timestamp>` (gym-checkin / gym-purchase / gym-reward)
-- with a 60s expiry window, but had NO single-use enforcement: a
-- captured, still-valid {payload, signature} pair could be re-verified
-- any number of times inside that window → replay → double check-in /
-- double reward scan.
--
-- This table is the server-side consumed-nonce store. On the FIRST
-- successful verify, the edge function atomically INSERTs a hash of the
-- payload; a second attempt hits the PRIMARY KEY unique violation and is
-- rejected as already-used. The hash (not the raw payload) is stored so a
-- DB snapshot leak doesn't expose the signed subjects/timestamps.
--
-- Rows only need to outlive the 60s verify window; we keep a 10-minute
-- TTL for clock-skew slack and prune the rest, so the table stays tiny.
--
-- RLS: service-role only. The edge function uses the service-role client
-- (which bypasses RLS); no client — anon or authenticated — may read or
-- write. We enable RLS with NO policies so every non-service-role path is
-- denied by default.
-- ============================================================

-- ── 1. Consumed-nonce table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_consumed_nonces (
  payload_hash  TEXT PRIMARY KEY,                 -- SHA-256 hex of the QR payload
  consumed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports the TTL sweep below (range scan on consumed_at).
CREATE INDEX IF NOT EXISTS idx_qr_consumed_nonces_consumed_at
  ON qr_consumed_nonces (consumed_at);

-- ── 2. RLS — service-role only ───────────────────────────────
-- Enable RLS with zero policies. The service-role key bypasses RLS, so the
-- verify-qr edge function can still INSERT; anon and authenticated callers
-- are denied all access (no SELECT/INSERT/UPDATE/DELETE).
ALTER TABLE qr_consumed_nonces ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: strip the default table grants Supabase hands to
-- anon/authenticated. RLS already blocks them, but removing the grant
-- means the REST API won't even expose the relation.
REVOKE ALL ON TABLE qr_consumed_nonces FROM anon, authenticated;
GRANT  ALL ON TABLE qr_consumed_nonces TO service_role;

-- ── 3. TTL cleanup function ──────────────────────────────────
-- Deletes consumed nonces older than 10 minutes. Anything that old is far
-- past the 60s verify window, so its row can no longer block a (by-now
-- long-expired) replay. SECURITY DEFINER so the cron job can prune
-- regardless of the invoking role.
CREATE OR REPLACE FUNCTION prune_qr_consumed_nonces()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM qr_consumed_nonces
  WHERE consumed_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION prune_qr_consumed_nonces() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION prune_qr_consumed_nonces() TO service_role;

-- ── 4. Schedule the sweep (every 10 minutes) ─────────────────
-- Guarded like 0356: no-op if pg_cron isn't installed, and leave any
-- existing job untouched so re-running this migration is safe. If pg_cron
-- is unavailable the table still works correctly — it just grows slowly
-- (each row is one short string); a manual `SELECT prune_qr_consumed_nonces();`
-- or the inline WHERE consumed_at < now()-interval '10 min' sweep covers it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[0478] pg_cron not installed — qr-nonce sweep not scheduled (table still enforces single-use).';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-qr-consumed-nonces') THEN
    RAISE NOTICE '[0478] prune-qr-consumed-nonces already scheduled — leaving it untouched (safe no-op).';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'prune-qr-consumed-nonces',
    '*/10 * * * *',
    $cron$ SELECT prune_qr_consumed_nonces(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
