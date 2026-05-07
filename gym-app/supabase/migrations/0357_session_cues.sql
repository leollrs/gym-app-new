-- ============================================================
-- 0357 — Trainer live-session coaching cues
-- ============================================================
-- Adds the backend for a trainer to send real-time cues into a
-- client's active workout session. The trainer side already has
-- the spectator UI in place (TrainerLiveSession.jsx); this layer
-- finally lets them adjust rest, drop sets, tweak weight, or
-- leave a note that pops on the client's screen mid-workout.
--
-- Deliberately a separate table from session_drafts: the client
-- writes to session_drafts constantly during a workout, so mixing
-- in trainer writes there guarantees overwrite races. Cues sit on
-- their own table with their own realtime channel.
-- ============================================================

-- ── 1. session_cues table ─────────────────────────────────────────────────
CREATE TABLE session_cues (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  trainer_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  cue_type        TEXT NOT NULL CHECK (cue_type IN ('rest_extend', 'weight_adjust', 'drop_set', 'note')),
  payload         JSONB,
  acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The client subscribes filtered by client_id; the trainer reads back their
-- own sent cues for an "ack received" indicator.
CREATE INDEX idx_session_cues_client    ON session_cues(client_id, created_at DESC);
CREATE INDEX idx_session_cues_trainer   ON session_cues(trainer_id, created_at DESC);
CREATE INDEX idx_session_cues_unack     ON session_cues(client_id) WHERE acknowledged = FALSE;

-- ── 2. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE session_cues ENABLE ROW LEVEL SECURITY;

-- Client reads their own cues.
CREATE POLICY session_cues_client_select ON session_cues
  FOR SELECT USING (client_id = auth.uid());

-- Trainer reads cues they sent.
CREATE POLICY session_cues_trainer_select ON session_cues
  FOR SELECT USING (trainer_id = auth.uid());

-- Client acknowledges (only flipping acknowledged + acknowledged_at on their
-- own cues). All inserts go through the trainer_send_cue RPC.
CREATE POLICY session_cues_client_ack ON session_cues
  FOR UPDATE USING (client_id = auth.uid()) WITH CHECK (client_id = auth.uid());

-- ── 3. Realtime publication ──────────────────────────────────────────────
-- Make session_cues subscribable via postgres_changes. ALTER PUBLICATION
-- requires the publication to already exist; supabase_realtime ships with
-- every Supabase project so this is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE session_cues;
  END IF;
END $$;

-- ── 4. trainer_send_cue RPC ──────────────────────────────────────────────
-- SECURITY DEFINER so we can verify the trainer-client assignment in one
-- atomic call, regardless of RLS evaluation order on multi-row INSERTs.
CREATE OR REPLACE FUNCTION trainer_send_cue(
  p_client_id  UUID,
  p_cue_type   TEXT,
  p_payload    JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainer_id UUID := auth.uid();
  v_gym_id     UUID;
  v_cue_id     UUID;
BEGIN
  IF v_trainer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller must be the trainer-of-record for this client (active assignment).
  -- Pull gym_id from the assignment row so we don't trust client-supplied data.
  SELECT gym_id INTO v_gym_id
    FROM trainer_clients
   WHERE trainer_id = v_trainer_id
     AND client_id  = p_client_id
     AND is_active  = TRUE
   LIMIT 1;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Not assigned as trainer for this client';
  END IF;

  -- Cue type whitelist (also enforced by CHECK constraint, but the explicit
  -- error message is more useful than a constraint violation).
  IF p_cue_type NOT IN ('rest_extend', 'weight_adjust', 'drop_set', 'note') THEN
    RAISE EXCEPTION 'Unknown cue type: %', p_cue_type;
  END IF;

  INSERT INTO session_cues (client_id, trainer_id, gym_id, cue_type, payload)
  VALUES (p_client_id, v_trainer_id, v_gym_id, p_cue_type, p_payload)
  RETURNING id INTO v_cue_id;

  RETURN v_cue_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_send_cue(UUID, TEXT, JSONB) TO authenticated;

-- ── 5. ack_session_cue RPC ───────────────────────────────────────────────
-- Wraps the UPDATE so the member-side code has a single explicit call.
-- (RLS policy session_cues_client_ack would also allow a direct UPDATE,
-- but exposing an RPC keeps the API surface stable.)
CREATE OR REPLACE FUNCTION ack_session_cue(p_cue_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE session_cues
     SET acknowledged    = TRUE,
         acknowledged_at = NOW()
   WHERE id = p_cue_id
     AND client_id = auth.uid()
     AND acknowledged = FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION ack_session_cue(UUID) TO authenticated;
