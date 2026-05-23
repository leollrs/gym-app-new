-- =============================================================
-- 0430_print_cards_delivery_dates.sql
--
-- Adds the "expected delivery date" + hybrid fulfillment model to the
-- print-cards system (see 0399/0415).
--
-- Context (from the owner): physical celebration cards are delivered on
-- a weekly cadence — the batch printed during the week is dropped off at
-- the gym every SATURDAY so staff can start handing them to members the
-- following Monday when the gym opens. So the "expected delivery date"
-- for any card is the upcoming Saturday (in the gym's local timezone),
-- frozen at the moment the card is marked printed.
--
-- Hybrid fulfillment: most gyms print their own cards (card_fulfillment
-- = 'gym'); for select gyms the platform owner prints + delivers them
-- (card_fulfillment = 'platform'). Each card snapshots which model was
-- in effect when it was printed (delivery_fulfilled_by) so the admin-side
-- popup can word the message correctly ("arriving ~Jun 7" for platform
-- delivery vs "ready to hand out" for self-print).
--
-- What this migration does:
--   1. gyms.card_fulfillment           — 'gym' | 'platform' (hybrid switch)
--   2. print_cards.expected_delivery_at — frozen delivery Saturday
--      print_cards.delivery_fulfilled_by — 'gym' | 'platform' snapshot
--   3. next_delivery_saturday(ts, tz)   — helper: upcoming Saturday, local
--   4. BEFORE UPDATE trigger            — freezes the date on first print
--   5. super_admin-wide RLS on print_cards (read + update across gyms)
-- =============================================================

-- ── 1 · Hybrid fulfillment switch on the gym ────────────────
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS card_fulfillment TEXT NOT NULL DEFAULT 'gym'
    CHECK (card_fulfillment IN ('gym', 'platform'));

COMMENT ON COLUMN gyms.card_fulfillment IS
  'Who prints + delivers this gym''s celebration cards. gym=gym staff print their own; platform=the platform owner prints centrally and delivers (Saturday drop-off).';

-- ── 2 · Delivery columns on each card ───────────────────────
ALTER TABLE print_cards
  ADD COLUMN IF NOT EXISTS expected_delivery_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_fulfilled_by TEXT
    CHECK (delivery_fulfilled_by IN ('gym', 'platform'));

COMMENT ON COLUMN print_cards.expected_delivery_at IS
  'Upcoming Saturday (gym-local) when the card is expected to reach the gym, frozen at mark-printed time. NULL until printed.';
COMMENT ON COLUMN print_cards.delivery_fulfilled_by IS
  'Snapshot of gyms.card_fulfillment at the moment the card was printed.';

-- ── 3 · Helper: the upcoming Saturday in a given timezone ───
-- DOW: 0=Sunday … 6=Saturday. days_to_sat = (6 - dow + 7) % 7, which is 0
-- when the print already happens on a Saturday (deliver that same day).
-- We anchor the result at 12:00 gym-local so the stored timestamptz lands
-- squarely on the intended calendar Saturday regardless of DST/offset.
CREATE OR REPLACE FUNCTION public.next_delivery_saturday(
  p_from TIMESTAMPTZ,
  p_tz   TEXT DEFAULT 'America/Puerto_Rico'
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT (
    (
      (date_trunc('day', p_from AT TIME ZONE p_tz)::date
        + (((6 - EXTRACT(DOW FROM (p_from AT TIME ZONE p_tz))::int + 7) % 7)) )::timestamp
      + INTERVAL '12 hours'
    ) AT TIME ZONE p_tz
  );
$$;

-- ── 4 · Freeze the delivery date when a card is first printed ─
-- BEFORE UPDATE so it works for the direct PostgREST update the admin
-- panel issues (status→printed) AND any future RPC path. Only fires on the
-- pending→printed transition and only fills NULLs, so the date + fulfiller
-- are frozen once and never recomputed (e.g. printed→delivered leaves them).
CREATE OR REPLACE FUNCTION public.print_cards_set_delivery()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tz          TEXT;
  v_fulfillment TEXT;
BEGIN
  IF NEW.status = 'printed' AND OLD.status IS DISTINCT FROM 'printed' THEN
    -- The client sets printed_at, but guard against a NULL just in case.
    IF NEW.printed_at IS NULL THEN
      NEW.printed_at := now();
    END IF;

    SELECT timezone, card_fulfillment
      INTO v_tz, v_fulfillment
      FROM gyms WHERE id = NEW.gym_id;

    IF NEW.expected_delivery_at IS NULL THEN
      NEW.expected_delivery_at :=
        public.next_delivery_saturday(NEW.printed_at, COALESCE(v_tz, 'America/Puerto_Rico'));
    END IF;

    IF NEW.delivery_fulfilled_by IS NULL THEN
      NEW.delivery_fulfilled_by := COALESCE(v_fulfillment, 'gym');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_print_cards_set_delivery ON print_cards;
CREATE TRIGGER trg_print_cards_set_delivery
  BEFORE UPDATE ON print_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.print_cards_set_delivery();

-- ── 5 · super_admin-wide access to print_cards ──────────────
-- The existing policies (0399) scope reads/updates to the caller's OWN
-- gym via a profiles.gym_id IN (...) subquery, so a super_admin can't see
-- or batch-print other gyms' cards from the platform console. Add explicit
-- platform-wide policies, matching the gym_lifecycle_events pattern (0424).
DROP POLICY IF EXISTS print_cards_super_admin_read   ON print_cards;
DROP POLICY IF EXISTS print_cards_super_admin_update ON print_cards;

CREATE POLICY print_cards_super_admin_read
  ON print_cards FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY print_cards_super_admin_update
  ON print_cards FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
