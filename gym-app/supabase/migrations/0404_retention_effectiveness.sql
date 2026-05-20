-- =============================================================
-- RETENTION EFFECTIVENESS RPC
-- Migration: 0404_retention_effectiveness.sql
--
-- Single RPC that returns every aggregate the new "Effectiveness"
-- admin panel needs in one round-trip. Designed for the dashboard
-- to call once and render multiple charts from the response.
--
-- "Returns" detection (no status-change log exists yet):
--   We approximate a reactivation as a member who has a
--   cancellation_reasons row but is currently membership_status =
--   'active' and whose membership_status_updated_at is after the
--   cancellation_reasons.recorded_at. Heuristic but consistent.
-- =============================================================

CREATE OR REPLACE FUNCTION get_retention_effectiveness(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Auth: caller must belong to the gym.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND role IN ('admin', 'super_admin', 'trainer')
  ) THEN
    RAISE EXCEPTION 'not authorized for gym %', p_gym_id USING ERRCODE = '42501';
  END IF;

  WITH
  -- ── Headline counters ──
  totals AS (
    SELECT jsonb_build_object(
      'lifecycle_sent_7d', (
        SELECT COUNT(*)::INTEGER FROM lifecycle_message_log
        WHERE gym_id = p_gym_id AND sent_at >= NOW() - INTERVAL '7 days'
      ),
      'lifecycle_sent_30d', (
        SELECT COUNT(*)::INTEGER FROM lifecycle_message_log
        WHERE gym_id = p_gym_id AND sent_at >= NOW() - INTERVAL '30 days'
      ),
      'winback_sent_7d', (
        SELECT COUNT(*)::INTEGER FROM winback_message_log
        WHERE gym_id = p_gym_id AND sent_at >= NOW() - INTERVAL '7 days'
      ),
      'winback_sent_30d', (
        SELECT COUNT(*)::INTEGER FROM winback_message_log
        WHERE gym_id = p_gym_id AND sent_at >= NOW() - INTERVAL '30 days'
      ),
      'queue_resolved_7d', (
        SELECT COUNT(*)::INTEGER FROM owner_queue_items
        WHERE gym_id = p_gym_id AND status = 'done' AND resolved_at >= NOW() - INTERVAL '7 days'
      ),
      'queue_resolved_30d', (
        SELECT COUNT(*)::INTEGER FROM owner_queue_items
        WHERE gym_id = p_gym_id AND status = 'done' AND resolved_at >= NOW() - INTERVAL '30 days'
      ),
      'print_cards_delivered_30d', (
        SELECT COUNT(*)::INTEGER FROM print_cards
        WHERE gym_id = p_gym_id AND status = 'delivered' AND delivered_at >= NOW() - INTERVAL '30 days'
      ),
      'cancellations_30d', (
        SELECT COUNT(*)::INTEGER FROM cancellation_reasons
        WHERE gym_id = p_gym_id AND recorded_at >= NOW() - INTERVAL '30 days'
      ),
      'returns_30d', (
        -- Members who had a cancellation but are currently active and
        -- whose status was updated after the cancellation = reactivated.
        SELECT COUNT(DISTINCT cr.profile_id)::INTEGER
        FROM cancellation_reasons cr
        JOIN profiles p ON p.id = cr.profile_id
        WHERE cr.gym_id = p_gym_id
          AND p.membership_status = 'active'
          AND p.membership_status_updated_at IS NOT NULL
          AND p.membership_status_updated_at > cr.recorded_at
          AND p.membership_status_updated_at >= NOW() - INTERVAL '30 days'
      )
    ) AS payload
  ),

  -- ── Owner queue resolution outcomes (last 30 days) ──
  queue_outcomes AS (
    SELECT jsonb_agg(jsonb_build_object(
      'outcome', outcome,
      'count',   count
    ) ORDER BY count DESC) AS payload
    FROM (
      SELECT
        resolved_outcome AS outcome,
        COUNT(*)::INTEGER AS count
      FROM owner_queue_items
      WHERE gym_id = p_gym_id
        AND status = 'done'
        AND resolved_outcome IS NOT NULL
        AND resolved_at >= NOW() - INTERVAL '30 days'
      GROUP BY resolved_outcome
    ) o
  ),

  -- ── Winback effectiveness by category (last 90 days) ──
  -- "sent" = winback messages logged. "returned" = members who got
  -- any winback message AND later reactivated (status flipped to
  -- 'active' after cancellation).
  winback_by_category AS (
    SELECT jsonb_agg(jsonb_build_object(
      'category', category,
      'sent',     sent,
      'returned', returned
    ) ORDER BY sent DESC) AS payload
    FROM (
      SELECT
        wml.category::TEXT AS category,
        COUNT(DISTINCT wml.cancellation_id)::INTEGER AS sent,
        COUNT(DISTINCT wml.cancellation_id) FILTER (
          WHERE p.membership_status = 'active'
            AND p.membership_status_updated_at IS NOT NULL
            AND p.membership_status_updated_at > cr.recorded_at
        )::INTEGER AS returned
      FROM winback_message_log wml
      JOIN cancellation_reasons cr ON cr.id = wml.cancellation_id
      JOIN profiles p ON p.id = wml.profile_id
      WHERE wml.gym_id = p_gym_id
        AND wml.sent_at >= NOW() - INTERVAL '90 days'
      GROUP BY wml.category
    ) wbc
  ),

  -- ── Lifecycle sends broken down by step (last 30 days) ──
  lifecycle_by_step AS (
    SELECT jsonb_agg(jsonb_build_object(
      'step_key', step_key,
      'sent',     count
    ) ORDER BY step_key) AS payload
    FROM (
      SELECT step_key, COUNT(*)::INTEGER AS count
      FROM lifecycle_message_log
      WHERE gym_id = p_gym_id
        AND sent_at >= NOW() - INTERVAL '30 days'
      GROUP BY step_key
    ) ls
  ),

  -- ── Cancellation reason breakdown (last 90 days) ──
  -- Same data WhyLeftPanel surfaces but bundled here so the
  -- effectiveness panel doesn't need a second round-trip.
  cancellations_by_reason AS (
    SELECT jsonb_agg(jsonb_build_object(
      'category', category,
      'count',    count
    ) ORDER BY count DESC) AS payload
    FROM (
      SELECT category::TEXT AS category, COUNT(*)::INTEGER AS count
      FROM cancellation_reasons
      WHERE gym_id = p_gym_id
        AND recorded_at >= NOW() - INTERVAL '90 days'
      GROUP BY category
    ) cb
  )

  SELECT jsonb_build_object(
    'totals',                  (SELECT payload FROM totals),
    'queue_outcomes',          COALESCE((SELECT payload FROM queue_outcomes),          '[]'::jsonb),
    'winback_by_category',     COALESCE((SELECT payload FROM winback_by_category),     '[]'::jsonb),
    'lifecycle_by_step',       COALESCE((SELECT payload FROM lifecycle_by_step),       '[]'::jsonb),
    'cancellations_by_reason', COALESCE((SELECT payload FROM cancellations_by_reason), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_retention_effectiveness(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_retention_effectiveness(UUID) TO authenticated;
