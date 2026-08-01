-- ============================================================
-- 0659 — Blank the legacy trainer_clients.notes column
-- ============================================================
-- ⚠️ APPLY ONLY AFTER THE NEW BUNDLE IS LIVE. This is step 3 of the sequence
--    documented at the bottom of 0658. Running it while a client that still
--    reads trainer_clients.notes is deployed shows every trainer an empty
--    Notes tab — and some will retype notes they believe they lost.
--
-- THIS is the step that actually closes the leak. 0658 only copied the notes
-- somewhere safe; the readable copy stayed exactly where it was.
--
-- The COLUMN is kept, not dropped. Dropping it would 400 any request from an
-- older bundle still in someone's WebView (Capgo/App Store rollouts are not
-- instantaneous), turning a cosmetic lag into a broken page. An empty column
-- leaks nothing, and a later migration can drop it once every client has
-- rolled over.
-- ============================================================

-- Refuse to run if 0658 hasn't landed — otherwise this destroys the only copy.
DO $$
BEGIN
  IF to_regclass('public.trainer_client_notes') IS NULL THEN
    RAISE EXCEPTION 'Run 0658 first: trainer_client_notes does not exist, so this would DESTROY the notes';
  END IF;
END $$;

-- Second guard: every non-empty legacy note must already have a home. Counts
-- rows, not text — a trainer who edited their notes after 0658 will differ in
-- content, and that is fine; the new table is authoritative from then on.
DO $$
DECLARE
  v_orphans INT;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM public.trainer_clients tc
   WHERE tc.notes IS NOT NULL
     AND btrim(tc.notes) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM public.trainer_client_notes n
        WHERE n.trainer_id = tc.trainer_id
          AND n.client_id  = tc.client_id
     );
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'Aborting: % note(s) exist only in the legacy column. Re-run 0658''s backfill first.', v_orphans;
  END IF;
END $$;

UPDATE public.trainer_clients
   SET notes = NULL
 WHERE notes IS NOT NULL;

COMMENT ON COLUMN public.trainer_clients.notes IS
  'DEPRECATED and intentionally blank. Trainer notes live in trainer_client_notes '
  '(0658) because the SELECT policy here is row-level and let the CLIENT read '
  'them. Do not write to this column.';

NOTIFY pgrst, 'reload schema';
