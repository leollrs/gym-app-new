-- =============================================================
-- TRAINER READ ACCESS TO CLIENT SESSION DRAFTS
-- Migration: 0380_session_drafts_trainer_read.sql
--
-- Why: the trainer dashboard needs to render an "EN VIVO" pill on the
-- roster row when a client is mid-workout. The data lives in
-- public.session_drafts (one row per active workout). The existing policy
-- `drafts_all_own` is FOR ALL with USING (profile_id = auth.uid()), so
-- trainers can never SELECT a client's draft — the live indicator stays
-- silent regardless of what the UI does.
--
-- This migration ADDS a separate SELECT policy that ORs together with the
-- existing one (PostgreSQL evaluates multiple SELECT policies as OR for
-- USING). Writes (INSERT / UPDATE / DELETE) remain restricted to the draft
-- owner — only the member can mutate their own session.
-- =============================================================

-- Trainers can read drafts of clients in their active client list.
-- public.is_trainer_of() is defined in 0002_auth_helpers_and_rls.sql and
-- is SECURITY DEFINER, so it can read trainer_clients without requiring
-- the trainer to also have RLS access to that table for this check.
DROP POLICY IF EXISTS "drafts_trainer_read" ON public.session_drafts;

CREATE POLICY "drafts_trainer_read" ON public.session_drafts
  FOR SELECT
  USING (public.is_trainer_of(profile_id));

COMMENT ON POLICY "drafts_trainer_read" ON public.session_drafts IS
  'Lets a trainer read session_drafts rows for clients linked via trainer_clients (is_active=TRUE). Used by the live-session indicator on the trainer dashboard and client detail pages. Read-only — writes still go through drafts_all_own which enforces profile_id = auth.uid().';
