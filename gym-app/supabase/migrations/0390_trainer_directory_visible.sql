-- ============================================================
-- 0390: Trainer directory visibility
-- Adds an opt-out flag for the "Trainers at your gym" directory
-- on the MyGym page. Defaults to TRUE so existing trainers show
-- up out of the box; trainers can flip it off from their Privacy
-- settings to hide themselves from the public directory.
--
-- This is independent of `privacy_public` (which controls
-- workout/leaderboard stats visibility for ALL profiles, not
-- just trainers). We didn't reuse it because:
--   1. privacy_public defaults to FALSE, so reusing it would
--      hide every existing trainer until they manually toggle.
--   2. Member stat privacy and trainer directory listing are
--      different concerns — overloading one column makes both
--      confusing to reason about.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trainer_directory_visible BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.profiles.trainer_directory_visible IS
  'When TRUE, this trainer appears in the gym''s public trainer directory '
  '(MyGym page → Trainers section). When FALSE, only the trainer''s assigned '
  'clients can find the public profile. Members and admins are unaffected.';
