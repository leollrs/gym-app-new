-- ============================================================
-- 0042 — Add video_url to exercises + super_admin RLS for
--        challenges, gym_programs, achievement_definitions
-- ============================================================

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS video_url text;

-- Super-admin read access for challenges
CREATE POLICY "super_admin can read all challenges"
  ON challenges FOR SELECT
  USING (public.is_super_admin());

-- Super-admin write access for challenges (create/edit for any gym)
CREATE POLICY "super_admin can insert challenges"
  ON challenges FOR INSERT
  WITH CHECK (public.is_super_admin());

CREATE POLICY "super_admin can update challenges"
  ON challenges FOR UPDATE
  USING (public.is_super_admin());

CREATE POLICY "super_admin can delete challenges"
  ON challenges FOR DELETE
  USING (public.is_super_admin());

-- Super-admin read access for challenge_participants
CREATE POLICY "super_admin can read all challenge_participants"
  ON challenge_participants FOR SELECT
  USING (public.is_super_admin());

-- Super-admin access for gym_programs
CREATE POLICY "super_admin can read all gym_programs"
  ON gym_programs FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "super_admin can insert gym_programs"
  ON gym_programs FOR INSERT
  WITH CHECK (public.is_super_admin());

CREATE POLICY "super_admin can update gym_programs"
  ON gym_programs FOR UPDATE
  USING (public.is_super_admin());

CREATE POLICY "super_admin can delete gym_programs"
  ON gym_programs FOR DELETE
  USING (public.is_super_admin());

-- Super-admin access for achievement_definitions
CREATE POLICY "super_admin can read all achievement_definitions"
  ON achievement_definitions FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "super_admin can insert achievement_definitions"
  ON achievement_definitions FOR INSERT
  WITH CHECK (public.is_super_admin());

CREATE POLICY "super_admin can update achievement_definitions"
  ON achievement_definitions FOR UPDATE
  USING (public.is_super_admin());

CREATE POLICY "super_admin can delete achievement_definitions"
  ON achievement_definitions FOR DELETE
  USING (public.is_super_admin());

-- Super-admin read access for user_achievements (to count earned)
CREATE POLICY "super_admin can read all user_achievements"
  ON user_achievements FOR SELECT
  USING (public.is_super_admin());

-- Super-admin can update exercises (for editing global exercises)
CREATE POLICY "super_admin can update global exercises"
  ON exercises FOR UPDATE
  USING (public.is_super_admin());

-- Super-admin can read all exercises
CREATE POLICY "super_admin can read all exercises"
  ON exercises FOR SELECT
  USING (public.is_super_admin());
