-- SECURITY FIX: prevent challenge points farming exploit
-- Members could join a challenge, leave, then rejoin to earn challenge_joined
-- points repeatedly. This migration:
--   1. Adds a `dedup_key` column to reward_points_log.
--   2. Creates a partial unique index on (profile_id, action, dedup_key)
--      WHERE dedup_key IS NOT NULL — identical to the notification dedup pattern.
--   3. Adds an optional p_dedup_key parameter to add_reward_points so callers
--      can pass a stable key (e.g. 'challenge_joined:<challenge_uuid>').
--   4. For challenge_joined the function auto-builds the dedup_key from the
--      description when p_dedup_key is not supplied, to cover legacy call sites.
--   5. Adds the same idempotency guard for challenge_completed (awarded by
--      finalize_challenge) to prevent double-completion payouts.
-- ================================================================

-- Step 1: add dedup_key column (idempotent)
ALTER TABLE reward_points_log
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Step 2: partial unique index — only enforced when dedup_key is set.
-- Named as a constraint so ON CONFLICT can reference it by name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_reward_points_log_dedup'
       AND conrelid = 'reward_points_log'::regclass
  ) THEN
    ALTER TABLE reward_points_log
      ADD CONSTRAINT uq_reward_points_log_dedup
      UNIQUE (profile_id, action, dedup_key);
    -- Note: a partial unique constraint (WHERE dedup_key IS NOT NULL) is not
    -- supported via ALTER TABLE ADD CONSTRAINT, so we enforce the NULL guard
    -- inside the function instead (only set dedup_key for idempotent actions).
  END IF;
END;
$$;

-- Step 3: update add_reward_points to accept + honour dedup_key
CREATE OR REPLACE FUNCTION public.add_reward_points(
  p_user_id     UUID,
  p_gym_id      UUID,
  p_action      TEXT,
  p_points      INT,
  p_description TEXT    DEFAULT NULL,
  p_dedup_key   TEXT    DEFAULT NULL
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
  v_dedup_key  TEXT;
BEGIN
  -- ── Authorization ────────────────────────────────────────────
  IF p_user_id != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: can only add points for yourself';
  END IF;

  IF p_gym_id != public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: gym_id does not match your gym';
  END IF;
  -- ── End Authorization ────────────────────────────────────────

  IF p_user_id IS NULL OR p_points IS NULL OR p_points <= 0 THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

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

  -- Resolve dedup key:
  --   • Use explicit p_dedup_key when provided.
  --   • For challenge_joined / challenge_completed auto-build one so that
  --     every call site is protected even without being updated.
  v_dedup_key := p_dedup_key;

  IF v_dedup_key IS NULL AND p_action IN ('challenge_joined', 'challenge_completed') THEN
    -- Derive a stable key from the description if it contains a UUID-shaped token.
    -- Pattern: the client now passes 'Joined a challenge (<uuid>)' or the
    -- finalize_challenge function passes a description with the challenge id.
    v_dedup_key := p_action || ':' || COALESCE(
      (regexp_match(COALESCE(p_description, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))[1],
      -- Fallback: md5 the description so identical repeated calls are still caught.
      md5(COALESCE(p_description, p_action))
    );
  END IF;

  -- 1. Insert log entry — ON CONFLICT DO NOTHING enforces dedup at DB level.
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, dedup_key, created_at)
  VALUES (p_user_id, p_gym_id, p_action, v_expected, p_description, v_dedup_key, NOW())
  ON CONFLICT ON CONSTRAINT uq_reward_points_log_dedup DO NOTHING;

  -- If no row was inserted (duplicate), return current totals without mutation.
  IF NOT FOUND THEN
    SELECT total_points, lifetime_points
      INTO new_total, new_lifetime
      FROM reward_points
     WHERE profile_id = p_user_id;
    RETURN json_build_object('total_points', COALESCE(new_total, 0), 'lifetime_points', COALESCE(new_lifetime, 0));
  END IF;

  -- 2. Upsert totals atomically.
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

NOTIFY pgrst, 'reload schema';
