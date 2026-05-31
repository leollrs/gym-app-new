-- 0484_lock_internal_helpers_and_anon_hygiene.sql
--
-- From the ANON/AUTHENTICATED grant sweep (2026-05-30).
--
-- 🔴 NOTIFICATION/PUSH INJECTION (phishing): the internal notification helpers
--    _notify_push / _notify_trainer / _notify_gym_admins /
--    _fan_out_admin_notification are SECURITY DEFINER, take
--    (profile_id/gym_id, title, body, data) as parameters, have NO caller
--    authorization (only null-checks), and carry the Postgres default PUBLIC
--    EXECUTE. _notify_push inserts a notifications row AND calls
--    net.http_post(send-push-user) with the caller-supplied title/body. So any
--    anon or authenticated caller can deliver an arbitrary push/notification to
--    ANY user by id (e.g. "Your gym: update your payment at <link>"). They are
--    internal-only (invoked via PERFORM from other definer functions, which run
--    as the function owner and therefore do NOT need an EXECUTE grant), and are
--    never called from the client. -> revoke from anon/authenticated/PUBLIC.
--
-- 🟠 compute_weekly_attendance_flags / backfill_weekly_attendance_flags:
--    SECURITY DEFINER, no authz, PUBLIC, write attendance flags for ALL gyms,
--    loop up to 52 weeks -> anon compute-DoS (idempotent, non-destructive).
--    Cron/internal only, not called from the client. -> revoke.
--
-- 🟠 get_cancellation_reason_breakdown / get_gym_card_settings: take p_gym_id,
--    no caller check -> any authenticated user can read any gym's
--    cancellation-category counts / card config (aggregate + config, no PII).
--    Called by the admin RecoveryDashboard. -> add a same-gym staff check
--    (matches their sibling analytics functions).

-- ── 1. Lock the internal notification helpers (CRITICAL) ───────────────────
REVOKE EXECUTE ON FUNCTION
  public._notify_push(uuid, uuid, user_role, notification_type, text, text, text, text, jsonb, text)
  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public._notify_trainer(uuid, uuid, notification_type, text, text, text, text, jsonb, text)
  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public._notify_gym_admins(uuid, notification_type, text, text, text, text, jsonb, text)
  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public._fan_out_admin_notification(uuid, notification_type, text, text, jsonb, text)
  FROM anon, authenticated, PUBLIC;

-- ── 2. Lock the attendance-flag compute helpers (cron/internal) ────────────
REVOKE EXECUTE ON FUNCTION public.compute_weekly_attendance_flags(date)
  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_weekly_attendance_flags(integer)
  FROM anon, authenticated, PUBLIC;

-- ── 3. Add same-gym staff authz to the two unguarded analytics readers ─────
CREATE OR REPLACE FUNCTION public.get_gym_card_settings(p_gym_id uuid)
 RETURNS gym_card_settings
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r gym_card_settings;
BEGIN
  -- Caller must be staff in this gym (super_admin exempt).
  IF NOT public.is_super_admin() AND NOT (public.is_admin() AND public.current_gym_id() = p_gym_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO r FROM gym_card_settings WHERE gym_id = p_gym_id;
  IF NOT FOUND THEN
    r.gym_id := p_gym_id;
    r.default_rewards := '{}'::JSONB;
    r.habit_window_days := 42;
    r.habit_target_count := 9;
    r.habit_dedup_days := 90;
    r.returning_silence_days := 21;
    r.birthday_lookahead_days := 3;
    r.enable_welcome := TRUE;
    r.enable_habit_9in6 := TRUE;
    r.enable_tenure_30 := TRUE;
    r.enable_tenure_90 := TRUE;
    r.enable_tenure_365 := TRUE;
    r.enable_milestone_100 := TRUE;
    r.enable_milestone_250 := TRUE;
    r.enable_milestone_500 := TRUE;
    r.enable_returning := TRUE;
    r.enable_birthday := TRUE;
  END IF;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cancellation_reason_breakdown(p_gym_id uuid, p_days_back integer DEFAULT 90)
 RETURNS TABLE(category cancellation_reason_category, count integer, percentage numeric)
 STABLE SECURITY DEFINER
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Caller must be staff in this gym (super_admin exempt). Matches the read-side
  -- RLS on cancellation_reasons + get_gym_ltv_estimate.
  IF NOT public.is_super_admin() AND NOT (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND gym_id = p_gym_id
        AND (
          role IN ('admin','super_admin','trainer')
          OR 'admin'::user_role       = ANY(additional_roles)
          OR 'super_admin'::user_role = ANY(additional_roles)
          OR 'trainer'::user_role     = ANY(additional_roles)
        )
    )
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH window_rows AS (
    SELECT cr.category
    FROM cancellation_reasons cr
    WHERE cr.gym_id = p_gym_id
      AND cr.recorded_at >= NOW() - (p_days_back || ' days')::INTERVAL
  ),
  totals AS (
    SELECT COUNT(*)::INTEGER AS total FROM window_rows
  )
  SELECT
    w.category,
    COUNT(*)::INTEGER AS count,
    CASE
      WHEN (SELECT total FROM totals) = 0 THEN 0::NUMERIC(5,2)
      ELSE ROUND(100.0 * COUNT(*) / (SELECT total FROM totals), 2)
    END AS percentage
  FROM window_rows w
  GROUP BY w.category
  ORDER BY count DESC;
END;
$function$;

NOTIFY pgrst, 'reload schema';
