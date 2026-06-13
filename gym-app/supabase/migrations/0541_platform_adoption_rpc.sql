-- =============================================================
-- 0541_platform_adoption_rpc.sql
--
-- P1-2 (platform audit 2026-06-11): FeatureAdoption.jsx read 12 feature
-- tables directly; 8 of them (gym_classes, win_back_attempts, conversations,
-- referral_codes, referral_milestones, nps_responses, announcements,
-- member_segments) have NO cross-gym super_admin SELECT arm, so the heatmap
-- silently reported "Never used" for features gyms use daily. The reads were
-- also unordered .limit(5000) caps (wrong at scale).
--
-- Fix: one SECURITY DEFINER RPC that aggregates feature usage server-side —
-- one row per (gym, feature) with honest definitions:
--   classes          gym_classes          (a class exists)
--   challenges       challenges
--   winback          win_back_attempts
--   messaging        conversations        (recency = last_message_at)
--   programs         gym_programs
--   referrals        referral_codes
--   referral_rewards referral_milestones  (referral reward config)
--   nps              nps_responses
--   announcements    announcements
--   store            gym_products
--   segments         member_segments
--   rewards          gym_rewards          (the actual rewards system —
--                                          was misread from referral_milestones)
-- The fake "analytics" feature (churn cron rows ≠ admin usage) is DROPPED.
-- recent_count = rows in the last 90 days by the table's natural timestamp.
--
-- Also here: additive super_admin SELECT arms for
--   • admin_presence — unblocks the Admin Engagement section + GymHealth's
--     "Admin Inactive" insight (0209 policy is own-gym only)
--   • streak_cache   — unblocks the support console streak tile
--     (0354 policy gates super_admin to current_gym_id())
--
-- Idempotent. super_admin only.
-- =============================================================

-- ── 1 · platform_feature_adoption() ──────────────────────────
CREATE OR REPLACE FUNCTION public.platform_feature_adoption()
RETURNS TABLE (
  gym_id       UUID,
  feature      TEXT,
  ever_count   INT,
  recent_count INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := now() - INTERVAL '90 days';
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  RETURN QUERY
  SELECT t.gym_id, 'classes'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM gym_classes t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'challenges'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM challenges t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'winback'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM win_back_attempts t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'messaging'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE COALESCE(t.last_message_at, t.created_at) >= v_cutoff)::INT
  FROM conversations t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'programs'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM gym_programs t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'referrals'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM referral_codes t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'referral_rewards'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM referral_milestones t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'nps'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM nps_responses t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'announcements'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM announcements t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'store'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM gym_products t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'segments'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM member_segments t GROUP BY t.gym_id
  UNION ALL
  SELECT t.gym_id, 'rewards'::TEXT, COUNT(*)::INT,
         COUNT(*) FILTER (WHERE t.created_at >= v_cutoff)::INT
  FROM gym_rewards t GROUP BY t.gym_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_feature_adoption() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_feature_adoption() TO authenticated;

-- ── 2 · admin_presence: super_admin cross-gym SELECT ─────────
-- Additive permissive policy — ORs with 0209's own-gym staff policy.
DROP POLICY IF EXISTS admin_presence_super_admin_select ON public.admin_presence;
CREATE POLICY admin_presence_super_admin_select ON public.admin_presence
  FOR SELECT
  USING (public.is_super_admin());

-- ── 3 · streak_cache: super_admin cross-gym SELECT ───────────
-- 0354's streak_cache_select gates super_admin to current_gym_id(); the
-- support console needs streaks for ANY gym. Additive arm, read-only.
DROP POLICY IF EXISTS streak_cache_super_admin_select ON public.streak_cache;
CREATE POLICY streak_cache_super_admin_select ON public.streak_cache
  FOR SELECT
  USING (public.is_super_admin());

NOTIFY pgrst, 'reload schema';
