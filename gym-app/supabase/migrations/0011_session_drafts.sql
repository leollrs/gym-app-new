-- Session Drafts: persists in-progress workout state to the DB so it
-- survives browser restarts and iOS Safari memory wipes.
-- One row per (profile, routine) — upserted on every important state change.
-- Rows older than 24 hours are ignored on read and deleted on session finish.

CREATE TABLE session_drafts (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id                 UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  routine_id             UUID NOT NULL,
  routine_name           TEXT,
  started_at             TIMESTAMPTZ NOT NULL,
  elapsed_time           INTEGER NOT NULL DEFAULT 0,
  logged_sets            JSONB NOT NULL DEFAULT '{}',
  session_prs            JSONB NOT NULL DEFAULT '[]',
  live_prs               JSONB NOT NULL DEFAULT '{}',
  current_exercise_index INTEGER NOT NULL DEFAULT 0,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (profile_id, routine_id)
);

ALTER TABLE session_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drafts_all_own" ON session_drafts
  FOR ALL USING (profile_id = auth.uid())
  WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = public.current_gym_id()
  );
