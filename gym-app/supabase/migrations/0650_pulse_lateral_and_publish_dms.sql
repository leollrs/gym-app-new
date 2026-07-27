-- ============================================================================
-- 0650: Publish direct_messages to supabase_realtime
--
-- ⚠️  APPLY ORDER MATTERS. Read the note before the ALTER PUBLICATION below.
--
-- HISTORY: this file originally also rewrote `platform_gym_activity_pulse` to
-- replace two full-table `MAX() GROUP BY` CTEs with per-gym LATERAL index seeks.
-- That part was REMOVED before it was ever applied, and the reason is worth
-- keeping: it was written against migration 0433's version of the function, but
-- 0434_gym_daily_activity_rollup.sql had already replaced the whole thing with a
-- version that reads the `gym_daily_activity` rollup table. There has been no
-- full-table MAX() in production since 0434. The "optimization" would have
-- reverted a real optimization — pushing the counting CTEs back onto raw
-- check_ins/workout_sessions across every tenant — AND shifted the numbers, since
-- 0434 buckets by gym-LOCAL day and by COALESCE(completed_at, started_at) while
-- the rewrite used rolling UTC windows and started_at only. The platform churn
-- watchlist would have quietly changed which gyms it flags.
--
-- Lesson for next time: `grep -rln "FUNCTION public.<name>" supabase/migrations/`
-- and take the HIGHEST-numbered definition. Reading the migration that first
-- created a function tells you nothing about what is live.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- Publish direct_messages to supabase_realtime
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  APPLY THIS ONLY AFTER THE MATCHING APP BUILD IS SHIPPED. ⚠️
--
-- WHY IT MATTERS: `direct_messages` is not currently in the publication, so the
-- `postgres_changes` subscriptions on it have NEVER fired. Live message delivery
-- and read receipts — both documented in CLAUDE.md as working features — do not
-- work. An open DM thread receives nothing until you leave and re-enter it.
--
-- WHY THE ORDER MATTERS: before the accompanying client change, several of those
-- subscriptions had NO server-side filter — most importantly the unread-badge one
-- in Navigation.jsx, which every member holds for their entire session. With no
-- filter, Realtime evaluates the RLS policy once per subscriber per row change, so
-- publishing while those exist means one 20-message conversation costs ~60,000 RLS
-- evaluations at 1,000 concurrent members (a ~1,300:1 waste ratio). The client
-- change removes every unfiltered subscription and keeps only the per-conversation
-- ones (`filter: conversation_id=eq.<id>`), which the server evaluates once and
-- delivers only to that thread's participants.
--
-- Verified before writing this: zero unfiltered `direct_messages` bindings remain
-- in the working tree — the four that survive (Messages.jsx, TrainerMessages.jsx)
-- all carry a conversation_id filter. So the only exposure is devices still on the
-- OLD bundle, which at the current user count is a handful of clients.
--
-- Ship the app build first if convenient. If this is applied early, the cost is
-- real but instantly reversible:
--   ALTER PUBLICATION supabase_realtime DROP TABLE direct_messages;
--
-- SECURITY: `direct_messages` has RLS enabled (0161) with live SELECT policies
-- (0222, 0338, 0342). Realtime evaluates those per subscriber, so publishing does
-- NOT expose messages to anyone who could not already read them.
--
-- WHY NOT THE OTHER TABLES: `workout_sessions`, `check_ins`, `personal_records`,
-- `streak_cache` and `challenge_participants` stay UNPUBLISHED on purpose. Those
-- fan out to every member with a leaderboard or gym-pulse view open — an estimated
-- ~17.3M messages/month from a single 2,000-member gym, against a 5M/month plan
-- allowance. Their subscriptions have been removed and replaced with polling.
-- DM volume is a rounding error by comparison, which is why this one is worth it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'direct_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
  END IF;
END;
$$;

-- REPLICA IDENTITY FULL so UPDATE events carry the full OLD row. Read receipts
-- are an UPDATE (setting read_at); with the default REPLICA IDENTITY the payload
-- carries only the primary key plus changed columns — so `conversation_id` would
-- be ABSENT, and the per-conversation Realtime filter would silently drop every
-- receipt event. FULL costs more WAL per update, which is acceptable at DM volume
-- and is precisely what makes the receipt work at all.
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;
