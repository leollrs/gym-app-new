-- =============================================================
-- SECURITY HARDENING — ROUND 2
-- Migration: 0028_security_hardening_2.sql
-- Fixes: friendship accept abuse, challenge score injection,
--        avatar URL validation, data integrity constraints
-- =============================================================

-- ============================================================
-- 1. FRIENDSHIP ACCEPT — ONLY ADDRESSEE CAN ACCEPT
--    Previously either party could update status to 'accepted',
--    letting a requester force-accept their own request.
-- ============================================================

DROP POLICY IF EXISTS "friendships_access" ON friendships;

-- Both parties can read their friendships
CREATE POLICY "friendships_select" ON friendships
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND (requester_id = auth.uid() OR addressee_id = auth.uid())
  );

-- Only the requester can create a friendship request
CREATE POLICY "friendships_insert" ON friendships
  FOR INSERT WITH CHECK (
    gym_id = public.current_gym_id()
    AND requester_id = auth.uid()
  );

-- Only the addressee can accept/reject; either party can block
CREATE POLICY "friendships_update" ON friendships
  FOR UPDATE USING (
    gym_id = public.current_gym_id()
    AND (
      addressee_id = auth.uid()
      OR requester_id = auth.uid()
    )
  );

-- Trigger: only addressee can change status to 'accepted'
CREATE OR REPLACE FUNCTION public.guard_friendship_accept()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status != 'accepted' THEN
    IF auth.uid() != OLD.addressee_id THEN
      RAISE EXCEPTION 'Only the recipient can accept a friend request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_friendship_accept ON friendships;
CREATE TRIGGER trg_guard_friendship_accept
  BEFORE UPDATE ON friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_friendship_accept();

-- Either party can delete (unfriend)
CREATE POLICY "friendships_delete" ON friendships
  FOR DELETE USING (
    gym_id = public.current_gym_id()
    AND (requester_id = auth.uid() OR addressee_id = auth.uid())
  );

-- ============================================================
-- 2. CHALLENGE SCORE INTEGRITY
--    Prevent members from inserting arbitrary scores.
--    New participants must join with score = 0.
--    Score updates should only come from server-side logic.
-- ============================================================

-- Trigger: force score = 0 on initial join
CREATE OR REPLACE FUNCTION public.guard_challenge_score_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Members can only join with score 0 — backfill must happen server-side
  IF NEW.score != 0 AND NOT public.is_admin() THEN
    NEW.score := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_challenge_score_insert ON challenge_participants;
CREATE TRIGGER trg_guard_challenge_score_insert
  BEFORE INSERT ON challenge_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_challenge_score_insert();

-- Prevent members from directly updating their own score
-- (scores should be updated by DB triggers on workout_sessions/PRs)
CREATE OR REPLACE FUNCTION public.guard_challenge_score_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.score IS DISTINCT FROM OLD.score AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Challenge scores cannot be modified directly';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_challenge_score_update ON challenge_participants;
CREATE TRIGGER trg_guard_challenge_score_update
  BEFORE UPDATE ON challenge_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_challenge_score_update();

-- ============================================================
-- 3. AVATAR URL VALIDATION
--    Prevent javascript: or data: scheme injection in avatar URLs
-- ============================================================

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_avatar_url_safe;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_avatar_url_safe
  CHECK (
    avatar_url IS NULL
    OR avatar_url = ''
    OR avatar_url LIKE 'https://%'
  );

-- ============================================================
-- 4. DATA INTEGRITY — WORKOUT VALUES
--    Prevent negative/zero values that would corrupt PRs and
--    leaderboard calculations
-- ============================================================

-- session_sets: weight and reps must be non-negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_sets_weight_positive'
  ) THEN
    ALTER TABLE session_sets
      ADD CONSTRAINT session_sets_weight_positive CHECK (weight_lbs IS NULL OR weight_lbs >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_sets_reps_positive'
  ) THEN
    ALTER TABLE session_sets
      ADD CONSTRAINT session_sets_reps_positive CHECK (reps IS NULL OR reps >= 0);
  END IF;
END $$;

-- personal_records: weight, reps, and estimated 1RM must be positive
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pr_weight_positive'
  ) THEN
    ALTER TABLE personal_records
      ADD CONSTRAINT pr_weight_positive CHECK (weight_lbs > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pr_reps_positive'
  ) THEN
    ALTER TABLE personal_records
      ADD CONSTRAINT pr_reps_positive CHECK (reps > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pr_1rm_positive'
  ) THEN
    ALTER TABLE personal_records
      ADD CONSTRAINT pr_1rm_positive CHECK (estimated_1rm > 0);
  END IF;
END $$;
