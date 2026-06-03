-- 0506 — Print card hand-over accountability
-- =============================================================================
-- `delivered_at` + `delivered_by` already record WHEN a card was marked
-- delivered and WHICH staff account marked it. But the person who physically
-- hands the card to the member may not be a system user (front-desk staff), and
-- if a card never reaches the member we need a name on the hook.
--
-- Adds:
--   • delivered_by_name — free-text name of whoever handed it over (the UI makes
--     this MANDATORY at mark-delivered time → accountability).
--   • delivery_note     — optional note captured at hand-over.
--
-- Nullable at the DB level (existing delivered rows predate this), enforced
-- as required only in the mark-delivered modal going forward.
-- =============================================================================

ALTER TABLE public.print_cards
  ADD COLUMN IF NOT EXISTS delivered_by_name TEXT,
  ADD COLUMN IF NOT EXISTS delivery_note     TEXT;

COMMENT ON COLUMN public.print_cards.delivered_by_name IS
  'Free-text name of the staff member who physically handed the card to the member (accountability; may not be a system user).';
COMMENT ON COLUMN public.print_cards.delivery_note IS
  'Optional note captured at hand-over (e.g. "left at front desk", "gave to member personally").';

-- Expose the new columns through PostgREST immediately.
NOTIFY pgrst, 'reload schema';
