-- 0514_fix_challenge_delete_and_prize_award.sql
--
-- Two admin-challenge RPC bugs, each a column-name mismatch that aborts the
-- whole SECURITY DEFINER function:
--
--  1) admin_delete_challenge  → 42703 "column challenge_id does not exist"
--     The cascade block deletes from daily_challenge_completions WHERE
--     challenge_id = ... but that table has no challenge_id column (it tracks
--     daily mini-challenge streaks keyed by date, unrelated to gym challenges).
--     The line is also unnecessary: challenge_participants / challenge_prizes /
--     challenge_progress all FK challenges(id) ON DELETE CASCADE (0001, 0186),
--     so deleting the challenge row cleans them up automatically. Fix = drop the
--     bogus line. (Origin 0293, carried verbatim through 0464.)
--
--  2) award_challenge_prizes  → 42703 "column updated_at of relation
--     reward_points does not exist"
--     reward_points has columns (profile_id, gym_id NOT NULL, total_points,
--     lifetime_points, last_updated) — the timestamp is last_updated, not
--     updated_at. The UPDATE set updated_at = NOW() and the fallback INSERT
--     omitted the NOT NULL gym_id. Fix = last_updated + add gym_id (from the
--     challenge's gym). Body otherwise reproduces the live 0490 function
--     verbatim (multi-role admin check, gym scope, dup-award guard, economy
--     clamp, QR, logging). (Bad column present since origin 0186.)
--
-- ⚠️ Apply via Supabase Dashboard SQL Editor.
--    Smoke-test 1: delete a past challenge that has participants → succeeds.
--    Smoke-test 2: award prizes on an ended challenge with points → top-3
--    reward_points balances increase, challenge_prizes rows created.

-- ── 1. admin_delete_challenge — drop the bogus daily_challenge_completions delete
CREATE OR REPLACE FUNCTION public.admin_delete_challenge(p_challenge_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM challenges c
    JOIN profiles p ON p.gym_id = c.gym_id
    WHERE c.id = p_challenge_id
      AND p.id = auth.uid()
      AND (p.role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(p.additional_roles)
           OR 'super_admin'::user_role = ANY(p.additional_roles))
  ) THEN
    RAISE EXCEPTION 'Challenge not found or access denied';
  END IF;

  -- challenge_participants / challenge_prizes / challenge_progress all
  -- ON DELETE CASCADE, so deleting the challenge row removes them. The explicit
  -- participant delete is harmless redundancy; the daily_challenge_completions
  -- delete was removed (no challenge_id column on that table).
  DELETE FROM challenge_participants WHERE challenge_id = p_challenge_id;

  DELETE FROM challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found or access denied';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_challenge(UUID) TO authenticated;

-- ── 2. award_challenge_prizes — last_updated (not updated_at) + gym_id on INSERT
CREATE OR REPLACE FUNCTION public.award_challenge_prizes(p_challenge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_challenge      RECORD;
  v_caller_gym     UUID;
  v_rewards        JSONB;
  v_row            RECORD;
  v_place          INT;
  v_top3           UUID[];
  v_reward         JSONB;
  v_points         INT;
  v_prize          TEXT;
  v_product_id     UUID;
  v_reward_type    TEXT;
  v_reward_label   TEXT;
  v_qr             TEXT;
  v_prize_id       UUID;
  v_result         JSONB := '[]'::JSONB;
BEGIN
  -- Multi-role aware admin check (primary OR additional_roles)
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can award prizes';
  END IF;

  SELECT gym_id INTO v_caller_gym FROM profiles WHERE id = auth.uid();

  SELECT * INTO v_challenge FROM challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  IF v_challenge.gym_id != v_caller_gym AND NOT public.is_super_admin() THEN
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
    v_place := COALESCE(array_length(v_top3, 1), 0) + 1;
    v_top3 := array_append(v_top3, v_row.profile_id);

    IF v_place <= jsonb_array_length(v_rewards) THEN
      v_reward := v_rewards->(v_place - 1);
    ELSE
      CONTINUE;
    END IF;

    -- ── ECONOMY CLAMP (0490) ──────────────────────────────────────────────
    -- Cap admin-authored prize points to [0, 100000].
    v_points := LEAST(GREATEST(COALESCE((v_reward->>'points')::INT, 0), 0), 100000);
    -- ── END CLAMP ─────────────────────────────────────────────────────────

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
          last_updated = NOW()                       -- FIX: was updated_at (42703)
      WHERE profile_id = v_row.profile_id;

      IF NOT FOUND THEN
        -- FIX: gym_id is NOT NULL on reward_points; source it from the challenge.
        INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points)
        VALUES (v_row.profile_id, v_challenge.gym_id, v_points, v_points);
      END IF;

      INSERT INTO reward_points_log (profile_id, gym_id, points, action, description)
      VALUES (
        v_row.profile_id,
        v_challenge.gym_id,
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

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.award_challenge_prizes(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
