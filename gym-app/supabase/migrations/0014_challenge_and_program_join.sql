-- ── Challenge: allow members to unjoin ────────────────────
CREATE POLICY "challenge_participants_delete_own" ON challenge_participants
  FOR DELETE USING (profile_id = auth.uid());

-- ── Gym program enrollments ───────────────────────────────
-- Tracks which members have enrolled in admin-created gym_programs.
CREATE TABLE gym_program_enrollments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id  UUID NOT NULL REFERENCES gym_programs(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT gym_program_enrollments_unique UNIQUE (program_id, profile_id)
);

CREATE INDEX idx_gpe_profile ON gym_program_enrollments(profile_id);
CREATE INDEX idx_gpe_program ON gym_program_enrollments(program_id);

ALTER TABLE gym_program_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gpe_select_own" ON gym_program_enrollments
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "gpe_insert_own" ON gym_program_enrollments
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );

CREATE POLICY "gpe_delete_own" ON gym_program_enrollments
  FOR DELETE USING (profile_id = auth.uid());

-- Admins can see all enrollments for their gym
CREATE POLICY "gpe_select_admin" ON gym_program_enrollments
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    AND public.is_admin()
  );
