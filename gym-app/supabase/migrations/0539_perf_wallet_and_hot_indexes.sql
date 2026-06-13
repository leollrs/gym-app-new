-- ============================================================
-- 0539 — Query-performance: wallet push stack + hot-path indexes
-- ============================================================
-- Driven by pg_stat_statements (2026-06-11). Top APP-OWNED offender:
-- push-wallet-update's rate-limit lookup on wallet_pass_update_log
-- (157K calls, 17ms mean, 6s max ≈ 8.6% of total DB time, plus its
-- result-log INSERT at another 1.1%). The query is
--   WHERE profile_id = $1 AND push_sent = true ORDER BY created_at DESC LIMIT 1
-- but the only index (0085) is (profile_id, created_at DESC) with no
-- push_sent predicate — and the function logs push_sent=false rows for
-- every member without registered devices, so the index walk scans a
-- member's whole false-row history before finding (or never finding)
-- a true row. The table also grows forever: nothing ever prunes it.
--
-- Also in here:
--   • workout_sessions composite for the hottest member-history family
--     (profile_id + status filter, completed_at DESC sort — 5 of the
--     top-30 statements).
--   • Re-issue of 0236's plain btree indexes WITHOUT CONCURRENTLY.
--     0236 used CREATE INDEX CONCURRENTLY, which cannot run inside a
--     transaction block — the Supabase SQL editor runs a pasted script
--     as one transaction, so 0236 errored and none of its indexes exist
--     in live. Its three (col::date) expression indexes are NOT
--     re-issued: the columns are TIMESTAMPTZ and timestamptz::date is
--     only STABLE (TimeZone-dependent) → 42P17 in an index expression,
--     so 0236 could never have applied even without CONCURRENTLY. If a
--     date-grouped query ever shows up hot, the pattern is
--     ((col AT TIME ZONE 'UTC')::date) — see 0030 — AND the querying
--     SQL must use that same expression to hit the index.
--   • Drop the dead wallet_push_queue producer: 0237 rewrote
--     trg_wallet_push to enqueue into wallet_push_queue, but no code
--     ever consumes the queue (dequeue_wallet_pushes has zero callers
--     in repo; push-wallet-update never reads it) — every log insert
--     just adds a permanently-pending queue row. And if 0237 was never
--     applied, the live trigger is still the 0085 pg_net version,
--     which calls push-wallet-update on every log INSERT — including
--     the log row push-wallet-update itself writes → feedback loop
--     (only the push_sent=true rate-limit breaks it; members with no
--     devices only ever produce false rows). Dropping the trigger is
--     safe either way: both purchase UIs (scanActionHandlers.js,
--     MemberPurchasesTab.jsx) invoke push-wallet-update directly.
--   • Daily retention cron for wallet_pass_update_log (the rate
--     limiter only needs 5 minutes of history; keep 30 days for audit).
--
-- NOT addressed here (different cause): realtime.list_changes ≈60% of
-- DB time is Supabase Realtime's WAL polling — infrastructure cost of
-- having postgres_changes subscriptions, not a query to index. High
-- mean times on trivially-indexed tiny tables (gym_hours 59ms,
-- nps_surveys 161ms) are load/contention symptoms of the same thing.
-- ============================================================

-- ── 1. Rate-limit lookup: partial index matching the exact predicate ──
CREATE INDEX IF NOT EXISTS idx_wallet_update_log_rate_limit
  ON wallet_pass_update_log (profile_id, created_at DESC)
  WHERE push_sent;

-- ── 2. Member workout history: filter (profile_id, status) + sort completed_at ──
-- Existing idx_sessions_profile is (profile_id, started_at DESC); the hot
-- queries filter status='completed' and sort/range on completed_at.
CREATE INDEX IF NOT EXISTS idx_sessions_profile_status_completed
  ON workout_sessions (profile_id, status, completed_at DESC);

-- ── 3. Re-issue 0236's btree indexes (same names, minus CONCURRENTLY) ──
-- (Its three timestamptz::date expression indexes are intentionally
-- dropped — see header.)
CREATE INDEX IF NOT EXISTS idx_session_exercises_exercise_session
  ON session_exercises(exercise_id, session_id);

CREATE INDEX IF NOT EXISTS idx_session_sets_pr_broad
  ON session_sets(session_exercise_id, set_number)
  WHERE is_pr = TRUE;

CREATE INDEX IF NOT EXISTS idx_wallet_reg_profile_updated
  ON wallet_pass_registrations(profile_id, updated_at DESC);

-- ── 4. Kill the dead/dangerous wallet log trigger ──
-- See header. wallet_push_queue and its RPCs are left in place (harmless,
-- and useful if a real queue processor is ever wired up); only the
-- producer trigger goes. Existing queue backlog can be cleared manually
-- after eyeballing it: DELETE FROM wallet_push_queue;
DROP TRIGGER IF EXISTS trg_wallet_push ON wallet_pass_update_log;
DROP FUNCTION IF EXISTS public.trigger_wallet_push();

-- ── 5. Retention for wallet_pass_update_log ──
CREATE OR REPLACE FUNCTION public.cleanup_wallet_pass_update_log(
  p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM wallet_pass_update_log
  WHERE created_at < NOW() - (p_retention_days || ' days')::interval;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_wallet_pass_update_log(INTEGER) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- cron.schedule(jobname, ...) upserts: re-running this migration is safe.
    PERFORM cron.schedule(
      'wallet-update-log-cleanup',
      '10 3 * * *',
      $cron$SELECT public.cleanup_wallet_pass_update_log(30)$cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron not available — run cleanup_wallet_pass_update_log(30) manually/periodically';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
