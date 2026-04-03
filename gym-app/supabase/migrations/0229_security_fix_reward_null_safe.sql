-- =============================================================
-- SECURITY FIX: NULL-safe gym boundary checks
-- Migration: 0229_security_fix_reward_null_safe.sql
--
-- Problem:
--   Several SECURITY DEFINER functions use != to compare
--   p_gym_id (or v_voucher.gym_id) against current_gym_id().
--   In PostgreSQL, NULL != <anything> evaluates to NULL (not
--   TRUE), so the IF condition is falsy and the RAISE EXCEPTION
--   is silently skipped. This means a user whose current_gym_id()
--   returns NULL (e.g. no profile row, no gym association) can
--   bypass the gym boundary check entirely.
--
-- Fix:
--   Replace != with IS DISTINCT FROM, which is NULL-safe:
--   NULL IS DISTINCT FROM 'x' => TRUE (check fires correctly).
--
-- Functions patched:
--   1. public.add_reward_points        (from 0220)
--   2. public.get_gym_stats_daily      (from 0138)
--   3. public.get_gym_member_summary   (from 0138)
--   4. public.get_gym_exercise_popularity (from 0138)
--   5. admin_redeem_voucher            (from 0184)
-- =============================================================

-- ── 1. add_reward_points ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_reward_points(
  p_user_id     UUID,
  p_gym_id      UUID,
  p_action      TEXT,
  p_points      INT,
  p_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_total    INT;
  new_lifetime INT;
  v_expected   INT;
BEGIN
  -- ── Authorization ────────────────────────────────────────────
  -- Only the owner of the points (or an admin) may call this.
  IF p_user_id != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: can only add points for yourself';
  END IF;

  -- Gym boundary: p_gym_id must be the caller's gym unless super_admin.
  -- Use IS DISTINCT FROM for NULL-safety (NULL != x is NULL, not TRUE).
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: gym_id does not match your gym';
  END IF;
  -- ── End Authorization ────────────────────────────────────────

  IF p_user_id IS NULL OR p_points IS NULL OR p_points <= 0 THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- Server-side points map — must match POINTS_MAP in rewardsEngine.js
  -- The client-sent p_points is IGNORED; we use the canonical value.
  v_expected := CASE p_action
    WHEN 'workout_completed'    THEN 50
    WHEN 'pr_hit'               THEN 100
    WHEN 'check_in'             THEN 20
    WHEN 'streak_day'           THEN LEAST(p_points, 200) -- streak_day is variable but capped
    WHEN 'challenge_completed'  THEN 500
    WHEN 'achievement_unlocked' THEN 75
    WHEN 'weight_logged'        THEN 10
    WHEN 'first_weekly_workout' THEN 25
    WHEN 'streak_7'             THEN 200
    WHEN 'streak_30'            THEN 1000
    WHEN 'daily_challenge'      THEN 25
    WHEN 'challenge_joined'     THEN 25
    ELSE NULL
  END;

  -- Reject unknown actions
  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'Unknown reward action: %', p_action;
  END IF;

  -- 1. Insert log entry
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (p_user_id, p_gym_id, p_action, v_expected, p_description, NOW());

  -- 2. Upsert totals in one atomic operation
  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
  VALUES (p_user_id, p_gym_id, v_expected, v_expected, NOW())
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points + v_expected,
    lifetime_points = reward_points.lifetime_points + v_expected,
    last_updated    = NOW()
  RETURNING total_points, lifetime_points INTO new_total, new_lifetime;

  RETURN json_build_object('total_points', new_total, 'lifetime_points', new_lifetime);
END;
$$;

-- ── 2. get_gym_stats_daily ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_gym_stats_daily(p_gym_id UUID)
RETURNS SETOF mv_gym_stats_daily
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY SELECT * FROM mv_gym_stats_daily WHERE gym_id = p_gym_id;
END;
$$;

-- ── 3. get_gym_member_summary ────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_gym_member_summary(p_gym_id UUID)
RETURNS SETOF mv_gym_member_summary
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY SELECT * FROM mv_gym_member_summary WHERE gym_id = p_gym_id;
END;
$$;

-- ── 4. get_gym_exercise_popularity ───────────────────────────

CREATE OR REPLACE FUNCTION public.get_gym_exercise_popularity(p_gym_id UUID)
RETURNS SETOF mv_gym_exercise_popularity
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_gym_id IS DISTINCT FROM public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY SELECT * FROM mv_gym_exercise_popularity WHERE gym_id = p_gym_id;
END;
$$;

-- ── 5. admin_redeem_voucher ──────────────────────────────────

CREATE OR REPLACE FUNCTION admin_redeem_voucher(p_qr_code TEXT, p_member_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher email_reward_vouchers;
BEGIN
  -- Admin-only check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT * INTO v_voucher
  FROM email_reward_vouchers
  WHERE qr_code = p_qr_code
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Voucher not found or already redeemed');
  END IF;

  -- Verify the voucher belongs to this specific member
  IF v_voucher.member_id IS DISTINCT FROM p_member_id THEN
    RETURN json_build_object('error', 'This reward belongs to a different member');
  END IF;

  -- Verify the voucher belongs to the admin's gym (NULL-safe)
  IF v_voucher.gym_id IS DISTINCT FROM public.current_gym_id() THEN
    RETURN json_build_object('error', 'Voucher not found in your gym');
  END IF;

  -- Check expiry
  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < NOW() THEN
    UPDATE email_reward_vouchers SET status = 'expired' WHERE id = v_voucher.id;
    RETURN json_build_object('error', 'Voucher has expired');
  END IF;

  UPDATE email_reward_vouchers
  SET status = 'redeemed', redeemed_at = NOW()
  WHERE id = v_voucher.id
  RETURNING * INTO v_voucher;

  RETURN row_to_json(v_voucher);
END;
$$;

NOTIFY pgrst, 'reload schema';
