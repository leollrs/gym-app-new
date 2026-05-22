-- 0429_lock_reward_economy.sql
-- SECURITY FIX (audit 2026-05) — close two confirmed economy holes:
--   #1 reward_points was member-writable: policy `reward_points_own` was
--      FOR ALL USING (profile_id = auth.uid()) with no WITH CHECK and no guard
--      trigger, so a member could `UPDATE reward_points SET total_points=999999`
--      directly via PostgREST and mint unlimited points.
--   #2 reward_redemptions allowed member self-INSERT (policy
--      "Members can insert own redemptions"), so a member could insert a
--      pending redemption (e.g. points_spent = 0) bypassing redeem_reward's
--      server-side cost/balance validation, then have it claimed for free.
--
-- All legitimate writes already go through SECURITY DEFINER RPCs
-- (add_reward_points / add_reward_points_checked, redeem_reward,
-- claim_redemption, cancel_redemption) which run as the function owner and
-- bypass RLS — so locking these tables to read-only for client roles breaks
-- nothing legitimate. The previous `reward_points_own` ALL policy already
-- scoped reads to the caller's own row, so replacing it with a SELECT policy
-- of the same predicate is read-equivalent (only the write capability is
-- removed).

-- ── reward_points: read own row only; never write directly ──
DROP POLICY IF EXISTS reward_points_own ON reward_points;
DROP POLICY IF EXISTS reward_points_select_own ON reward_points;
CREATE POLICY reward_points_select_own ON reward_points
  FOR SELECT USING (profile_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON reward_points FROM authenticated, anon;

-- ── reward_redemptions: members may not self-insert; redeem_reward (SECURITY
--    DEFINER) performs the validated insert. SELECT-of-own-rows is unchanged. ──
DROP POLICY IF EXISTS "Members can insert own redemptions" ON reward_redemptions;

REVOKE INSERT, UPDATE, DELETE ON reward_redemptions FROM authenticated, anon;

NOTIFY pgrst, 'reload schema';
