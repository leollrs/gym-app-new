-- 0490_clamp_challenge_prize_points.sql
--
-- Economy hardening: cap challenge-prize points server-side.
--
-- award_challenge_prizes reads the per-placement points straight from the
-- admin-authored challenges.reward_description JSON:
--     v_points := COALESCE((v_reward->>'points')::INT, 0);
-- and credits it verbatim to reward_points (total + lifetime). The
-- ChallengeModal points input was unbounded, so an admin could type (or a
-- crafted reward_description could carry) an arbitrary value — minting unlimited
-- points to the top-3 finishers. The client now clamps to 100,000; this is the
-- matching SERVER cap so the clamp can't be bypassed via a direct
-- challenges.insert + award call.
--
-- This reproduces the live (0471) function body VERBATIM except for one added
-- line clamping v_points to [0, 100000]. Everything else — multi-role admin
-- check, gym scope, dup-award guard, QR generation, logging — is unchanged.
--
-- ⚠️ Apply via Supabase Dashboard SQL Editor. Smoke-test: award prizes on a test
--    challenge whose reward_description has points: 999999 → finisher receives
--    exactly 100000.

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
    -- Cap admin-authored prize points to [0, 100000]. Negative/garbage → 0,
    -- absurd values → 100000. Mirrors the ChallengeModal client clamp so the
    -- bound holds even against a direct challenges.insert + award call.
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
