-- Fix 1: Server-side daily challenge completion tracking
CREATE TABLE IF NOT EXISTS daily_challenge_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  challenge_date DATE NOT NULL DEFAULT CURRENT_DATE,
  points_awarded INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, challenge_date)
);

ALTER TABLE daily_challenge_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_completions_select" ON daily_challenge_completions
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "own_completions_insert" ON daily_challenge_completions
  FOR INSERT WITH CHECK (profile_id = auth.uid());
-- No UPDATE or DELETE - completions are immutable

-- Fix 2: Admin notification INSERT policy
-- Currently only policy is FOR ALL USING (profile_id = auth.uid()) which blocks admin inserts
CREATE POLICY "notifications_insert_admin" ON notifications
  FOR INSERT WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = notifications.profile_id
      AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    )
  );
