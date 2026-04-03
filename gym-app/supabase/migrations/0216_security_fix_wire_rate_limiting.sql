-- =============================================================
-- SECURITY FIX: Wire rate limiting into sensitive RPCs
-- Migration: 0216_security_fix_wire_rate_limiting.sql
--
-- Problem: check_rate_limit() and rpc_rate_limits table were
--   created in 0109 but never actually called from any RPC,
--   leaving all functions unprotected against rapid abuse.
--
-- Fix: Redefine the most abusable RPCs with a PERFORM
--   public.check_rate_limit(...) call at the top of each
--   function body. If the limit is exceeded the function
--   raises an exception and the operation is rejected.
--
-- Functions wired:
--   redeem_reward             -> 10 calls / minute
--   increment_challenge_score -> 20 calls / minute
--   complete_workout          ->  5 calls / minute
-- =============================================================

-- ── 1. Modify check_rate_limit to RAISE instead of returning false ──────────
-- The original function returns a boolean, but callers need an exception
-- to actually block the operation. We add a wrapper that raises.

CREATE OR REPLACE FUNCTION public.enforce_rate_limit(
  p_action TEXT,
  p_max_calls INT DEFAULT 10,
  p_window_minutes INT DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.check_rate_limit(p_action, p_max_calls, p_window_minutes) THEN
    RAISE EXCEPTION 'Rate limit exceeded for action: %', p_action;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enforce_rate_limit(TEXT, INT, INT) TO authenticated;


-- ── 2. redeem_reward — max 10 per minute ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.redeem_reward(
  p_reward_id   TEXT,
  p_reward_name TEXT,
  p_cost        INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_gym_id     UUID;
  v_current    INT;
  v_redeem_id  UUID;
BEGIN
  -- Rate limit: max 10 redemptions per minute
  PERFORM public.enforce_rate_limit('redeem_reward', 10, 1);

  -- Validate cost is positive
  IF p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid reward cost';
  END IF;

  -- If gym_rewards table exists, validate cost matches the catalog
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gym_rewards') THEN
    DECLARE v_actual_cost INT;
    BEGIN
      SELECT points_cost INTO v_actual_cost FROM gym_rewards WHERE id = p_reward_id::uuid;
      IF v_actual_cost IS NOT NULL AND v_actual_cost != p_cost THEN
        p_cost := v_actual_cost;  -- Use server-side cost
      END IF;
    END;
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;
  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- Get current points
  SELECT total_points INTO v_current
    FROM reward_points
   WHERE profile_id = v_user_id;

  IF v_current IS NULL OR v_current < p_cost THEN
    RAISE EXCEPTION 'Insufficient points';
  END IF;

  -- 1. Insert redemption record
  INSERT INTO reward_redemptions (profile_id, gym_id, reward_id, reward_name, points_spent, status)
  VALUES (v_user_id, v_gym_id, p_reward_id, p_reward_name, p_cost, 'pending')
  RETURNING id INTO v_redeem_id;

  -- 2. Deduct points
  UPDATE reward_points
  SET total_points = total_points - p_cost,
      last_updated = NOW()
  WHERE profile_id = v_user_id;

  -- 3. Log the deduction
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (v_user_id, v_gym_id, 'redemption', -p_cost, 'Redeemed: ' || p_reward_name, NOW());

  RETURN json_build_object(
    'redemption_id', v_redeem_id,
    'points_spent', p_cost,
    'remaining_points', v_current - p_cost
  );
END;
$$;


-- ── 3. increment_challenge_score — max 20 per minute ─────────────────────────

CREATE OR REPLACE FUNCTION public.increment_challenge_score(
  p_participant_id UUID,
  p_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rate limit: max 20 score increments per minute
  PERFORM public.enforce_rate_limit('increment_challenge_score', 20, 1);

  -- Block non-positive deltas (no sabotage or no-ops)
  IF p_delta <= 0 THEN
    RAISE EXCEPTION 'p_delta must be greater than 0';
  END IF;

  -- Cap maximum delta per call to prevent abuse
  IF p_delta > 50 THEN
    RAISE EXCEPTION 'p_delta exceeds maximum allowed value of 50';
  END IF;

  UPDATE challenge_participants
  SET score = COALESCE(score, 0) + p_delta
  WHERE id = p_participant_id
    AND profile_id = auth.uid();
END;
$$;


-- ── 4. complete_workout — max 5 per minute ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_workout(p_payload JSON)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          UUID;
  v_gym_id           UUID;
  v_session_id       UUID;
  v_routine_id       UUID;
  v_routine_name     TEXT;
  v_started_at       TIMESTAMPTZ;
  v_completed_at     TIMESTAMPTZ;
  v_duration_seconds INT;
  v_total_volume     NUMERIC;
  v_completed_sets   INT;
  v_now              TIMESTAMPTZ := NOW();
  v_today            DATE := CURRENT_DATE;

  -- exercise iteration
  v_ex               JSON;
  v_set              JSON;
  v_se_id            UUID;
  v_set_number       INT;
  v_weight           NUMERIC;
  v_reps             INT;
  v_estimated_1rm    NUMERIC;

  -- PR iteration
  v_pr               JSON;

  -- streak
  v_existing_streak  RECORD;
  v_new_streak       INT := 1;
  v_new_longest      INT := 1;
  v_day_gap          INT;
  v_streak_broken_at TIMESTAMPTZ;

  -- XP
  v_xp_earned        INT := 0;
  v_week_start       TIMESTAMPTZ;
  v_week_count       INT;

  -- feed
  v_exercises_with_sets INT := 0;

  -- constants
  C_WORKOUT_XP       CONSTANT INT := 50;
  C_PR_XP            CONSTANT INT := 100;
  C_WEEKLY_XP        CONSTANT INT := 25;
  C_STREAK7_XP       CONSTANT INT := 200;
  C_STREAK30_XP      CONSTANT INT := 1000;
BEGIN
  -- ── 0. Auth & profile ──────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Rate limit: max 5 workout completions per minute
  PERFORM public.enforce_rate_limit('complete_workout', 5, 1);

  SELECT gym_id INTO v_gym_id
    FROM profiles
   WHERE id = v_user_id;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found or missing gym_id';
  END IF;

  -- ── Parse payload ──────────────────────────────────────────────────────────
  v_routine_id       := (p_payload->>'routine_id')::UUID;
  v_routine_name     := p_payload->>'routine_name';
  v_started_at       := (p_payload->>'started_at')::TIMESTAMPTZ;
  v_completed_at     := (p_payload->>'completed_at')::TIMESTAMPTZ;
  v_duration_seconds := (p_payload->>'duration_seconds')::INT;
  v_total_volume     := (p_payload->>'total_volume_lbs')::NUMERIC;
  v_completed_sets   := (p_payload->>'completed_sets')::INT;

  -- Security: validate inputs
  IF v_completed_at < v_started_at THEN
    RAISE EXCEPTION 'completed_at cannot be before started_at';
  END IF;
  IF v_duration_seconds IS NOT NULL AND v_duration_seconds <= 0 THEN
    RAISE EXCEPTION 'duration_seconds must be positive';
  END IF;
  IF v_total_volume IS NOT NULL AND v_total_volume < 0 THEN
    RAISE EXCEPTION 'total_volume cannot be negative';
  END IF;
  IF json_array_length(p_payload->'exercises') > 100 THEN
    RAISE EXCEPTION 'Too many exercises in payload';
  END IF;

  -- ── 1. Insert workout_session ──────────────────────────────────────────────
  INSERT INTO workout_sessions (
    profile_id, gym_id, routine_id, name, status,
    started_at, completed_at, duration_seconds, total_volume_lbs
  ) VALUES (
    v_user_id, v_gym_id, v_routine_id, v_routine_name, 'completed',
    v_started_at, v_completed_at, v_duration_seconds, v_total_volume
  )
  RETURNING id INTO v_session_id;

  -- ── 2 & 3. Insert session_exercises + session_sets ─────────────────────────
  FOR v_ex IN SELECT * FROM json_array_elements(p_payload->'exercises')
  LOOP
    -- Insert session_exercise
    INSERT INTO session_exercises (
      session_id, exercise_id, snapshot_name, position
    ) VALUES (
      v_session_id,
      (v_ex->>'exercise_id')::UUID,
      v_ex->>'name',
      (v_ex->>'position')::INT
    )
    RETURNING id INTO v_se_id;

    v_exercises_with_sets := v_exercises_with_sets + 1;
    v_set_number := 0;

    -- Insert each set for this exercise
    FOR v_set IN SELECT * FROM json_array_elements(v_ex->'sets')
    LOOP
      v_set_number := v_set_number + 1;
      v_weight := COALESCE((v_set->>'weight')::NUMERIC, 0);
      v_reps   := COALESCE((v_set->>'reps')::INT, 0);
      v_estimated_1rm := CASE WHEN v_weight > 0 AND v_reps > 0
                              THEN v_weight * (1 + v_reps / 30.0)
                              ELSE 0 END;

      INSERT INTO session_sets (
        session_exercise_id, set_number, weight_lbs, reps,
        is_completed, is_pr, estimated_1rm,
        suggested_weight_lbs, suggested_reps,
        rpe, notes
      ) VALUES (
        v_se_id, v_set_number, v_weight, v_reps,
        TRUE, COALESCE((v_set->>'is_pr')::BOOLEAN, FALSE), v_estimated_1rm,
        (v_ex->>'suggested_weight')::NUMERIC,
        (v_ex->>'suggested_reps')::INT,
        (v_set->>'rpe')::NUMERIC,
        v_set->>'notes'
      );
    END LOOP;
  END LOOP;

  -- ── 4. PRs — upsert personal_records + insert pr_history ──────────────────
  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_weight := (v_pr->>'weight')::NUMERIC;
      v_reps   := (v_pr->>'reps')::INT;
      v_estimated_1rm := v_weight * (1 + v_reps / 30.0);

      INSERT INTO personal_records (
        profile_id, gym_id, exercise_id,
        weight_lbs, reps, estimated_1rm,
        achieved_at, session_id, updated_at
      ) VALUES (
        v_user_id, v_gym_id, (v_pr->>'exercise_id')::UUID,
        v_weight, v_reps, v_estimated_1rm,
        v_now, v_session_id, v_now
      )
      ON CONFLICT (profile_id, exercise_id) DO UPDATE SET
        weight_lbs    = EXCLUDED.weight_lbs,
        reps          = EXCLUDED.reps,
        estimated_1rm = EXCLUDED.estimated_1rm,
        achieved_at   = EXCLUDED.achieved_at,
        session_id    = EXCLUDED.session_id,
        updated_at    = EXCLUDED.updated_at;

      INSERT INTO pr_history (
        profile_id, gym_id, exercise_id,
        weight_lbs, reps, estimated_1rm,
        achieved_at, session_id
      ) VALUES (
        v_user_id, v_gym_id, (v_pr->>'exercise_id')::UUID,
        v_weight, v_reps, v_estimated_1rm,
        v_now, v_session_id
      );
    END LOOP;
  END IF;

  -- ── 5. Activity feed items ─────────────────────────────────────────────────
  INSERT INTO activity_feed_items (gym_id, actor_id, type, is_public, data)
  VALUES (
    v_gym_id, v_user_id, 'workout_completed', TRUE,
    json_build_object(
      'session_id', v_session_id,
      'routine_name', v_routine_name,
      'duration_seconds', v_duration_seconds,
      'total_volume_lbs', v_total_volume,
      'set_count', v_completed_sets,
      'exercise_count', v_exercises_with_sets
    )::JSONB
  );

  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_weight := (v_pr->>'weight')::NUMERIC;
      v_reps   := (v_pr->>'reps')::INT;
      v_estimated_1rm := v_weight * (1 + v_reps / 30.0);

      INSERT INTO activity_feed_items (gym_id, actor_id, type, is_public, data)
      VALUES (
        v_gym_id, v_user_id, 'pr_hit', TRUE,
        json_build_object(
          'exercise_name', v_pr->>'exercise_name',
          'weight_lbs', v_weight,
          'reps', v_reps,
          'estimated_1rm', v_estimated_1rm
        )::JSONB
      );
    END LOOP;
  END IF;

  -- ── 6. Streak cache ───────────────────────────────────────────────────────
  SELECT current_streak_days, longest_streak_days, last_activity_date, streak_broken_at
    INTO v_existing_streak
    FROM streak_cache
   WHERE profile_id = v_user_id;

  IF NOT FOUND THEN
    v_new_streak  := 1;
    v_new_longest := 1;
    INSERT INTO streak_cache (
      profile_id, gym_id,
      current_streak_days, longest_streak_days,
      last_activity_date, streak_broken_at
    ) VALUES (
      v_user_id, v_gym_id, 1, 1, v_today, NULL
    );
  ELSE
    v_day_gap := CASE
      WHEN v_existing_streak.last_activity_date IS NOT NULL
      THEN (v_today - v_existing_streak.last_activity_date)::INT
      ELSE 999
    END;

    IF v_day_gap <= 1 THEN
      v_new_streak := CASE
        WHEN v_day_gap = 0 THEN v_existing_streak.current_streak_days
        ELSE v_existing_streak.current_streak_days + 1
      END;
      v_new_longest := GREATEST(v_new_streak, v_existing_streak.longest_streak_days);
      v_streak_broken_at := NULL;
    ELSE
      v_new_streak := 1;
      v_new_longest := v_existing_streak.longest_streak_days;
      v_streak_broken_at := COALESCE(v_existing_streak.streak_broken_at, v_now);
    END IF;

    UPDATE streak_cache SET
      current_streak_days = v_new_streak,
      longest_streak_days = v_new_longest,
      last_activity_date  = v_today,
      streak_broken_at    = v_streak_broken_at,
      updated_at          = v_now
    WHERE profile_id = v_user_id;
  END IF;

  -- ── 7. Update profile last_active_at ───────────────────────────────────────
  UPDATE profiles SET last_active_at = v_now WHERE id = v_user_id;

  -- ── 8. Award XP ───────────────────────────────────────────────────────────
  -- Workout completed
  v_xp_earned := v_xp_earned + C_WORKOUT_XP;
  PERFORM add_reward_points(v_user_id, v_gym_id, 'workout_completed', C_WORKOUT_XP,
    'Completed ' || v_routine_name);

  -- PR XP
  IF p_payload->'session_prs' IS NOT NULL AND json_array_length(p_payload->'session_prs') > 0 THEN
    FOR v_pr IN SELECT * FROM json_array_elements(p_payload->'session_prs')
    LOOP
      v_xp_earned := v_xp_earned + C_PR_XP;
      PERFORM add_reward_points(v_user_id, v_gym_id, 'pr_hit', C_PR_XP,
        'New PR: ' || (v_pr->>'exercise_name'));
    END LOOP;
  END IF;

  -- ── 9. First weekly workout bonus ─────────────────────────────────────────
  v_week_start := date_trunc('week', v_now);
  SELECT COUNT(*) INTO v_week_count
    FROM workout_sessions
   WHERE profile_id = v_user_id
     AND status = 'completed'
     AND completed_at >= v_week_start;

  IF v_week_count = 1 THEN
    v_xp_earned := v_xp_earned + C_WEEKLY_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'first_weekly_workout', C_WEEKLY_XP,
      'First workout this week');
  END IF;

  -- ── 10. Streak milestones ─────────────────────────────────────────────────
  IF v_new_streak = 7 THEN
    v_xp_earned := v_xp_earned + C_STREAK7_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_7', C_STREAK7_XP, '7-day streak!');
  ELSIF v_new_streak = 30 THEN
    v_xp_earned := v_xp_earned + C_STREAK30_XP;
    PERFORM add_reward_points(v_user_id, v_gym_id, 'streak_30', C_STREAK30_XP, '30-day streak!');
  END IF;

  -- ── 11. Delete session draft ──────────────────────────────────────────────
  DELETE FROM session_drafts
   WHERE profile_id = v_user_id
     AND routine_id = v_routine_id;

  -- ── 12. Return summary ────────────────────────────────────────────────────
  RETURN json_build_object(
    'session_id', v_session_id,
    'xp_earned',  v_xp_earned,
    'streak',     v_new_streak
  );
END;
$$;


-- ── Done ─────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
