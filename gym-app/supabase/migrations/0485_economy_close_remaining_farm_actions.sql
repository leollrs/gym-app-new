-- 0485_economy_close_remaining_farm_actions.sql
--
-- ⚠️ TOUCHES LIVE POINT BALANCES + the check-in / weight-log / daily-challenge
-- award paths. Smoke-test each of those flows after applying (see bottom).
--
-- 0483 closed the 5 workout-driven actions (workout_completed / pr_hit /
-- first_weekly_workout / streak_7 / streak_30) by requiring a session-derived
-- dedup key + a recent workout_sessions row. But add_reward_points is still
-- granted to `authenticated` (the client legitimately calls it), and the
-- REMAINING actions had no artifact binding, so a logged-in member could open
-- the console and farm them directly:
--   challenge_completed  500 pts  (no legit add_reward_points caller at all)
--   streak_day        ≤  200 pts  (no legit caller)
--   achievement_unlocked  75 pts  (no legit caller; achievements award no pts in-app)
--   check_in              20 pts  (legit caller: add_reward_points_checked, but a
--                                  direct call bypassed the 24h wrapper)
--   daily_challenge       25 pts  (legit caller passes a key, console can vary it)
--   challenge_joined      25 pts  (auto-dedup, but no participation check)
--   weight_logged         10 pts  (legit caller passes a key, console can vary it)
--
-- FIX: bind every client-reachable action to a real artifact + a natural,
-- non-forgeable dedup key, INSIDE add_reward_points. Legit flows pass because
-- the artifact exists (the member really checked in / logged weight / joined /
-- completed the daily). Console farming fails: no artifact, or the natural
-- dedup key collapses repeats to one award. The three no-legit-caller actions
-- (challenge_completed / streak_day / achievement_unlocked) are refused outright
-- on the client path — they only ever ran via direct abuse.
--
-- Reproduced from the live (post-0483) body with the anti-farm section extended.

CREATE OR REPLACE FUNCTION public.add_reward_points(p_user_id uuid, p_gym_id uuid, p_action text, p_points integer, p_description text DEFAULT NULL::text, p_dedup_key text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_total    INT;
  new_lifetime INT;
  v_expected   INT;
  v_dedup_key  TEXT;
  v_is_self    BOOLEAN;
  v_today      DATE := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- ── Authorization ────────────────────────────────────────────
  IF p_user_id != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: can only add points for yourself';
  END IF;
  IF p_gym_id != public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: gym_id does not match your gym';
  END IF;

  IF p_user_id IS NULL OR p_points IS NULL OR p_points <= 0 THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- auth.uid() IS NULL means a service_role / definer-internal caller (cron,
  -- complete_workout, etc.) — those are trusted and skip the artifact gate.
  v_is_self := (auth.uid() IS NOT NULL AND NOT public.is_admin());

  -- Server-side points map — client-sent p_points is IGNORED.
  v_expected := CASE p_action
    WHEN 'workout_completed'    THEN 50
    WHEN 'pr_hit'               THEN 100
    WHEN 'check_in'             THEN 20
    WHEN 'streak_day'           THEN LEAST(p_points, 200)
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

  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'Unknown reward action: %', p_action;
  END IF;

  -- ══ ANTI-FARM (0483 + 0485) ══════════════════════════════════════════════
  -- Only applies to direct member callers (v_is_self). Definer/service callers
  -- (complete_workout, cron, admins) are trusted.
  IF v_is_self THEN

    -- (A) 0483: workout-driven actions require a caller-supplied session key.
    IF p_action IN ('workout_completed','pr_hit','first_weekly_workout','streak_7','streak_30')
       AND (p_dedup_key IS NULL OR length(trim(p_dedup_key)) = 0) THEN
      SELECT total_points, lifetime_points INTO new_total, new_lifetime
        FROM reward_points WHERE profile_id = p_user_id;
      RETURN json_build_object('total_points', COALESCE(new_total,0), 'lifetime_points', COALESCE(new_lifetime,0));
    END IF;

    IF p_action = 'workout_completed' AND NOT EXISTS (
      SELECT 1 FROM workout_sessions
       WHERE profile_id = p_user_id AND status = 'completed'
         AND completed_at >= now() - interval '15 minutes'
    ) THEN
      SELECT total_points, lifetime_points INTO new_total, new_lifetime
        FROM reward_points WHERE profile_id = p_user_id;
      RETURN json_build_object('total_points', COALESCE(new_total,0), 'lifetime_points', COALESCE(new_lifetime,0));
    END IF;

    -- (B) 0485: actions with NO legitimate member caller — refuse outright.
    --     challenge points come from award_challenge_prizes (writes reward_points
    --     directly); streak_day / achievement_unlocked are not awarded in-app.
    IF p_action IN ('challenge_completed','streak_day','achievement_unlocked') THEN
      SELECT total_points, lifetime_points INTO new_total, new_lifetime
        FROM reward_points WHERE profile_id = p_user_id;
      RETURN json_build_object('total_points', COALESCE(new_total,0), 'lifetime_points', COALESCE(new_lifetime,0));
    END IF;

    -- (C) 0485: artifact-bind the remaining client actions + force a natural,
    --     non-forgeable daily dedup key so repeats collapse to one award.
    IF p_action = 'check_in' THEN
      IF NOT EXISTS (
        SELECT 1 FROM check_ins
         WHERE profile_id = p_user_id AND checked_in_at >= now() - interval '15 minutes'
      ) THEN
        SELECT total_points, lifetime_points INTO new_total, new_lifetime
          FROM reward_points WHERE profile_id = p_user_id;
        RETURN json_build_object('total_points', COALESCE(new_total,0), 'lifetime_points', COALESCE(new_lifetime,0));
      END IF;
      p_dedup_key := 'check_in:' || v_today::text;

    ELSIF p_action = 'weight_logged' THEN
      IF NOT EXISTS (
        SELECT 1 FROM body_weight_logs
         WHERE profile_id = p_user_id AND logged_at = v_today
      ) THEN
        SELECT total_points, lifetime_points INTO new_total, new_lifetime
          FROM reward_points WHERE profile_id = p_user_id;
        RETURN json_build_object('total_points', COALESCE(new_total,0), 'lifetime_points', COALESCE(new_lifetime,0));
      END IF;
      p_dedup_key := 'weight_logged:' || v_today::text;

    ELSIF p_action = 'daily_challenge' THEN
      IF NOT EXISTS (
        SELECT 1 FROM daily_challenge_completions
         WHERE profile_id = p_user_id AND challenge_date = v_today
      ) THEN
        SELECT total_points, lifetime_points INTO new_total, new_lifetime
          FROM reward_points WHERE profile_id = p_user_id;
        RETURN json_build_object('total_points', COALESCE(new_total,0), 'lifetime_points', COALESCE(new_lifetime,0));
      END IF;
      p_dedup_key := 'daily_challenge:' || v_today::text;

    ELSIF p_action = 'challenge_joined' THEN
      IF NOT EXISTS (
        SELECT 1 FROM challenge_participants WHERE profile_id = p_user_id
      ) THEN
        SELECT total_points, lifetime_points INTO new_total, new_lifetime
          FROM reward_points WHERE profile_id = p_user_id;
        RETURN json_build_object('total_points', COALESCE(new_total,0), 'lifetime_points', COALESCE(new_lifetime,0));
      END IF;
      -- keep the per-challenge auto-dedup derived below
    END IF;

  END IF;
  -- ══ END ANTI-FARM ════════════════════════════════════════════════════════

  -- Resolve dedup key (challenge_joined / challenge_completed auto-derive).
  v_dedup_key := p_dedup_key;
  IF v_dedup_key IS NULL AND p_action IN ('challenge_joined', 'challenge_completed') THEN
    v_dedup_key := p_action || ':' || COALESCE(
      (regexp_match(COALESCE(p_description, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))[1],
      md5(COALESCE(p_description, p_action))
    );
  END IF;

  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, dedup_key, created_at)
  VALUES (p_user_id, p_gym_id, p_action, v_expected, p_description, v_dedup_key, NOW())
  ON CONFLICT ON CONSTRAINT uq_reward_points_log_dedup DO NOTHING;

  IF NOT FOUND THEN
    SELECT total_points, lifetime_points INTO new_total, new_lifetime
      FROM reward_points WHERE profile_id = p_user_id;
    RETURN json_build_object('total_points', COALESCE(new_total, 0), 'lifetime_points', COALESCE(new_lifetime, 0));
  END IF;

  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
  VALUES (p_user_id, p_gym_id, v_expected, v_expected, NOW())
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points + v_expected,
    lifetime_points = reward_points.lifetime_points + v_expected,
    last_updated    = NOW()
  RETURNING total_points, lifetime_points INTO new_total, new_lifetime;

  RETURN json_build_object('total_points', new_total, 'lifetime_points', new_lifetime);
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ── SMOKE TEST after applying ──────────────────────────────────────────────
--  1. Log a body weight in the app  → +10 once; logging again same day → no double.
--  2. QR check-in                    → +20 once; repeat within day → no double.
--  3. Complete the daily challenge   → +25 once.
--  4. Join a challenge               → +25 once per challenge.
--  5. Console abuse (should all add 0):
--       supabase.rpc('add_reward_points',{p_user_id:<self>,p_gym_id:<self>,p_action:'challenge_completed',p_points:500})
--       supabase.rpc('add_reward_points',{p_user_id:<self>,p_gym_id:<self>,p_action:'weight_logged',p_points:10,p_dedup_key:'x'})  -- no weigh-in today
--       supabase.rpc('add_reward_points',{p_user_id:<self>,p_gym_id:<self>,p_action:'check_in',p_points:20})  -- no recent check-in
