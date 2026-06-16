-- ============================================================================
-- 0587 — Gym subscription metadata (operator-visible)        (audit: completeness-10)
-- ============================================================================
-- "No billing by design", but the operator still needs lightweight, ACTIONABLE
-- subscription context the plan badge alone can't give: when a trial ends, when
-- a plan renews/expires, and a soft member-seat cap. These are display/insight
-- fields only (surfaced on GymDetail + the Attention board's "trials ending" /
-- "over seat limit" rows) — nothing here enforces billing or blocks members.
-- monthly_price + currency already exist (0041/0397).
--
-- Written by super_admin via GymDetail (gyms already carries super_admin UPDATE
-- access used by pause/tier/owner edits), so no RLS change is needed.
-- ============================================================================

ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS trial_ends_at     timestamptz,
  ADD COLUMN IF NOT EXISTS renews_at         timestamptz,
  ADD COLUMN IF NOT EXISTS member_seat_limit integer;

COMMENT ON COLUMN public.gyms.trial_ends_at     IS 'Operator-set trial end (display / Attention only; not enforced).';
COMMENT ON COLUMN public.gyms.renews_at         IS 'Operator-set renewal/expiry date (display only).';
COMMENT ON COLUMN public.gyms.member_seat_limit IS 'Soft member cap for the plan (display / Attention "over seat" flag; not enforced).';

NOTIFY pgrst, 'reload schema';
