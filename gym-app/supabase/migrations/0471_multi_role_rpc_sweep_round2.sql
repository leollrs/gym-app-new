-- ============================================================
-- 0471 — Multi-role authorization sweep (round 2)
-- ============================================================
-- Migration 0463 swept the highest-impact SECURITY DEFINER RPCs to
-- honour profiles.additional_roles (0332 multi-role model), and 0465
-- fixed the is_admin()/is_super_admin() helpers. A full live-function
-- dump on 2026-05-30 found a remaining tail of RPCs still gating on a
-- bare `role IN ('admin','super_admin'[,'trainer'])`, which silently
-- locks out a user whose PRIMARY role is member/trainer but who holds
-- admin/trainer in additional_roles.
--
-- Each function below is reproduced verbatim from the live database with
-- ONLY the authorization predicate widened (and, where a function did a
-- `role = 'super_admin'` cross-gym check, that widened too). Widening is
-- purely additive — single-role admins keep working; multi-role holders
-- now pass. Nothing is tightened EXCEPT one deliberate fix called out
-- below (claim_redemption gym boundary).
--
-- Functions touched:
--   admin_cancel_class_booking, admin_gift_reward, admin_heartbeat,
--   award_challenge_prizes, redeem_challenge_prize, claim_redemption (+gym
--   boundary), compute_churn_scores, demote_trainer_atomically,
--   checkin_by_external_id, get_trainer_class_analytics,
--   redeem_earned_reward, get_challenge_suggestion
-- ============================================================


-- ── 1. admin_cancel_class_booking ──
CREATE OR REPLACE FUNCTION public.admin_cancel_class_booking(p_booking_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
  v_is_super     BOOLEAN;
  v_is_staff     BOOLEAN;
  v_booking      RECORD;
  v_promoted     RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT role::TEXT, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM public.profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_staff := v_is_super
                OR v_caller_role IN ('admin', 'trainer')
                OR 'admin'::user_role   = ANY(COALESCE(v_caller_extra, '{}'))
                OR 'trainer'::user_role = ANY(COALESCE(v_caller_extra, '{}'));

  IF NOT v_is_staff THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO v_booking FROM public.gym_class_bookings
   WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  -- Gym boundary — staff can only cancel bookings inside their own gym
  -- (super_admin can act across gyms).
  IF v_booking.gym_id <> v_caller_gym AND NOT v_is_super THEN
    RETURN json_build_object('error', 'wrong_gym');
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RETURN json_build_object('success', true, 'already_cancelled', true);
  END IF;

  UPDATE public.gym_class_bookings
     SET status = 'cancelled', cancelled_at = NOW()
   WHERE id = p_booking_id;

  IF v_booking.status = 'confirmed' THEN
    SELECT * INTO v_promoted
      FROM public.gym_class_bookings
     WHERE schedule_id = v_booking.schedule_id
       AND booking_date = v_booking.booking_date
       AND status = 'waitlisted'
     ORDER BY waitlist_position ASC
     LIMIT 1;

    IF v_promoted IS NOT NULL THEN
      UPDATE public.gym_class_bookings
         SET status = 'confirmed', waitlist_position = NULL, promoted_at = NOW()
       WHERE id = v_promoted.id;

      BEGIN
        INSERT INTO public.notifications (profile_id, gym_id, type, title, body, dedup_key)
        VALUES (
          v_promoted.profile_id,
          v_promoted.gym_id,
          'class_promoted',
          'Lugar disponible',
          'Subiste de la lista de espera. Tu reserva está confirmada.',
          'class_promoted_' || v_promoted.id::text
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN json_build_object('success', true, 'promoted_id', v_promoted.id);
END;
$function$;


-- ── 2. admin_gift_reward ──
CREATE OR REPLACE FUNCTION public.admin_gift_reward(p_member_id uuid, p_gym_id uuid, p_reward_id text, p_reward_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id    UUID;
  v_admin_role  TEXT;
  v_admin_extra user_role[];
  v_admin_gym   UUID;
  v_is_super    BOOLEAN;
  v_is_admin    BOOLEAN;
  v_redeem_id   UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role::text, additional_roles, gym_id
    INTO v_admin_role, v_admin_extra, v_admin_gym
  FROM profiles WHERE id = v_admin_id;

  v_is_super := (v_admin_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_admin_extra, '{}')));
  v_is_admin := v_is_super
                OR v_admin_role = 'admin'
                OR 'admin'::user_role = ANY(COALESCE(v_admin_extra, '{}'));

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Verify member belongs to admin's gym (or admin is super_admin)
  IF NOT v_is_super THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = p_member_id AND gym_id = v_admin_gym
    ) THEN
      RAISE EXCEPTION 'Member not in your gym';
    END IF;
  END IF;

  INSERT INTO reward_redemptions (profile_id, gym_id, reward_id, reward_name, points_spent, status)
  VALUES (p_member_id, p_gym_id, p_reward_id, p_reward_name, 0, 'pending')
  RETURNING id INTO v_redeem_id;

  RETURN json_build_object(
    'redemption_id', v_redeem_id,
    'success', true
  );
END;
$function$;


-- ── 3. admin_heartbeat ──
CREATE OR REPLACE FUNCTION public.admin_heartbeat(p_page text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _gym_id UUID;
BEGIN
  SELECT gym_id INTO _gym_id FROM profiles
   WHERE id = _uid
     AND (role IN ('admin', 'super_admin')
          OR 'admin'::user_role       = ANY(additional_roles)
          OR 'super_admin'::user_role = ANY(additional_roles));
  IF _gym_id IS NULL THEN RETURN; END IF;

  INSERT INTO admin_presence (profile_id, gym_id, last_seen_at, current_page)
  VALUES (_uid, _gym_id, now(), p_page)
  ON CONFLICT (profile_id)
  DO UPDATE SET last_seen_at = now(), current_page = COALESCE(p_page, admin_presence.current_page);
END;
$function$;


-- ── 4. redeem_challenge_prize ──
CREATE OR REPLACE FUNCTION public.redeem_challenge_prize(p_prize_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prize RECORD;
  v_caller_gym UUID;
  v_caller_role TEXT;
  v_caller_extra user_role[];
  v_is_super BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  SELECT gym_id, role::text, additional_roles
    INTO v_caller_gym, v_caller_role, v_caller_extra
  FROM profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_admin := v_is_super
                OR v_caller_role = 'admin'
                OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'));

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can redeem prizes';
  END IF;

  SELECT * INTO v_prize
  FROM challenge_prizes WHERE id = p_prize_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found';
  END IF;

  IF v_prize.gym_id != v_caller_gym AND NOT v_is_super THEN
    RAISE EXCEPTION 'Not authorized for this gym';
  END IF;

  IF v_prize.status != 'pending' THEN
    RAISE EXCEPTION 'Prize has already been %', v_prize.status;
  END IF;

  UPDATE challenge_prizes
  SET status = 'redeemed', redeemed_at = NOW()
  WHERE id = p_prize_id;

  RETURN jsonb_build_object(
    'id', v_prize.id,
    'challenge_id', v_prize.challenge_id,
    'profile_id', v_prize.profile_id,
    'placement', v_prize.placement,
    'reward_type', v_prize.reward_type,
    'reward_label', v_prize.reward_label,
    'status', 'redeemed',
    'redeemed_at', NOW()
  );
END;
$function$;


-- ── 5. claim_redemption (+ gym boundary fix) ──
-- The live version had NO gym boundary: any admin/trainer of ANY gym
-- could claim a redemption for another gym. Widened to multi-role AND
-- added the missing same-gym check (super_admin bypasses).
CREATE OR REPLACE FUNCTION public.claim_redemption(p_redemption_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id    UUID;
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
  v_is_super     BOOLEAN;
  v_is_staff     BOOLEAN;
  v_redemption   RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = v_caller_id;

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_staff := v_is_super
                OR v_caller_role IN ('admin', 'trainer')
                OR 'admin'::user_role   = ANY(COALESCE(v_caller_extra, '{}'))
                OR 'trainer'::user_role = ANY(COALESCE(v_caller_extra, '{}'));

  IF NOT v_is_staff THEN
    RAISE EXCEPTION 'Only staff can claim redemptions';
  END IF;

  SELECT * INTO v_redemption
    FROM reward_redemptions
   WHERE id = p_redemption_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;

  -- Gym boundary (NEW): non-super staff may only claim their own gym's
  -- redemptions.
  IF NOT v_is_super AND v_redemption.gym_id IS DISTINCT FROM v_caller_gym THEN
    RAISE EXCEPTION 'Redemption not in your gym';
  END IF;

  IF v_redemption.status = 'claimed' THEN
    RAISE EXCEPTION 'Already claimed';
  END IF;

  IF v_redemption.status = 'cancelled' OR v_redemption.status = 'expired' THEN
    RAISE EXCEPTION 'Redemption was cancelled or expired';
  END IF;

  UPDATE reward_points
  SET total_points = GREATEST(0, total_points - v_redemption.points_spent)
  WHERE profile_id = v_redemption.profile_id;

  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (v_redemption.profile_id, v_redemption.gym_id, 'redemption',
    -v_redemption.points_spent, 'Redeemed: ' || v_redemption.reward_name, NOW());

  UPDATE reward_redemptions
  SET status = 'claimed', claimed_at = NOW()
  WHERE id = p_redemption_id;

  RETURN json_build_object(
    'success', true,
    'redemption_id', p_redemption_id,
    'points_deducted', v_redemption.points_spent
  );
END;
$function$;


-- ── 6. compute_churn_scores (auth block only; heavy CTE preserved) ──
CREATE OR REPLACE FUNCTION public.compute_churn_scores(p_gym_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- ── Authorization check (widened for additional_roles) ────────
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND (role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(additional_roles)
           OR 'super_admin'::user_role = ANY(additional_roles))
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only admins of this gym can compute churn scores';
  END IF;

  WITH member_sessions AS (
    SELECT
      ws.profile_id,
      COUNT(*) FILTER (WHERE ws.completed_at > NOW() - INTERVAL '7 days')  AS sessions_7d,
      COUNT(*) FILTER (WHERE ws.completed_at > NOW() - INTERVAL '14 days') AS sessions_14d,
      COUNT(*) FILTER (WHERE ws.completed_at > NOW() - INTERVAL '30 days') AS sessions_30d,
      MAX(ws.completed_at) AS last_workout_at
    FROM workout_sessions ws
    WHERE ws.gym_id = p_gym_id
      AND ws.status = 'completed'
    GROUP BY ws.profile_id
  ),
  scored AS (
    SELECT
      p.id AS profile_id,
      CASE
        WHEN COALESCE(ms.sessions_30d, 0) = 0 THEN
          CASE
            WHEN p.last_active_at < NOW() - INTERVAL '30 days' OR p.last_active_at IS NULL
              THEN 95
            ELSE 85
          END
        WHEN ms.sessions_14d = 0 THEN 70
        WHEN ms.sessions_7d = 0 THEN 45
        WHEN ms.sessions_7d < (ms.sessions_14d - ms.sessions_7d) THEN 30
        ELSE GREATEST(0, 20 - ms.sessions_7d * 5)
      END
      + CASE
          WHEN COALESCE(ms.sessions_7d, 0) > 0
            AND ms.sessions_7d < (ms.sessions_14d - ms.sessions_7d)
          THEN 10
          ELSE 0
        END
      + CASE
          WHEN sc.streak_broken_at IS NOT NULL
            AND sc.streak_broken_at > NOW() - INTERVAL '7 days'
          THEN 10
          ELSE 0
        END
      AS raw_score,

      COALESCE(ms.sessions_7d, 0)  AS sessions_7d,
      COALESCE(ms.sessions_14d, 0) AS sessions_14d,
      COALESCE(ms.sessions_30d, 0) AS sessions_30d,
      p.last_active_at,
      p.is_onboarded,
      COALESCE(sc.current_streak_days, 0) AS streak,
      (sc.streak_broken_at IS NOT NULL
        AND sc.streak_broken_at > NOW() - INTERVAL '7 days') AS streak_recently_broken

    FROM profiles p
    LEFT JOIN member_sessions ms ON ms.profile_id = p.id
    LEFT JOIN streak_cache sc    ON sc.profile_id = p.id
    WHERE p.gym_id = p_gym_id
      AND p.role = 'member'
  ),
  final_scores AS (
    SELECT
      s.profile_id,
      LEAST(100, GREATEST(0, s.raw_score))::NUMERIC(4,1) AS score,
      CASE
        WHEN LEAST(100, GREATEST(0, s.raw_score)) >= 80 THEN 'critical'
        WHEN LEAST(100, GREATEST(0, s.raw_score)) >= 60 THEN 'high'
        WHEN LEAST(100, GREATEST(0, s.raw_score)) >= 30 THEN 'medium'
        ELSE 'low'
      END AS risk_tier,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN s.sessions_30d = 0 AND (s.last_active_at < NOW() - INTERVAL '30 days' OR s.last_active_at IS NULL)
          THEN 'No workouts in 30+ days' END,
        CASE WHEN s.sessions_30d > 0 AND s.sessions_14d = 0
          THEN 'No workouts in 14+ days' END,
        CASE WHEN s.sessions_7d > 0 AND s.sessions_7d < (s.sessions_14d - s.sessions_7d)
          THEN 'Declining workout frequency' END,
        CASE WHEN s.streak_recently_broken
          THEN 'Streak broken recently' END,
        CASE WHEN NOT s.is_onboarded
          THEN 'Never completed onboarding' END
      ], NULL) AS key_signals
    FROM scored s
  )
  INSERT INTO churn_risk_scores (profile_id, gym_id, score, risk_tier, key_signals, computed_at)
  SELECT
    fs.profile_id,
    p_gym_id,
    fs.score,
    fs.risk_tier,
    fs.key_signals,
    NOW()
  FROM final_scores fs
  ON CONFLICT (profile_id, gym_id) DO UPDATE SET
    score       = EXCLUDED.score,
    risk_tier   = EXCLUDED.risk_tier,
    key_signals = EXCLUDED.key_signals,
    computed_at = EXCLUDED.computed_at;

END;
$function$;


-- ── 7. demote_trainer_atomically ──
CREATE OR REPLACE FUNCTION public.demote_trainer_atomically(p_trainer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trainer_gym_id UUID;
  v_caller_role TEXT;
  v_caller_extra user_role[];
  v_caller_gym_id UUID;
  v_is_super BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  SELECT gym_id INTO v_trainer_gym_id
  FROM profiles
  WHERE id = p_trainer_id AND role = 'trainer';

  IF v_trainer_gym_id IS NULL THEN
    RAISE EXCEPTION 'Target user is not a trainer or does not exist'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym_id
  FROM profiles
  WHERE id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = 'P0001';
  END IF;

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_admin := v_is_super
                OR v_caller_role = 'admin'
                OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'));

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can demote trainers' USING ERRCODE = '42501';
  END IF;

  -- A non-super admin can only demote a trainer in their own gym.
  IF NOT v_is_super AND v_caller_gym_id IS DISTINCT FROM v_trainer_gym_id THEN
    RAISE EXCEPTION 'Admin cannot demote a trainer in another gym'
      USING ERRCODE = '42501';
  END IF;

  UPDATE trainer_clients
  SET is_active = FALSE
  WHERE trainer_id = p_trainer_id
    AND gym_id = v_trainer_gym_id;

  UPDATE profiles
  SET role = 'member'
  WHERE id = p_trainer_id
    AND gym_id = v_trainer_gym_id
    AND role = 'trainer';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trainer role changed during demote (concurrent edit)'
      USING ERRCODE = 'P0001';
  END IF;
END;
$function$;


-- ── 8. checkin_by_external_id ──
CREATE OR REPLACE FUNCTION public.checkin_by_external_id(p_external_id text, p_source text DEFAULT 'desktop_bridge'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_gym   UUID;
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_is_staff     BOOLEAN;
  v_member       RECORD;
  v_recent       INT;
  v_pts_budget   INT := 20;
  v_pts_awarded  INT;
  v_trimmed      TEXT;
BEGIN
  v_trimmed := nullif(trim(p_external_id), '');
  IF v_trimmed IS NULL THEN
    RAISE EXCEPTION 'external_id is required';
  END IF;

  SELECT gym_id, role::text, additional_roles
    INTO v_caller_gym, v_caller_role, v_caller_extra
    FROM public.profiles
   WHERE id = auth.uid();

  IF v_caller_gym IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_staff := v_caller_role IN ('admin', 'super_admin')
                OR 'admin'::user_role       = ANY(COALESCE(v_caller_extra, '{}'))
                OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'));

  IF NOT v_is_staff THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id, full_name, avatar_url, qr_external_id
    INTO v_member
    FROM public.profiles
   WHERE gym_id = v_caller_gym
     AND qr_external_id = v_trimmed
   LIMIT 1;

  IF v_member.id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'member_not_found',
      'external_id', v_trimmed
    );
  END IF;

  SELECT COUNT(*) INTO v_recent
    FROM public.check_ins
   WHERE profile_id = v_member.id
     AND gym_id     = v_caller_gym
     AND checked_in_at >= NOW() - interval '3 hours';

  IF v_recent > 0 THEN
    RETURN json_build_object(
      'success', true,
      'duplicate', true,
      'profile_id', v_member.id,
      'member_name', v_member.full_name,
      'avatar_url', v_member.avatar_url,
      'external_id', v_member.qr_external_id
    );
  END IF;

  INSERT INTO public.check_ins (profile_id, gym_id, method, source)
  VALUES (v_member.id, v_caller_gym, 'external_code', p_source);

  BEGIN
    SELECT public.add_reward_points_checked(
      v_member.id, v_caller_gym, 'check_in', v_pts_budget, 'External-code check-in'
    ) INTO v_pts_awarded;
  EXCEPTION WHEN OTHERS THEN
    v_pts_awarded := 0;
  END;

  RETURN json_build_object(
    'success', true,
    'duplicate', false,
    'profile_id', v_member.id,
    'member_name', v_member.full_name,
    'avatar_url', v_member.avatar_url,
    'external_id', v_member.qr_external_id,
    'points_awarded', COALESCE(v_pts_awarded, 0)
  );
END;
$function$;


-- ── 9. get_trainer_class_analytics (admin fallback widened) ──
CREATE OR REPLACE FUNCTION public.get_trainer_class_analytics(p_class_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid UUID;
  v_result JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- Trainer owns this class OR caller is an admin (incl. additional_roles).
  IF NOT EXISTS (
    SELECT 1 FROM gym_classes
    WHERE id = p_class_id AND (trainer_id = uid OR EXISTS (
      SELECT 1 FROM profiles
       WHERE id = uid
         AND (role IN ('admin', 'super_admin')
              OR 'admin'::user_role       = ANY(additional_roles)
              OR 'super_admin'::user_role = ANY(additional_roles))
    ))
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT json_build_object(
    'total_bookings', (
      SELECT COUNT(*) FROM gym_class_bookings WHERE class_id = p_class_id AND booking_date >= CURRENT_DATE - INTERVAL '30 days'
    ),
    'total_attended', (
      SELECT COUNT(*) FROM gym_class_bookings WHERE class_id = p_class_id AND attended = true AND booking_date >= CURRENT_DATE - INTERVAL '30 days'
    ),
    'avg_rating', (
      SELECT ROUND(AVG(rating)::NUMERIC, 1) FROM gym_class_bookings WHERE class_id = p_class_id AND rating IS NOT NULL
    ),
    'rating_distribution', (
      SELECT json_object_agg(r, cnt) FROM (
        SELECT rating AS r, COUNT(*) AS cnt FROM gym_class_bookings
        WHERE class_id = p_class_id AND rating IS NOT NULL
        GROUP BY rating ORDER BY rating
      ) sub
    ),
    'recent_attendees', (
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT b.profile_id, b.rating, b.notes, b.attended_at, b.booking_date,
               p.full_name, p.avatar_url, p.avatar_type, p.avatar_value,
               ws.total_volume_lbs, ws.completed_at
        FROM gym_class_bookings b
        JOIN profiles p ON p.id = b.profile_id
        LEFT JOIN workout_sessions ws ON ws.id = b.workout_session_id
        WHERE b.class_id = p_class_id AND b.attended = true
        ORDER BY b.attended_at DESC
        LIMIT 30
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;


-- ── 10. redeem_earned_reward ──
CREATE OR REPLACE FUNCTION public.redeem_earned_reward(p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row       RECORD;
  v_admin_gym UUID;
  v_role      TEXT;
  v_extra     user_role[];
  v_is_super  BOOLEAN;
  v_is_admin  BOOLEAN;
BEGIN
  SELECT gym_id, role::text, additional_roles
    INTO v_admin_gym, v_role, v_extra
    FROM public.profiles WHERE id = auth.uid();

  v_is_super := (v_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_extra, '{}')));
  v_is_admin := v_is_super
                OR v_role = 'admin'
                OR 'admin'::user_role = ANY(COALESCE(v_extra, '{}'));

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_row FROM public.earned_rewards WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Earned reward not found';
  END IF;

  IF v_row.gym_id != v_admin_gym AND NOT v_is_super THEN
    RAISE EXCEPTION 'Wrong gym';
  END IF;

  IF v_row.status != 'pending' THEN
    RAISE EXCEPTION 'Already %', v_row.status;
  END IF;

  UPDATE public.earned_rewards
     SET status = 'redeemed', redeemed_at = NOW()
   WHERE id = p_id;

  RETURN json_build_object('id', p_id, 'status', 'redeemed', 'redeemed_at', NOW());
END;
$function$;


-- ── 11. award_challenge_prizes (auth widened; award logic verbatim) ──
CREATE OR REPLACE FUNCTION public.award_challenge_prizes(p_challenge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_challenge RECORD;
  v_caller_gym UUID;
  v_caller_role TEXT;
  v_caller_extra user_role[];
  v_is_super BOOLEAN;
  v_is_admin BOOLEAN;
  v_rewards JSONB;
  v_participants RECORD;
  v_top3 UUID[];
  v_result JSONB := '[]'::JSONB;
  v_reward JSONB;
  v_place INT;
  v_points INT;
  v_prize TEXT;
  v_product_id UUID;
  v_reward_type TEXT;
  v_reward_label TEXT;
  v_qr TEXT;
  v_prize_id UUID;
  v_row RECORD;
BEGIN
  -- Verify caller is admin (widened for additional_roles)
  SELECT gym_id, role::text, additional_roles
    INTO v_caller_gym, v_caller_role, v_caller_extra
  FROM profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_admin := v_is_super
                OR v_caller_role = 'admin'
                OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'));

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can award prizes';
  END IF;

  SELECT * INTO v_challenge
  FROM challenges WHERE id = p_challenge_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  IF v_challenge.gym_id != v_caller_gym AND NOT v_is_super THEN
    RAISE EXCEPTION 'Not authorized for this gym';
  END IF;

  IF EXISTS (SELECT 1 FROM challenge_prizes WHERE challenge_id = p_challenge_id) THEN
    RAISE EXCEPTION 'Prizes have already been awarded for this challenge';
  END IF;

  BEGIN
    v_rewards := v_challenge.reward_description::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_rewards := NULL;
  END;

  IF v_rewards IS NULL OR jsonb_array_length(v_rewards) = 0 THEN
    RAISE EXCEPTION 'No rewards configured for this challenge';
  END IF;

  FOR v_row IN
    SELECT cp.profile_id, cp.score
    FROM challenge_participants cp
    WHERE cp.challenge_id = p_challenge_id
    ORDER BY cp.score DESC
    LIMIT 3
  LOOP
    v_place := array_length(v_top3, 1);
    IF v_place IS NULL THEN v_place := 0; END IF;
    v_place := v_place + 1;
    v_top3 := array_append(v_top3, v_row.profile_id);

    IF v_place <= jsonb_array_length(v_rewards) THEN
      v_reward := v_rewards->(v_place - 1);
    ELSE
      CONTINUE;
    END IF;

    v_points := COALESCE((v_reward->>'points')::INT, 0);
    v_prize := v_reward->>'prize';
    v_product_id := NULLIF(v_reward->>'product_id', '')::UUID;

    IF v_product_id IS NOT NULL THEN
      v_reward_type := 'product';
      v_reward_label := COALESCE(v_prize, 'Product prize');
      IF v_points > 0 THEN
        v_reward_label := v_points || ' pts + ' || v_reward_label;
      END IF;
    ELSIF v_prize IS NOT NULL AND v_prize != '' THEN
      v_reward_type := 'custom';
      v_reward_label := v_prize;
      IF v_points > 0 THEN
        v_reward_label := v_points || ' pts + ' || v_reward_label;
      END IF;
    ELSE
      v_reward_type := 'points';
      v_reward_label := v_points || ' pts';
    END IF;

    v_qr := NULL;
    IF v_reward_type IN ('product', 'custom') THEN
      v_qr := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
    END IF;

    IF v_points > 0 THEN
      UPDATE reward_points
      SET total_points = total_points + v_points,
          lifetime_points = lifetime_points + v_points,
          updated_at = NOW()
      WHERE profile_id = v_row.profile_id;

      IF NOT FOUND THEN
        INSERT INTO reward_points (profile_id, total_points, lifetime_points)
        VALUES (v_row.profile_id, v_points, v_points);
      END IF;

      INSERT INTO reward_points_log (profile_id, points, action, description)
      VALUES (
        v_row.profile_id,
        v_points,
        'challenge_completed',
        'Challenge prize: ' || v_challenge.name || ' (' || v_place || CASE v_place WHEN 1 THEN 'st' WHEN 2 THEN 'nd' ELSE 'rd' END || ' place)'
      );
    END IF;

    INSERT INTO challenge_prizes (
      gym_id, challenge_id, profile_id, placement,
      reward_type, reward_label, points_awarded,
      product_id, qr_code, status
    ) VALUES (
      v_challenge.gym_id, p_challenge_id, v_row.profile_id, v_place,
      v_reward_type, v_reward_label, v_points,
      v_product_id, v_qr, 'pending'
    )
    RETURNING id INTO v_prize_id;

    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
    VALUES (
      v_row.profile_id,
      v_challenge.gym_id,
      'challenge_update',
      CASE v_place WHEN 1 THEN '🥇 You won!' WHEN 2 THEN '🥈 2nd place!' ELSE '🥉 3rd place!' END,
      'You placed ' || v_place || CASE v_place WHEN 1 THEN 'st' WHEN 2 THEN 'nd' ELSE 'rd' END || ' in ' || v_challenge.name || '! ' || v_reward_label,
      'challenge_prize_' || p_challenge_id || '_' || v_row.profile_id
    );

    INSERT INTO activity_feed_items (gym_id, actor_id, type, is_public, data)
    VALUES (
      v_challenge.gym_id,
      v_row.profile_id,
      'challenge_won',
      true,
      jsonb_build_object(
        'challenge_id', p_challenge_id,
        'challenge_name', v_challenge.name,
        'placement', v_place,
        'reward_label', v_reward_label
      )
    );

    v_result := v_result || jsonb_build_object(
      'prize_id', v_prize_id,
      'profile_id', v_row.profile_id,
      'placement', v_place,
      'reward_type', v_reward_type,
      'reward_label', v_reward_label,
      'points_awarded', v_points,
      'qr_code', v_qr
    );
  END LOOP;

  INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
  SELECT
    cp.profile_id,
    v_challenge.gym_id,
    'challenge_update',
    v_challenge.name || ' has ended!',
    'Check the final results and see who won.',
    'challenge_ended_' || p_challenge_id || '_' || cp.profile_id
  FROM challenge_participants cp
  WHERE cp.challenge_id = p_challenge_id
    AND cp.profile_id != ALL(v_top3);

  NOTIFY pgrst, 'reload schema';

  RETURN v_result;
END;
$function$;


-- ── 12. get_challenge_suggestion (auth block widened; rules verbatim) ──
CREATE OR REPLACE FUNCTION public.get_challenge_suggestion(p_gym_id uuid)
 RETURNS TABLE(challenge_type text, suggested_name_en text, suggested_name_es text, description_en text, description_es text, exercise_id text, exercise_name text, exercise_name_es text, suggested_days integer, reasoning_en text, reasoning_es text, confidence numeric, rule_matched text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_members   INT;
  v_active_members  INT;
  v_at_risk_count   INT;
  v_at_risk_pct     NUMERIC;
  v_vol_this_week   NUMERIC;
  v_vol_last_week   NUMERIC;
  v_vol_change_pct  NUMERIC;
  v_top_ex_id       TEXT;
  v_top_ex_name     TEXT;
  v_top_ex_name_es  TEXT;
  v_top_ex_users    INT;
  v_top_ex_pct      NUMERIC;
  v_isolated_count  INT;
  v_isolated_pct    NUMERIC;
  v_pr_members      INT;
  v_pr_pct          NUMERIC;
  v_veteran_count   INT;
  v_veteran_pct     NUMERIC;
  v_fallback_type   TEXT;
BEGIN
  -- Auth check: caller must be admin for this gym (widened for additional_roles)
  IF NOT EXISTS (
    SELECT 1 FROM profile_lookup
    WHERE id = auth.uid() AND gym_id = p_gym_id
      AND (role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(additional_roles)
           OR 'super_admin'::user_role = ANY(additional_roles))
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COUNT(*) INTO v_total_members
  FROM profiles
  WHERE gym_id = p_gym_id AND role = 'member' AND membership_status = 'active';

  IF v_total_members < 10 THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT ws.profile_id) INTO v_active_members
  FROM workout_sessions ws
  WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
    AND ws.started_at >= now() - interval '30 days';

  IF v_active_members < 5 THEN
    v_active_members := v_total_members;
  END IF;

  -- ── Rule 1: Churn risk spike ──
  SELECT COUNT(*) INTO v_at_risk_count
  FROM (
    SELECT DISTINCT ON (crs.profile_id) crs.score
    FROM churn_risk_scores crs
    WHERE crs.gym_id = p_gym_id
      AND crs.computed_at >= now() - interval '7 days'
    ORDER BY crs.profile_id, crs.computed_at DESC
  ) latest
  WHERE latest.score >= 55;

  v_at_risk_pct := (v_at_risk_count::NUMERIC / v_total_members) * 100;

  IF v_at_risk_pct > 30 THEN
    RETURN QUERY SELECT
      'consistency'::TEXT,
      'Comeback Week'::TEXT,
      'Semana de Regreso'::TEXT,
      'Show up 5 times this week to prove you''re still in the game'::TEXT,
      'Asiste 5 veces esta semana para demostrar que sigues en el juego'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      7::INT,
      (v_at_risk_count || ' of your ' || v_total_members || ' members are at high churn risk — a consistency challenge rebuilds the habit')::TEXT,
      (v_at_risk_count || ' de tus ' || v_total_members || ' miembros tienen alto riesgo de abandono — un reto de consistencia reconstruye el hábito')::TEXT,
      0.90::NUMERIC(3,2),
      'churn_spike'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 2: Volume trending down ──
  SELECT COALESCE(AVG(ws.total_volume_lbs), 0) INTO v_vol_this_week
  FROM workout_sessions ws
  WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
    AND ws.started_at >= now() - interval '7 days';

  SELECT COALESCE(AVG(ws.total_volume_lbs), 0) INTO v_vol_last_week
  FROM workout_sessions ws
  WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
    AND ws.started_at >= now() - interval '14 days'
    AND ws.started_at < now() - interval '7 days';

  IF v_vol_last_week > 0 THEN
    v_vol_change_pct := ((v_vol_this_week - v_vol_last_week) / v_vol_last_week) * 100;
  ELSE
    v_vol_change_pct := 0;
  END IF;

  IF v_vol_change_pct < -15 THEN
    RETURN QUERY SELECT
      'volume'::TEXT,
      'Volume Wars'::TEXT,
      'Guerra de Volumen'::TEXT,
      'Who can move the most weight this week? Every pound counts.'::TEXT,
      '¿Quién puede mover más peso esta semana? Cada libra cuenta.'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      7::INT,
      ('Gym volume dropped ' || ABS(ROUND(v_vol_change_pct)) || '% this week — a volume challenge fires things back up')::TEXT,
      ('El volumen del gym bajó ' || ABS(ROUND(v_vol_change_pct)) || '% esta semana — un reto de volumen reactiva la intensidad')::TEXT,
      0.85::NUMERIC(3,2),
      'volume_drop'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 3: Popular exercise emerging ──
  SELECT se.exercise_id, e.name, e.name_es, COUNT(DISTINCT ws.profile_id)
  INTO v_top_ex_id, v_top_ex_name, v_top_ex_name_es, v_top_ex_users
  FROM session_exercises se
  JOIN workout_sessions ws ON ws.id = se.session_id
  JOIN exercises e ON e.id = se.exercise_id
  WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
    AND ws.started_at >= now() - interval '7 days'
  GROUP BY se.exercise_id, e.name, e.name_es
  ORDER BY COUNT(DISTINCT ws.profile_id) DESC
  LIMIT 1;

  IF v_top_ex_users IS NOT NULL AND v_active_members > 0 THEN
    v_top_ex_pct := (v_top_ex_users::NUMERIC / v_active_members) * 100;
  ELSE
    v_top_ex_pct := 0;
  END IF;

  IF v_top_ex_pct > 40 THEN
    RETURN QUERY SELECT
      'specific_lift'::TEXT,
      (v_top_ex_name || ' Challenge')::TEXT,
      ('Reto de ' || COALESCE(v_top_ex_name_es, v_top_ex_name))::TEXT,
      ('Compete for the highest ' || v_top_ex_name || ' volume this week')::TEXT,
      ('Compite por el mayor volumen de ' || COALESCE(v_top_ex_name_es, v_top_ex_name) || ' esta semana')::TEXT,
      v_top_ex_id::TEXT,
      v_top_ex_name::TEXT,
      v_top_ex_name_es::TEXT,
      7::INT,
      (v_top_ex_name || ' was logged by ' || v_top_ex_users || ' of ' || v_active_members || ' active members (' || ROUND(v_top_ex_pct) || '%) — capitalize with a dedicated challenge')::TEXT,
      (COALESCE(v_top_ex_name_es, v_top_ex_name) || ' fue registrado por ' || v_top_ex_users || ' de ' || v_active_members || ' miembros activos (' || ROUND(v_top_ex_pct) || '%) — aprovecha con un reto dedicado')::TEXT,
      0.80::NUMERIC(3,2),
      'popular_exercise'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 4: Low social engagement ──
  SELECT COUNT(*) INTO v_isolated_count
  FROM profiles p
  WHERE p.gym_id = p_gym_id AND p.role = 'member' AND p.membership_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM friendships f
      WHERE (f.requester_id = p.id OR f.addressee_id = p.id) AND f.status = 'accepted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM challenge_participants cp WHERE cp.profile_id = p.id
    );

  v_isolated_pct := (v_isolated_count::NUMERIC / v_total_members) * 100;

  IF v_isolated_pct > 50 THEN
    RETURN QUERY SELECT
      'team'::TEXT,
      'Stronger Together'::TEXT,
      'Más Fuertes Juntos'::TEXT,
      'Form a team with your gym buddies and compete together'::TEXT,
      'Forma un equipo con tus compañeros y compitan juntos'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      14::INT,
      (v_isolated_count || ' of your ' || v_total_members || ' members have no friends or challenge history — team challenges build community')::TEXT,
      (v_isolated_count || ' de tus ' || v_total_members || ' miembros no tienen amigos ni historial de retos — los retos en equipo construyen comunidad')::TEXT,
      0.75::NUMERIC(3,2),
      'low_social'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 5: PR momentum ──
  SELECT COUNT(DISTINCT ph.profile_id) INTO v_pr_members
  FROM pr_history ph
  WHERE ph.gym_id = p_gym_id
    AND ph.achieved_at >= now() - interval '7 days';

  v_pr_pct := (v_pr_members::NUMERIC / v_active_members) * 100;

  IF v_pr_pct > 20 THEN
    RETURN QUERY SELECT
      'pr_count'::TEXT,
      'PR Season'::TEXT,
      'Temporada de PRs'::TEXT,
      'The gym is on fire — who can set the most PRs this week?'::TEXT,
      'El gym está en llamas — ¿quién puede romper más récords esta semana?'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      7::INT,
      (v_pr_members || ' members hit PRs this week (' || ROUND(v_pr_pct) || '% of active) — ride the momentum')::TEXT,
      (v_pr_members || ' miembros rompieron récords esta semana (' || ROUND(v_pr_pct) || '% de activos) — aprovecha el impulso')::TEXT,
      0.75::NUMERIC(3,2),
      'pr_momentum'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 6: Veteran cluster ──
  SELECT COUNT(*) INTO v_veteran_count
  FROM profiles p
  WHERE p.gym_id = p_gym_id AND p.role = 'member' AND p.membership_status = 'active'
    AND p.created_at < now() - interval '90 days'
    AND (
      SELECT COUNT(*) FROM check_ins ci
      WHERE ci.profile_id = p.id AND ci.checked_in_at >= now() - interval '14 days'
    ) >= 2;

  v_veteran_pct := (v_veteran_count::NUMERIC / v_total_members) * 100;

  IF v_veteran_pct > 30 THEN
    RETURN QUERY SELECT
      'milestone'::TEXT,
      '500lb Club'::TEXT,
      'Club de las 500lb'::TEXT,
      'Combine your squat, bench, and deadlift 1RM to reach the 500lb club'::TEXT,
      'Combina tu 1RM de sentadilla, press de banca y peso muerto para alcanzar el club de las 500lb'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      14::INT,
      (v_veteran_count || ' of your ' || v_total_members || ' members are experienced lifters (90+ days, active) — they''re ready for a milestone challenge')::TEXT,
      (v_veteran_count || ' de tus ' || v_total_members || ' miembros son levantadores experimentados (90+ días, activos) — están listos para un reto de club')::TEXT,
      0.70::NUMERIC(3,2),
      'veteran_cluster'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 7: Fallback — best historical challenge type ──
  SELECT c.type INTO v_fallback_type
  FROM challenges c
  LEFT JOIN challenge_participants cp ON cp.challenge_id = c.id
  WHERE c.gym_id = p_gym_id
  GROUP BY c.type
  ORDER BY COUNT(DISTINCT cp.profile_id) DESC
  LIMIT 1;

  v_fallback_type := COALESCE(v_fallback_type, 'consistency');

  RETURN QUERY SELECT
    v_fallback_type::TEXT,
    CASE v_fallback_type
      WHEN 'consistency' THEN 'Weekly Grind'
      WHEN 'volume' THEN 'Volume Wars'
      WHEN 'pr_count' THEN 'PR Season'
      ELSE 'Weekly Challenge'
    END::TEXT,
    CASE v_fallback_type
      WHEN 'consistency' THEN 'Entreno Semanal'
      WHEN 'volume' THEN 'Guerra de Volumen'
      WHEN 'pr_count' THEN 'Temporada de PRs'
      ELSE 'Reto Semanal'
    END::TEXT,
    'A new challenge to keep the gym competitive'::TEXT,
    'Un nuevo reto para mantener la competencia en el gym'::TEXT,
    NULL::TEXT, NULL::TEXT, NULL::TEXT,
    7::INT,
    (v_fallback_type || ' challenges get the most engagement in your gym — run another one')::TEXT,
    ('Los retos de ' || v_fallback_type || ' generan más participación en tu gym — lanza otro')::TEXT,
    0.50::NUMERIC(3,2),
    'fallback'::TEXT;
  RETURN;
END;
$function$;

NOTIFY pgrst, 'reload schema';
