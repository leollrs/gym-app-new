-- Security Hardening Migration 3: Fixes for critical/high/medium vulnerabilities
-- ================================================================================
-- FIX 1: redeem_reward — reject negative/zero cost
-- FIX 2: add_reward_points — reject negative points
-- FIX 3: complete_workout — validate inputs
-- FIX 4: error_logs — require authentication for INSERT
-- FIX 5: push_tokens — restrict trainer SELECT to their own clients
-- FIX 6: Leaderboard — enforce gym boundary + privacy + limit bounds
-- FIX 7: Missing RLS DELETE policies on feed_comments, challenge_score_events
-- FIX 8: admin_delete_gym_member — check auth.users super admin flag
-- FIX 9: audit_log — replace deprecated current_setting with current_gym_id()
-- ================================================================================

-- ── FIX 1: redeem_reward — reject negative/zero cost ──────────────────────────

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
  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Cost must be a positive integer';
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

-- ── FIX 2: add_reward_points — reject negative points ─────────────────────────

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
BEGIN
  IF p_user_id IS NULL OR p_points IS NULL OR p_points <= 0 THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- 1. Insert log entry
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (p_user_id, p_gym_id, p_action, p_points, p_description, NOW());

  -- 2. Upsert totals in one atomic operation
  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
  VALUES (p_user_id, p_gym_id, p_points, p_points, NOW())
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points + p_points,
    lifetime_points = reward_points.lifetime_points + p_points,
    last_updated    = NOW()
  RETURNING total_points, lifetime_points INTO new_total, new_lifetime;

  RETURN json_build_object('total_points', new_total, 'lifetime_points', new_lifetime);
END;
$$;

-- ── FIX 3: complete_workout — validate inputs ─────────────────────────────────

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

-- ── FIX 4: error_logs — require authentication for INSERT ─────────────────────

DROP POLICY IF EXISTS "anyone_insert_errors" ON error_logs;
CREATE POLICY "authenticated_insert_errors" ON error_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── FIX 5: push_tokens — restrict trainer SELECT to their own clients ─────────

DROP POLICY IF EXISTS push_tokens_service_select ON push_tokens;
CREATE POLICY push_tokens_select ON push_tokens
  FOR SELECT USING (
    auth.uid() = profile_id
    OR public.is_admin()
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'trainer'
      AND EXISTS (
        SELECT 1 FROM trainer_clients
        WHERE trainer_id = auth.uid()
          AND client_id = push_tokens.profile_id
          AND is_active = TRUE
      )
    )
  );

-- ── FIX 6: Leaderboard — enforce gym boundary + privacy + limit bounds ────────

CREATE OR REPLACE FUNCTION public.get_leaderboard_volume(
  p_gym_id    UUID,
  p_metric    TEXT DEFAULT 'volume',
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_limit     INT DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Unauthorized: cannot query another gym leaderboard';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    p_limit := 20;
  END IF;

  IF p_metric = 'volume' THEN
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        ws.profile_id AS id,
        p.full_name AS name,
        p.avatar_url AS avatar,
        ROUND(SUM(ws.total_volume_lbs)::numeric) AS score
      FROM workout_sessions ws
      JOIN profiles p ON p.id = ws.profile_id
      WHERE ws.gym_id = p_gym_id
        AND ws.status = 'completed'
        AND (p_start_date IS NULL OR ws.started_at >= p_start_date)
        AND (p.privacy_public = TRUE OR ws.profile_id = auth.uid())
      GROUP BY ws.profile_id, p.full_name, p.avatar_url
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  ELSE
    SELECT json_agg(row_to_json(t)) INTO result FROM (
      SELECT
        ws.profile_id AS id,
        p.full_name AS name,
        p.avatar_url AS avatar,
        COUNT(*)::int AS score
      FROM workout_sessions ws
      JOIN profiles p ON p.id = ws.profile_id
      WHERE ws.gym_id = p_gym_id
        AND ws.status = 'completed'
        AND (p_start_date IS NULL OR ws.started_at >= p_start_date)
        AND (p.privacy_public = TRUE OR ws.profile_id = auth.uid())
      GROUP BY ws.profile_id, p.full_name, p.avatar_url
      ORDER BY score DESC
      LIMIT p_limit
    ) t;
  END IF;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard_prs(
  p_gym_id     UUID,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_limit      INT DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF p_gym_id != public.current_gym_id() THEN
    RAISE EXCEPTION 'Unauthorized: cannot query another gym leaderboard';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    p_limit := 20;
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      ph.profile_id AS id,
      p.full_name AS name,
      COUNT(*)::int AS score
    FROM pr_history ph
    JOIN profiles p ON p.id = ph.profile_id
    WHERE ph.gym_id = p_gym_id
      AND (p_start_date IS NULL OR ph.achieved_at >= p_start_date)
      AND (p.privacy_public = TRUE OR ph.profile_id = auth.uid())
    GROUP BY ph.profile_id, p.full_name
    ORDER BY score DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── FIX 7: Missing RLS DELETE policies ────────────────────────────────────────

-- feed_comments: only owner or admin can delete
CREATE POLICY "feed_comments_delete_own_or_admin" ON feed_comments
  FOR DELETE USING (
    profile_id = auth.uid() OR public.is_admin()
  );

-- challenge_score_events: only admin can delete
CREATE POLICY "challenge_score_events_delete_admin" ON challenge_score_events
  FOR DELETE USING (public.is_admin());

-- ── FIX 8: admin_delete_gym_member — check auth.users super admin flag ────────

CREATE OR REPLACE FUNCTION admin_delete_gym_member(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can delete members';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = p_user_id
      AND p.role = 'super_admin'
  ) OR EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id
      AND u.is_super_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Cannot delete a super admin account';
  END IF;

  -- Session data (deepest children first)
  DELETE FROM session_sets WHERE session_exercise_id IN (
    SELECT id FROM session_exercises WHERE session_id IN (
      SELECT id FROM workout_sessions WHERE profile_id = p_user_id));
  DELETE FROM session_exercises WHERE session_id IN (
    SELECT id FROM workout_sessions WHERE profile_id = p_user_id);
  DELETE FROM workout_sessions       WHERE profile_id = p_user_id;

  -- Progress & metrics
  DELETE FROM personal_records       WHERE profile_id = p_user_id;
  DELETE FROM pr_history             WHERE profile_id = p_user_id;
  DELETE FROM body_weight_logs       WHERE profile_id = p_user_id;
  DELETE FROM body_measurements      WHERE profile_id = p_user_id;
  DELETE FROM progress_photos        WHERE profile_id = p_user_id;
  DELETE FROM overload_suggestions   WHERE profile_id = p_user_id;
  DELETE FROM streak_cache           WHERE profile_id = p_user_id;

  -- Onboarding & nutrition
  DELETE FROM member_onboarding      WHERE profile_id = p_user_id;
  DELETE FROM nutrition_targets      WHERE profile_id = p_user_id;
  DELETE FROM nutrition_checkins     WHERE profile_id = p_user_id;
  DELETE FROM check_ins              WHERE profile_id = p_user_id;

  -- Social
  DELETE FROM feed_likes             WHERE profile_id = p_user_id;
  DELETE FROM feed_comments          WHERE profile_id = p_user_id;
  DELETE FROM activity_feed_items    WHERE actor_id   = p_user_id;
  DELETE FROM friendships            WHERE requester_id = p_user_id OR addressee_id = p_user_id;

  -- Challenges & achievements
  DELETE FROM challenge_score_events WHERE profile_id = p_user_id;
  DELETE FROM challenge_participants WHERE profile_id = p_user_id;
  DELETE FROM user_achievements      WHERE profile_id = p_user_id;
  DELETE FROM user_enrolled_programs WHERE profile_id = p_user_id;

  -- Routines
  DELETE FROM routine_exercises      WHERE routine_id IN (
    SELECT id FROM routines WHERE created_by = p_user_id);
  DELETE FROM routines               WHERE created_by = p_user_id;

  -- Misc
  DELETE FROM notifications          WHERE profile_id = p_user_id;
  DELETE FROM trainer_clients        WHERE trainer_id = p_user_id OR client_id = p_user_id;
  DELETE FROM churn_risk_scores      WHERE profile_id = p_user_id;
  DELETE FROM leaderboard_snapshots  WHERE profile_id = p_user_id;
  DELETE FROM gym_invites            WHERE created_by = p_user_id;

  -- Profile and auth user
  DELETE FROM profiles               WHERE id = p_user_id;
  DELETE FROM auth.users             WHERE id = p_user_id;
END;
$$;

-- ── FIX 9: audit_log — replace deprecated current_setting with current_gym_id() ─

DROP POLICY IF EXISTS "gym admin can read own gym audit_log" ON audit_log;
CREATE POLICY "gym admin can read own gym audit_log"
  ON audit_log FOR SELECT
  USING (
    gym_id = public.current_gym_id()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
        AND profiles.gym_id = audit_log.gym_id
    )
  );

-- ── Done ──────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
