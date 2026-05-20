-- =============================================================
-- RETENTION EFFECTIVENESS — adds 12-week timeseries
-- Migration: 0407_effectiveness_timeseries.sql
--
-- Replaces get_retention_effectiveness from 0404. Keeps every
-- existing field intact and adds a new `timeseries` array with
-- 12 weekly buckets (ISO weeks, Monday-aligned) ending on the
-- most recent COMPLETE ISO week. Every week is present in the
-- output even when its counts are all zero, so the chart on the
-- admin Effectiveness panel renders a continuous trend.
--
-- "Returns" per week uses the same reactivation heuristic the
-- function already uses (cancellation row exists, profile is now
-- active, membership_status_updated_at is after the cancellation),
-- applied per week against membership_status_updated_at.
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
  ),

  -- ── 12 weekly buckets ending on the last COMPLETE ISO week ──
  -- ISO weeks start Monday. The "current" ISO week (the one
  -- containing NOW()) is excluded so the most recent bucket
  -- represents a full 7-day window. generate_series guarantees
  -- every week is present, including weeks with zero activity.
  week_buckets AS (
    SELECT week_start::DATE AS week_start
    FROM generate_series(
      (date_trunc('week', NOW()) - INTERVAL '12 weeks')::DATE,
      (date_trunc('week', NOW()) - INTERVAL '1 week')::DATE,
      INTERVAL '1 week'
    ) AS week_start
  ),

  weekly_lifecycle AS (
    SELECT date_trunc('week', sent_at)::DATE AS week_start,
           COUNT(*)::INTEGER AS lifecycle_sent
    FROM lifecycle_message_log
    WHERE gym_id = p_gym_id
      AND sent_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND sent_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),

  weekly_winback AS (
    SELECT date_trunc('week', sent_at)::DATE AS week_start,
           COUNT(*)::INTEGER AS winback_sent
    FROM winback_message_log
    WHERE gym_id = p_gym_id
      AND sent_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND sent_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),

  weekly_queue AS (
    SELECT date_trunc('week', resolved_at)::DATE AS week_start,
           COUNT(*)::INTEGER AS queue_resolved
    FROM owner_queue_items
    WHERE gym_id = p_gym_id
      AND status = 'done'
      AND resolved_at IS NOT NULL
      AND resolved_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND resolved_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),

  weekly_cancellations AS (
    SELECT date_trunc('week', recorded_at)::DATE AS week_start,
           COUNT(*)::INTEGER AS cancellations
    FROM cancellation_reasons
    WHERE gym_id = p_gym_id
      AND recorded_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND recorded_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),

  weekly_returns AS (
    SELECT date_trunc('week', p.membership_status_updated_at)::DATE AS week_start,
           COUNT(DISTINCT cr.profile_id)::INTEGER AS returns
    FROM cancellation_reasons cr
    JOIN profiles p ON p.id = cr.profile_id
    WHERE cr.gym_id = p_gym_id
      AND p.membership_status = 'active'
      AND p.membership_status_updated_at IS NOT NULL
      AND p.membership_status_updated_at > cr.recorded_at
      AND p.membership_status_updated_at >= (date_trunc('week', NOW()) - INTERVAL '12 weeks')
      AND p.membership_status_updated_at <  date_trunc('week', NOW())
    GROUP BY 1
  ),

  timeseries AS (
    SELECT jsonb_agg(jsonb_build_object(
      'week_start',     to_char(wb.week_start, 'YYYY-MM-DD'),
      'lifecycle_sent', COALESCE(wl.lifecycle_sent, 0),
      'winback_sent',   COALESCE(ww.winback_sent, 0),
      'queue_resolved', COALESCE(wq.queue_resolved, 0),
      'cancellations',  COALESCE(wc.cancellations, 0),
      'returns',        COALESCE(wr.returns, 0)
    ) ORDER BY wb.week_start) AS payload
    FROM week_buckets wb
    LEFT JOIN weekly_lifecycle     wl ON wl.week_start = wb.week_start
    LEFT JOIN weekly_winback       ww ON ww.week_start = wb.week_start
    LEFT JOIN weekly_queue         wq ON wq.week_start = wb.week_start
    LEFT JOIN weekly_cancellations wc ON wc.week_start = wb.week_start
    LEFT JOIN weekly_returns       wr ON wr.week_start = wb.week_start
  )

  SELECT jsonb_build_object(
    'totals',                  (SELECT payload FROM totals),
    'queue_outcomes',          COALESCE((SELECT payload FROM queue_outcomes),          '[]'::jsonb),
    'winback_by_category',     COALESCE((SELECT payload FROM winback_by_category),     '[]'::jsonb),
    'lifecycle_by_step',       COALESCE((SELECT payload FROM lifecycle_by_step),       '[]'::jsonb),
    'cancellations_by_reason', COALESCE((SELECT payload FROM cancellations_by_reason), '[]'::jsonb),
    'timeseries',              COALESCE((SELECT payload FROM timeseries),              '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_retention_effectiveness(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_retention_effectiveness(UUID) TO authenticated;
