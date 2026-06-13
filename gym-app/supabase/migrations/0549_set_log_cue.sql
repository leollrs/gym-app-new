-- ============================================================
-- 0549 — Live-session set logging by the trainer ('set_log' cue)
-- ============================================================
-- TrainerLiveSession gains editable weight/reps: the trainer logs a
-- set FOR the client during a live session, so the client doesn't
-- have to touch their phone mid-workout. The write still flows
-- through the cue channel (NOT session_drafts directly — the member
-- app writes that row constantly, so direct trainer writes would
-- race). The member's ActiveSession receives the cue, applies it via
-- its normal set-completion path (PR detection, rest timer, draft
-- persistence), and the updated draft echoes back to the trainer's
-- live view in realtime.
--
-- Permission model: trainer_send_cue already requires an ACTIVE
-- trainer_clients assignment — being the client's trainer of record
-- IS the permission to log on their behalf.
--
-- payload shape: { exercise_id: uuid-ish text, set_index: int,
--                  weight: text, reps: text }
-- ============================================================

-- ── 1. Allow the new cue type ─────────────────────────────────────────────
ALTER TABLE session_cues DROP CONSTRAINT IF EXISTS session_cues_cue_type_check;
ALTER TABLE session_cues ADD CONSTRAINT session_cues_cue_type_check
  CHECK (cue_type IN ('rest_extend', 'weight_adjust', 'drop_set', 'note', 'set_log'));

-- ── 2. trainer_send_cue: extend the whitelist (body verbatim from 0357) ──
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
  IF p_cue_type NOT IN ('rest_extend', 'weight_adjust', 'drop_set', 'note', 'set_log') THEN
    RAISE EXCEPTION 'Unknown cue type: %', p_cue_type;
  END IF;

  INSERT INTO session_cues (client_id, trainer_id, gym_id, cue_type, payload)
  VALUES (p_client_id, v_trainer_id, v_gym_id, p_cue_type, p_payload)
  RETURNING id INTO v_cue_id;

  RETURN v_cue_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_send_cue(UUID, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
