-- Add reward-claim tables to the supabase_realtime publication so the
-- member's app can subscribe and react instantly when an admin approves
-- a reward / earned reward / challenge prize at the front desk.
--
-- Before this migration:
--   1. Member redeems → reward_redemptions row inserted with status='pending'
--   2. Member walks up to the front desk and shows their QR
--   3. Admin scans + approves → row UPDATE-d to status='claimed'
--   4. Member's app keeps showing the redemption as "pending" until they
--      pull-to-refresh — confusing UX, looks broken
--
-- After this migration the member's app holds a realtime channel listening
-- for UPDATE events on these tables filtered by profile_id, so the row
-- disappears from the pending list within a second of admin approval.
--
-- Idempotent: ALTER PUBLICATION ADD TABLE is a no-op when the table is
-- already in the publication, so this migration is safe to re-run.
--
-- Safety: RLS still applies to realtime payloads — a member only ever
-- receives events for rows they own (profile_id=auth.uid()), which is
-- enforced by the existing SELECT policy on each table. The publication
-- doesn't bypass policy.

DO $$
BEGIN
  -- reward_redemptions — points-funded rewards (paid with member points)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'reward_redemptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reward_redemptions;
  END IF;

  -- earned_rewards — birthday / milestone / manually granted rewards
  -- (status flips pending → claimed when admin scans the earned-reward QR)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'earned_rewards'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.earned_rewards;
  END IF;

  -- challenge_prizes — rewards from completing challenges
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'challenge_prizes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_prizes;
  END IF;
END $$;
