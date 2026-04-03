-- Add a per-conversation encryption seed so that message encryption
-- keys are derived from a value stored in the DB rather than a
-- hardcoded client-side secret.
--
-- The seed is a random UUID string, unique per conversation.
-- Existing RLS on the conversations table already restricts reads
-- to conversation participants only.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS encryption_seed TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- Backfill existing conversations that somehow got a NULL seed
-- (shouldn't happen due to DEFAULT, but belt-and-suspenders).
UPDATE conversations SET encryption_seed = gen_random_uuid()::text
  WHERE encryption_seed IS NULL;
