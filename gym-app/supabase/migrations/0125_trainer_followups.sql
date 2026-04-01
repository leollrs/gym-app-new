-- Trainer follow-up tracking: moves contact tracking from localStorage to DB
-- and enables structured reach-out logging per at-risk client.

CREATE TABLE trainer_followups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id)     ON DELETE CASCADE,
  method      TEXT NOT NULL CHECK (method IN ('sms','push','email','call','in_person')),
  note        TEXT,
  outcome     TEXT CHECK (outcome IN ('no_answer','rescheduled','coming_back','not_interested','other')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_trainer_followups_trainer ON trainer_followups(trainer_id);
CREATE INDEX idx_trainer_followups_client  ON trainer_followups(client_id);

-- RLS: trainers can only manage their own followups
ALTER TABLE trainer_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trainers can view own followups"
  ON trainer_followups FOR SELECT
  USING (trainer_id = auth.uid());

CREATE POLICY "Trainers can insert own followups"
  ON trainer_followups FOR INSERT
  WITH CHECK (trainer_id = auth.uid());

CREATE POLICY "Trainers can update own followups"
  ON trainer_followups FOR UPDATE
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

CREATE POLICY "Trainers can delete own followups"
  ON trainer_followups FOR DELETE
  USING (trainer_id = auth.uid());
