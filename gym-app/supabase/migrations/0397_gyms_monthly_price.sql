-- =============================================================
-- GYM MONTHLY PRICE + LTV ESTIMATION
-- Migration: 0397_gyms_monthly_price.sql
--
-- Adds the missing piece for retention ROI math: how much each
-- gym actually charges. Without monthly_price every retention
-- decision is flying blind — owner can't tell whether a save
-- attempt is worth the effort, and the orchestrator (ticket #4)
-- has no way to prioritize high-LTV cohorts.
--
-- Companion calc: get_gym_ltv_estimate(gym_id) derives LTV from
-- observed cancellation tenure (cancellation_reasons.tenure_days,
-- migration 0396). Falls back gracefully when no cancellations
-- are recorded yet (new gym, fresh install).
-- =============================================================

-- ── gyms.monthly_price ──────────────────────────────────────
-- NUMERIC(10,2): up to $99,999,999.99 — enough headroom for any
-- currency without forcing kobo/satoshi-style integer math.
-- Currency stored separately so we never assume USD; the PR gym
-- thesis assumes USD but we sell internationally eventually.
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS monthly_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS currency      TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$');  -- ISO 4217 three-letter code

-- ── LTV estimate RPC ────────────────────────────────────────
-- Returns one row with the gym's lifetime-value math derived from
-- observed cancellation tenure. Hormozi's formula:
--   LTV = monthly_price * avg_tenure_months
--
-- We compute avg_tenure_months from cancellation_reasons.tenure_days
-- (recorded at the moment of cancellation). This is more honest than
-- the usual "1 / churn_rate" approximation because it's an actual
-- observed tenure, not a derived one.
--
-- Confidence: sample_size = number of cancellations in the window.
-- The UI should warn when sample_size < 5 ("low confidence — too
-- few cancellations to estimate accurately").
--
-- Returned NULLs mean "not enough data" — callers must handle.
CREATE OR REPLACE FUNCTION get_gym_ltv_estimate(
  p_gym_id    UUID,
  p_days_back INTEGER DEFAULT 365
)
RETURNS TABLE (
  monthly_price            NUMERIC(10, 2),
  currency                 TEXT,
  avg_tenure_months        NUMERIC(8, 2),
  estimated_ltv            NUMERIC(12, 2),
  sample_size              INTEGER,
  active_members           INTEGER,
  estimated_pipeline_value NUMERIC(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price            NUMERIC(10, 2);
  v_currency         TEXT;
  v_avg_days         NUMERIC;
  v_sample_size      INTEGER;
  v_active_members   INTEGER;
  v_avg_tenure_mo    NUMERIC(8, 2);
  v_ltv              NUMERIC(12, 2);
  v_pipeline         NUMERIC(14, 2);
BEGIN
  -- Authorization: caller must belong to the gym (admin/super_admin/trainer).
  -- This matches the read-side RLS on cancellation_reasons.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND role IN ('admin', 'super_admin', 'trainer')
  ) THEN
    RAISE EXCEPTION 'not authorized for gym %', p_gym_id USING ERRCODE = '42501';
  END IF;

  SELECT g.monthly_price, g.currency
    INTO v_price, v_currency
  FROM gyms g
  WHERE g.id = p_gym_id;

  SELECT AVG(cr.tenure_days), COUNT(*)::INTEGER
    INTO v_avg_days, v_sample_size
  FROM cancellation_reasons cr
  WHERE cr.gym_id = p_gym_id
    AND cr.recorded_at >= NOW() - (p_days_back || ' days')::INTERVAL;

  SELECT COUNT(*)::INTEGER
    INTO v_active_members
  FROM profiles
  WHERE gym_id = p_gym_id
    AND role = 'member'
    AND membership_status = 'active';

  -- Convert days → months (30.44 = avg days per month, matches Postgres
  -- AGE-style calc). NULL-propagates correctly when sample is empty.
  v_avg_tenure_mo := CASE WHEN v_avg_days IS NULL THEN NULL
                          ELSE ROUND((v_avg_days / 30.44)::NUMERIC, 2)
                     END;

  v_ltv := CASE WHEN v_price IS NULL OR v_avg_tenure_mo IS NULL THEN NULL
                ELSE ROUND(v_price * v_avg_tenure_mo, 2)
           END;

  v_pipeline := CASE WHEN v_ltv IS NULL OR v_active_members IS NULL THEN NULL
                     ELSE ROUND(v_ltv * v_active_members, 2)
                END;

  RETURN QUERY SELECT
    v_price,
    COALESCE(v_currency, 'USD'),
    v_avg_tenure_mo,
    v_ltv,
    v_sample_size,
    v_active_members,
    v_pipeline;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_gym_ltv_estimate(UUID, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_gym_ltv_estimate(UUID, INTEGER) TO authenticated;
