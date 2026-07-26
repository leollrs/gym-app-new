-- ==========================================================================
-- 0642_session_packs_editable.sql
-- Editable + dated session packs (extends 0534). PURELY ADDITIVE columns — no
-- policy or trigger changes, so this migration cannot deadlock (unlike 0641).
--
-- WHY no RLS change: the trainer already holds a FOR ALL policy on their own
-- packs ("session_packs_trainer_all", 0534), so editing an existing pack is a
-- plain UPDATE and the client already has SELECT on their own packs
-- ("session_packs_client_select") — everything the member-side wallet card and
-- the trainer edit UI need is already permitted.
--
-- Dates are advisory/display for v1: the app shows them and EXCLUDES expired
-- packs from the member's "sessions left" count. Hard consumption-time
-- enforcement (teaching the 0534 decrement trigger to skip expired packs) is a
-- deliberate follow-up so this migration stays trigger-free and reversible.
-- ==========================================================================

ALTER TABLE public.session_packs
  ADD COLUMN IF NOT EXISTS title      TEXT,
  ADD COLUMN IF NOT EXISTS starts_at  DATE,
  ADD COLUMN IF NOT EXISTS expires_at DATE;

COMMENT ON COLUMN public.session_packs.title IS
  'Optional human label (e.g. "Personal Training 10-Pack"); UI falls back to "<n>-session pack".';
COMMENT ON COLUMN public.session_packs.starts_at IS
  'Optional validity start (display/advisory).';
COMMENT ON COLUMN public.session_packs.expires_at IS
  'Optional expiry (display/advisory; app excludes expired packs from remaining-session counts).';

NOTIFY pgrst, 'reload schema';
