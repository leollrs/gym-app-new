-- ============================================================
-- 0658 — Trainer's per-client notes get their own, trainer-only table
-- ============================================================
-- SAFE TO APPLY ANY TIME. It only ADDS. The leak is closed by 0659, which must
-- wait until the new bundle is deployed — see the ORDER note at the bottom.
--
-- WHAT WAS WRONG
--   trainer_clients.notes holds the trainer's private per-client notebook: the
--   Notes tab of the client detail page, a JSON blob of `{ notes, injuries }`
--   (TrainerClientDetail.jsx:581 reads it, :1134 writes it). It is where a
--   coach records injuries, and frank observations about why someone stopped
--   showing up — written on the assumption the client never sees it.
--
--   The SELECT policy on the table is:
--       USING (trainer_id = auth.uid() OR client_id = auth.uid())
--   RLS in Postgres is ROW-level. It does not filter columns, and no column
--   REVOKE ever narrowed it. So any member could ask for their own row and read
--   what their trainer wrote about them — no UI needed, the shipped Supabase
--   client is enough. 0530's header even calls trainer_clients.notes "private"
--   while assuming the member side was closed; it never was.
--
-- WHY A NEW TABLE AND NOT COLUMN GRANTS
--   Postgres table-level SELECT implies every column, and REVOKE SELECT (notes)
--   does NOT override it. Closing it that way means revoking table SELECT and
--   re-granting every OTHER column by name — which silently breaks the moment
--   anyone runs ALTER TABLE ADD COLUMN, because the new column isn't in the
--   grant list. That is a landmine, not a fix. A separate table with its own
--   policy states the intent in one line and cannot drift.
--
-- WHO CAN READ IT
--   The trainer who wrote it. Not the client, and deliberately not gym admins
--   either: "private coaching notes" that a member's gym owner can read are not
--   private in any sense the trainer would recognise. Admins keep every other
--   management path they had.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trainer_client_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id     UUID NOT NULL REFERENCES public.gyms(id)     ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notes      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trainer_client_notes_unique UNIQUE (trainer_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_client_notes_trainer
  ON public.trainer_client_notes (trainer_id);

ALTER TABLE public.trainer_client_notes ENABLE ROW LEVEL SECURITY;

-- One policy, one sentence: the author, and nobody else. The gym check keeps a
-- trainer who moved gyms from reading notes they left behind in the old one.
DROP POLICY IF EXISTS "trainer_client_notes_own" ON public.trainer_client_notes;
CREATE POLICY "trainer_client_notes_own"
  ON public.trainer_client_notes FOR ALL
  USING (trainer_id = auth.uid() AND gym_id = public.current_gym_id())
  WITH CHECK (trainer_id = auth.uid() AND gym_id = public.current_gym_id());

-- ── Backfill ──────────────────────────────────────────────────────────────
-- Only rows that actually carry text. ON CONFLICT DO NOTHING so re-running
-- this migration can never clobber notes a trainer has written since.
INSERT INTO public.trainer_client_notes (gym_id, trainer_id, client_id, notes)
SELECT tc.gym_id, tc.trainer_id, tc.client_id, tc.notes
  FROM public.trainer_clients tc
 WHERE tc.notes IS NOT NULL
   AND btrim(tc.notes) <> ''
ON CONFLICT (trainer_id, client_id) DO NOTHING;

-- ============================================================
-- ORDER OF OPERATIONS — this matters
-- ============================================================
--   1. Apply THIS migration. Nothing breaks: the old column is untouched and
--      the currently-deployed bundle keeps reading it.
--   2. Deploy the app. The new bundle reads trainer_client_notes and falls back
--      to trainer_clients.notes when there's no row yet, so it is correct
--      whether or not step 1 already ran.
--   3. Apply 0659, which blanks trainer_clients.notes. THAT is the step that
--      actually closes the leak, and it is only safe once no deployed client
--      still reads the old column.
--
-- Doing 3 before 2 would show every trainer an empty Notes tab, and some of
-- them would retype notes they thought they'd lost.
-- ============================================================

NOTIFY pgrst, 'reload schema';
