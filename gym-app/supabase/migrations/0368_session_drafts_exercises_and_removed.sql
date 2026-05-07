-- ============================================================
-- 0368 — Persist swapped/added/removed exercises in session_drafts
-- ============================================================
-- Bug reported in the field (May 2026 gym test): when a user taps "swap
-- exercise" mid-workout and then leaves the app or the phone reboots, the
-- swap is forgotten on resume — the original routine is restored and the
-- previously swapped exercise reverts to set 1.
--
-- Root cause:
--   • ActiveSession.jsx persists the live exercises array (with swaps,
--     adds, and removals) to localStorage only. The DB-backed
--     `session_drafts` table never knew about it.
--   • The save payload also referenced `removed_exercise_ids`, but that
--     column was never added to the schema (only `skipped_exercise_ids`
--     was, in migration 0319). PostgREST silently dropped/erred on the
--     unknown column, so the removal list never made it to the DB either.
--   • On cold-relaunch (especially after iOS WebView eviction under
--     memory pressure), localStorage may be gone; the load flow falls
--     back to the DB draft, which has none of the swap state, then
--     re-fetches the original routine and overwrites the in-memory
--     exercises array.
--
-- Fix: add the two missing JSONB / array columns so the DB draft is
-- the same source of truth as localStorage.
-- ============================================================

ALTER TABLE public.session_drafts
  ADD COLUMN IF NOT EXISTS exercises JSONB NOT NULL DEFAULT '[]';

ALTER TABLE public.session_drafts
  ADD COLUMN IF NOT EXISTS removed_exercise_ids TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.session_drafts.exercises IS
  'Live exercises array (id, name, targetSets, targetReps, restSeconds, ...) — captures swaps, adds, and removals so resumes see the same surface the user left. Source of truth alongside localStorage savedSession.exercises.';

COMMENT ON COLUMN public.session_drafts.removed_exercise_ids IS
  'IDs of exercises the user removed during the session. Filtered out on resume so removed exercises stay removed.';

NOTIFY pgrst, 'reload schema';
