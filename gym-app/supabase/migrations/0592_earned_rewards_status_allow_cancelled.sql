-- Fix: removing a reward from a print card — the "Remove reward" button in the
-- reward modal, and the reward chip on "Coming up next" cards — failed with
--   new row for relation "earned_rewards" violates check constraint
--   "earned_rewards_status_check"
--
-- earned_rewards.status had CHECK (status IN ('pending','redeemed','expired'))
-- (migration 0370). But detach_reward_from_print_card (migration 0415, re-defined
-- in 0463) cancels the backing reward with:
--     UPDATE earned_rewards SET status = 'cancelled'
--      WHERE id = v_card.reward_id AND status = 'pending';
-- 'cancelled' was never added to the constraint, so the UPDATE raised a check
-- violation, the whole detach RPC rolled back, and the reward was never removed —
-- which is why the remove button did nothing. (Same class of bug as 0458, which
-- widened earned_rewards.source for the same feature.)
--
-- Widen the allowed set to include the status the code actually writes. This is
-- safe: every existing row already satisfies the narrower set, and member-facing
-- reward reads filter `status = 'pending'` (Rewards.jsx, scanActionHandlers.js),
-- so a 'cancelled' reward is correctly hidden from the member while the row is
-- retained for the admin reward log / audit trail.

ALTER TABLE public.earned_rewards
  DROP CONSTRAINT IF EXISTS earned_rewards_status_check;

ALTER TABLE public.earned_rewards
  ADD CONSTRAINT earned_rewards_status_check
  CHECK (status IN (
    'pending',
    'redeemed',
    'expired',
    'cancelled'
  ));
