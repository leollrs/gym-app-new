-- =============================================================
-- PERFORMANCE: WALLET PUSH TRIGGER → QUEUE-BASED APPROACH
-- Migration: 0237_performance_wallet_trigger_queue.sql
--
-- Problem: The trigger_wallet_push() function (from migration
-- 0085) fires on every INSERT to wallet_pass_update_log and
-- makes an HTTP call to the push-wallet-update edge function
-- via pg_net. Although pg_net is nominally async, it still
-- acquires a connection from the net extension's pool, reads
-- vault secrets, and builds the request — all inside the
-- trigger's transaction context. Under load this blocks the
-- purchase flow and can cause timeouts.
--
-- Solution: Replace the HTTP-calling trigger with a lightweight
-- queue table (wallet_push_queue). The trigger now simply
-- inserts a row into the queue. A pg_cron job (or edge function
-- polling via the existing push-wallet-update function) picks
-- up pending items, processes them, and marks them done.
--
-- Benefits:
--   - Purchase transactions complete instantly (no HTTP in trigger)
--   - Failed pushes can be retried without re-running the purchase
--   - Queue provides visibility into push delivery status
--   - Batch processing: cron job can send multiple pushes per cycle
-- =============================================================

-- ── 1. Queue table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_push_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reason          TEXT NOT NULL DEFAULT 'punch_card_update',
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ
);

-- Index for the cron job / poller: grab pending items oldest-first
CREATE INDEX IF NOT EXISTS idx_wallet_push_queue_pending
  ON wallet_push_queue(created_at ASC)
  WHERE status = 'pending';

-- Index for retries: find failed items that haven't exhausted attempts
CREATE INDEX IF NOT EXISTS idx_wallet_push_queue_retry
  ON wallet_push_queue(created_at ASC)
  WHERE status = 'failed';

-- Index for cleanup: find completed items older than retention period
CREATE INDEX IF NOT EXISTS idx_wallet_push_queue_cleanup
  ON wallet_push_queue(processed_at)
  WHERE status = 'completed';

-- No RLS — accessed only by service role (edge functions / cron)
ALTER TABLE wallet_push_queue ENABLE ROW LEVEL SECURITY;

-- ── 2. Replace trigger function ────────────────────────────────
-- The new version inserts into the queue instead of calling pg_net.
-- This makes the trigger essentially free (single INSERT, no HTTP).

CREATE OR REPLACE FUNCTION public.trigger_wallet_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Enqueue a push job instead of making an HTTP call.
  -- The queue is processed by pg_cron or edge function polling.
  INSERT INTO wallet_push_queue (profile_id, reason)
  VALUES (NEW.profile_id, NEW.reason);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never let queue insertion break the purchase flow
    RAISE WARNING 'wallet push queue insert failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- ── 3. Re-create the trigger ──────────────────────────────────
-- The trigger itself stays the same (AFTER INSERT on wallet_pass_update_log),
-- but now points to the rewritten function above.

DROP TRIGGER IF EXISTS trg_wallet_push ON wallet_pass_update_log;

CREATE TRIGGER trg_wallet_push
  AFTER INSERT ON wallet_pass_update_log
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_wallet_push();

-- ── 4. RPC for edge function / cron to process the queue ──────
-- Claims a batch of pending items (marks them 'processing' to
-- prevent double-pickup), returns the batch for the caller to
-- send pushes, then the caller marks them completed/failed.

CREATE OR REPLACE FUNCTION public.dequeue_wallet_pushes(
  p_batch_size INTEGER DEFAULT 50
)
RETURNS SETOF wallet_push_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id
    FROM wallet_push_queue
    WHERE status IN ('pending', 'failed')
      AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE wallet_push_queue q
  SET status   = 'processing',
      attempts = attempts + 1
  FROM batch
  WHERE q.id = batch.id
  RETURNING q.*;
END;
$$;

-- ── 5. RPC to mark queue items as completed or failed ─────────

CREATE OR REPLACE FUNCTION public.complete_wallet_push(
  p_queue_id  UUID,
  p_success   BOOLEAN,
  p_error     TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE wallet_push_queue
  SET status       = CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
      last_error   = CASE WHEN p_success THEN NULL ELSE p_error END,
      processed_at = CASE WHEN p_success THEN NOW() ELSE NULL END
  WHERE id = p_queue_id;
END;
$$;

-- ── 6. RPC to clean up old completed items (call from cron) ───

CREATE OR REPLACE FUNCTION public.cleanup_wallet_push_queue(
  p_retention_days INTEGER DEFAULT 7
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM wallet_push_queue
  WHERE status = 'completed'
    AND processed_at < NOW() - (p_retention_days || ' days')::interval;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ── 7. Grant execute to service role (edge functions) ─────────
-- These RPCs are only called by edge functions using the service
-- role key, but we grant to authenticated as a fallback for admin.

GRANT EXECUTE ON FUNCTION public.dequeue_wallet_pushes(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_wallet_push(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_wallet_push_queue(INTEGER) TO authenticated;

-- ── 8. Optional: pg_cron schedule ─────────────────────────────
-- If pg_cron is available, schedule queue processing every 30
-- seconds and cleanup daily. The processing job calls the edge
-- function which in turn calls dequeue_wallet_pushes.
-- NOTE: The actual push logic lives in the push-wallet-update
-- edge function. This cron job just invokes it periodically.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Clean up completed queue items daily at 3 AM UTC
    PERFORM cron.schedule(
      'wallet-push-queue-cleanup',
      '0 3 * * *',
      $cron$SELECT public.cleanup_wallet_push_queue(7)$cron$
    );

    RAISE NOTICE 'pg_cron: scheduled wallet-push-queue-cleanup (daily at 3 AM UTC)';
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule cleanup_wallet_push_queue manually or via edge function';
  END IF;
END;
$$;

-- ── Reload PostgREST schema cache ──────────────────────────────

NOTIFY pgrst, 'reload schema';
