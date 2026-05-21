-- =============================================================
-- 0419 — print_format column on print_cards
--
-- Each pending postcard can carry its own intended print size so
-- the owner (or delivery-tier operator) sets format once, the
-- print preview groups all same-format cards together, and the
-- printer only swaps paper between groups instead of mid-job.
--
-- Allowed values:
--   • 'postcard'   — 4x6 cardstock, 1 per sheet (default)
--   • 'letter-2up' — 2 per US Letter portrait, cut horizontally + vertically
--   • 'letter-1up' — 1 card scaled to fill US Letter ("flyer")
--
-- Folded card occasions (tenure_365, milestone_500) ignore this
-- column — they always print Letter landscape with outside +
-- inside spreads stacked. The format selector UI hides itself
-- on those rows.
-- =============================================================

ALTER TABLE public.print_cards
  ADD COLUMN IF NOT EXISTS print_format TEXT
    NOT NULL DEFAULT 'postcard';

-- Cheap guard so a typo from the client can't land a junk value.
-- Use a CHECK constraint instead of an enum so we can add new
-- formats later without an enum-add migration dance.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'print_cards_print_format_check'
  ) THEN
    ALTER TABLE public.print_cards
      ADD CONSTRAINT print_cards_print_format_check
      CHECK (print_format IN ('postcard', 'letter-2up', 'letter-1up'));
  END IF;
END$$;

COMMENT ON COLUMN public.print_cards.print_format IS
  'Intended print size: postcard (4x6), letter-2up (2 per Letter), letter-1up (flyer). Ignored for folded occasions.';

NOTIFY pgrst, 'reload schema';
