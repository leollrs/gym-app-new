-- Fix: attaching a reward to a print card failed with
--   new row for relation "earned_rewards" violates check constraint
--   "earned_rewards_source_check"
--
-- earned_rewards.source had CHECK (source IN
--   ('birthday','referral_milestone','manual_grant'))  (migration 0370).
-- Two source values are written that were never added to the constraint:
--   • 'print_card'        — attach_reward_to_print_card (migration 0415)
--   • 'redemption_refund' — admin redemption refund via award_earned_reward
--                           (RewardLog.jsx → calls award_earned_reward)
-- So attaching a print-card reward (and refunding a redemption) both raised
-- a check-constraint violation. Widen the allowed set to every source the
-- code actually writes.

ALTER TABLE public.earned_rewards
  DROP CONSTRAINT IF EXISTS earned_rewards_source_check;

ALTER TABLE public.earned_rewards
  ADD CONSTRAINT earned_rewards_source_check
  CHECK (source IN (
    'birthday',
    'referral_milestone',
    'manual_grant',
    'print_card',
    'redemption_refund'
  ));
