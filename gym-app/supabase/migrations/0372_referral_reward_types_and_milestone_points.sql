-- ============================================================
-- 0372 — Referral reward types + milestone points option
-- ============================================================
-- Two related fixes that finally make the AdminReferrals page
-- actually do what the form claims to save.
--
-- 1) gyms.referral_config was being SAVED by the admin UI but
--    NEVER READ by complete_referral(). The function was reading
--    from a non-existent `gym_referral_config` table and falling
--    through to a hardcoded 500 / 250 default for every gym.
--    Result: changes to "Recompensa del referidor" / "del referido"
--    appeared to save (toast said "Saved!") but had zero effect.
--    Fixed by rewriting complete_referral() to read the JSONB
--    config and honour either type='points' (custom amount) or
--    type='gym_reward' (member earns a claimable inventory item
--    via earned_rewards).
--
-- 2) referral_milestones could only point at a gym_reward FK —
--    no way to give pure points at a milestone. Added
--    points_amount column; exactly one of (reward_id,
--    points_amount) must be set. check_referral_milestones()
--    updated to award points when points_amount is set.
--
-- Storage shape on gyms.referral_config:
--   {
--     enabled: bool,
--     approval_required: bool,
--     max_per_month: int|null,
--     referrer_reward: { type: 'points', value: 250 }
--                    | { type: 'gym_reward', reward_id: '<uuid>' },
--     referred_reward: { type: 'points', value: 100 }
--                    | { type: 'gym_reward', reward_id: '<uuid>' }
--   }
-- ============================================================

-- ── 1. referral_milestones: allow points-only milestones ────
ALTER TABLE public.referral_milestones
  ADD COLUMN IF NOT EXISTS points_amount INTEGER;

-- reward_id needs to become nullable (was NOT NULL in 0187).
ALTER TABLE public.referral_milestones
  ALTER COLUMN reward_id DROP NOT NULL;

-- Exactly one of (reward_id, points_amount) must be set.
DO $$
BEGIN
  ALTER TABLE public.referral_milestones
    DROP CONSTRAINT IF EXISTS referral_milestones_reward_xor_points;
  ALTER TABLE public.referral_milestones
    ADD CONSTRAINT referral_milestones_reward_xor_points
    CHECK (
      (reward_id IS NOT NULL AND points_amount IS NULL)
      OR (reward_id IS NULL AND points_amount IS NOT NULL AND points_amount > 0)
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMENT ON COLUMN public.referral_milestones.points_amount IS
  'When set, milestone awards this many points instead of a gym_reward. Mutually exclusive with reward_id.';


-- ── 2. complete_referral(): read JSONB config, support both types ──
CREATE OR REPLACE FUNCTION public.complete_referral(p_referral_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref               RECORD;
  v_config            JSONB;
  v_referrer_reward   JSONB;
  v_referred_reward   JSONB;
  v_total_points      INT := 0;

  -- Local helper inlined per-row for clarity
  v_type              TEXT;
  v_value             INT;
  v_reward_id         UUID;
  v_dedup_key         TEXT;
BEGIN
  SELECT * INTO v_ref FROM referrals WHERE id = p_referral_id;
  IF NOT FOUND OR v_ref.status = 'completed' THEN
    RETURN;
  END IF;

  -- Mark completed first so duplicate triggers no-op
  UPDATE referrals
     SET status = 'completed', completed_at = NOW()
   WHERE id = p_referral_id;

  -- Pull the JSONB config saved by the admin UI
  SELECT referral_config INTO v_config FROM gyms WHERE id = v_ref.gym_id;
  IF v_config IS NULL THEN
    v_config := '{}'::jsonb;
  END IF;

  v_referrer_reward := COALESCE(
    v_config->'referrer_reward',
    jsonb_build_object('type', 'points', 'value', 250)
  );
  v_referred_reward := COALESCE(
    v_config->'referred_reward',
    jsonb_build_object('type', 'points', 'value', 100)
  );

  -- ── Referrer ────────────────────────────────────────────
  v_type := COALESCE(v_referrer_reward->>'type', 'points');

  IF v_type = 'gym_reward' THEN
    v_reward_id := NULLIF(v_referrer_reward->>'reward_id', '')::uuid;
    IF v_reward_id IS NOT NULL THEN
      v_dedup_key := 'referral_referrer_' || p_referral_id::text;
      PERFORM public.award_earned_reward(
        p_profile_id => v_ref.referrer_id,
        p_reward_id  => v_reward_id,
        p_source     => 'manual_grant',
        p_source_id  => p_referral_id,
        p_dedup_key  => v_dedup_key
      );
    END IF;
  ELSE
    -- points
    -- Tolerate legacy shape ({type:'points',points:5000}) and current shape ({...,value:N}).
    v_value := COALESCE(
      NULLIF(v_referrer_reward->>'value', '')::int,
      NULLIF(v_referrer_reward->>'points', '')::int,
      0
    );
    IF v_value > 0 THEN
      INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
      VALUES (v_ref.referrer_id, v_ref.gym_id, 'referral', v_value,
              'Referral reward: referred a new member', NOW());

      INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
      VALUES (v_ref.referrer_id, v_ref.gym_id, v_value, v_value, NOW())
      ON CONFLICT (profile_id) DO UPDATE SET
        total_points    = reward_points.total_points    + v_value,
        lifetime_points = reward_points.lifetime_points + v_value,
        last_updated    = NOW();

      v_total_points := v_total_points + v_value;
    END IF;
  END IF;

  -- ── Referred ────────────────────────────────────────────
  IF v_ref.referred_id IS NOT NULL THEN
    v_type := COALESCE(v_referred_reward->>'type', 'points');

    IF v_type = 'gym_reward' THEN
      v_reward_id := NULLIF(v_referred_reward->>'reward_id', '')::uuid;
      IF v_reward_id IS NOT NULL THEN
        v_dedup_key := 'referral_referred_' || p_referral_id::text;
        PERFORM public.award_earned_reward(
          p_profile_id => v_ref.referred_id,
          p_reward_id  => v_reward_id,
          p_source     => 'manual_grant',
          p_source_id  => p_referral_id,
          p_dedup_key  => v_dedup_key
        );
      END IF;
    ELSE
      v_value := COALESCE(
        NULLIF(v_referred_reward->>'value', '')::int,
        NULLIF(v_referred_reward->>'points', '')::int,
        0
      );
      IF v_value > 0 THEN
        INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
        VALUES (v_ref.referred_id, v_ref.gym_id, 'referral', v_value,
                'Referral reward: joined via referral', NOW());

        INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
        VALUES (v_ref.referred_id, v_ref.gym_id, v_value, v_value, NOW())
        ON CONFLICT (profile_id) DO UPDATE SET
          total_points    = reward_points.total_points    + v_value,
          lifetime_points = reward_points.lifetime_points + v_value,
          last_updated    = NOW();

        v_total_points := v_total_points + v_value;
      END IF;
    END IF;
  END IF;

  -- Stamp total points awarded on the referrals row (sum of both sides;
  -- gym_reward awards count as 0 for this number).
  UPDATE referrals SET points_awarded = v_total_points WHERE id = p_referral_id;

  -- Trigger milestone check
  PERFORM public.check_referral_milestones(v_ref.referrer_id);
END;
$$;


-- ── 3. check_referral_milestones(): support points-only ─────
CREATE OR REPLACE FUNCTION public.check_referral_milestones(p_referrer_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id     UUID;
  v_count      INT;
  v_awarded    INT := 0;
  v_milestone  RECORD;
  v_dedup_key  TEXT;
  v_earned_id  UUID;
  v_log_exists BOOLEAN;
BEGIN
  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = p_referrer_id;
  IF v_gym_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM referrals r
   WHERE r.referrer_id = p_referrer_id
     AND r.status = 'completed';

  FOR v_milestone IN
    SELECT id, referral_count, reward_id, points_amount
      FROM referral_milestones
     WHERE gym_id = v_gym_id
       AND is_active = true
       AND referral_count <= v_count
  LOOP
    v_dedup_key := 'milestone_' || p_referrer_id::text || '_' || v_milestone.id::text;

    IF v_milestone.reward_id IS NOT NULL THEN
      v_earned_id := public.award_earned_reward(
        p_profile_id => p_referrer_id,
        p_reward_id  => v_milestone.reward_id,
        p_source     => 'referral_milestone',
        p_source_id  => v_milestone.id,
        p_dedup_key  => v_dedup_key
      );
      IF v_earned_id IS NOT NULL THEN
        v_awarded := v_awarded + 1;
      END IF;

    ELSIF v_milestone.points_amount IS NOT NULL AND v_milestone.points_amount > 0 THEN
      -- Idempotency for points-type milestones: use reward_points_log
      -- description as a soft dedup (no unique key here, so check existence).
      SELECT EXISTS(
        SELECT 1 FROM reward_points_log
         WHERE profile_id = p_referrer_id
           AND action = 'referral_milestone'
           AND description = v_dedup_key
      ) INTO v_log_exists;

      IF NOT v_log_exists THEN
        INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
        VALUES (p_referrer_id, v_gym_id, 'referral_milestone',
                v_milestone.points_amount, v_dedup_key, NOW());

        INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
        VALUES (p_referrer_id, v_gym_id, v_milestone.points_amount, v_milestone.points_amount, NOW())
        ON CONFLICT (profile_id) DO UPDATE SET
          total_points    = reward_points.total_points    + v_milestone.points_amount,
          lifetime_points = reward_points.lifetime_points + v_milestone.points_amount,
          last_updated    = NOW();

        v_awarded := v_awarded + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_awarded;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_referral_milestones(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
