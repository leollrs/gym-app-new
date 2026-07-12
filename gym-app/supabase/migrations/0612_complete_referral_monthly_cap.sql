-- ============================================================
-- 0612 — complete_referral: enforce max_per_month + lock completion
-- ============================================================
-- TWO bugs, one function.
--
-- (1) DEAD CONFIG — gyms.referral_config.max_referrals_per_month is SAVED by
--     the admin UI (ReferralProgramConfig.jsx writes exactly this key) but
--     NEVER read by complete_referral — the LIVE path (safe_complete_referral
--     → complete_referral). Every completed referral awarded the referrer with
--     no monthly ceiling, so the anti-farming cap the owner set did nothing.
--     (The 0372 header's `max_per_month` was aspirational — the real key the
--     UI persists is `max_referrals_per_month`, matching complete_referral_
--     deferred's existing cap check.)
--
-- (2) TOCTOU — the function reads the referral, checks status='completed',
--     then UPDATEs, with no lock. Two concurrent completions (approval double-
--     click, retried webhook) could both pass the guard and double-award BOTH
--     sides. Added `FOR UPDATE` on the initial read to serialize completion.
--
-- BEHAVIOR DECISION for the cap (documented so it can be reviewed on test):
--   * max_referrals_per_month caps how many times the REFERRER earns the
--     referrer reward within the current calendar month, evaluated in the
--     gym's local timezone (America/Puerto_Rico) so it matches the owner's
--     sense of "this month".
--   * NULL / absent  = unlimited (unchanged behavior).
--   * When the referrer is over the cap:
--       - the referral STILL completes (recorded, not stuck/retried),
--       - the REFERRED friend STILL gets their welcome reward — they're a
--         blameless new member and punishing them would hurt acquisition,
--       - lifetime referral MILESTONES are still checked (they're one-time,
--         deduped, and reflect real completed referrals — not monthly farming),
--       - ONLY the referrer's per-referral reward (points or gym_reward) is
--         skipped. points_awarded is stamped with what was actually granted.
--   * NOTE — this is intentionally MORE LENIENT than complete_referral_deferred
--     (the alternate "reward-choice" flow), which REJECTS the whole referral
--     when over cap (referred friend gets nothing). The live path is this
--     function; the lenient behavior is the deliberate choice. Reconcile the
--     two if the deferred flow is ever wired as the primary path.
--
-- Everything else is reproduced VERBATIM from 0372 (the authoritative def).
-- ============================================================

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

  -- Monthly-cap state
  v_max_per_month     INT;
  v_month_count       INT;
  v_referrer_capped   BOOLEAN := false;

  -- Local helper inlined per-row for clarity
  v_type              TEXT;
  v_value             INT;
  v_reward_id         UUID;
  v_dedup_key         TEXT;
BEGIN
  -- FOR UPDATE: serialize concurrent completions of the same referral so the
  -- status guard + awards below run exactly once.
  SELECT * INTO v_ref FROM referrals WHERE id = p_referral_id FOR UPDATE;
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

  -- ── Monthly cap on the REFERRER reward ──────────────────────
  -- Count this referrer's referrals completed in the current PR-local month
  -- (includes the one we just marked completed above). Over the cap → the
  -- referrer reward is skipped; the referred reward + milestones still run.
  v_max_per_month := NULLIF(v_config->>'max_referrals_per_month', '')::int;
  IF v_max_per_month IS NOT NULL THEN
    SELECT COUNT(*) INTO v_month_count
      FROM referrals r
     WHERE r.referrer_id = v_ref.referrer_id
       AND r.status = 'completed'
       AND (r.completed_at AT TIME ZONE 'America/Puerto_Rico')
           >= date_trunc('month', (now() AT TIME ZONE 'America/Puerto_Rico'));
    v_referrer_capped := v_month_count > v_max_per_month;
  END IF;

  -- ── Referrer (skipped when over the monthly cap) ────────────
  IF NOT v_referrer_capped THEN
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

NOTIFY pgrst, 'reload schema';
