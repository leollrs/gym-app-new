-- ============================================================
-- 0327 — Soft-delete workout sessions with 24h restore window
-- ============================================================
-- When a member deletes a workout we no longer hard-delete it.
-- Instead:
--   1. The session + exercises + sets are snapshotted into
--      deleted_session_backups as a JSONB blob.
--   2. The points the session earned (workout_completed + per-PR)
--      are refunded so deleting an erroneous workout doesn't leave
--      ghost XP behind.
--   3. Backups expire after 24 hours; until then the user can
--      restore the session (and the points) via restore_deleted_session().
--
-- Refund formula intentionally only undoes the deterministic awards
-- (50 base + 100 per PR set). Streak-bonus and "first weekly workout"
-- awards depend on context that can't be reconstructed safely after
-- the fact, so they're left in place.
-- ============================================================

CREATE TABLE IF NOT EXISTS deleted_session_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  original_session_id UUID NOT NULL,
  payload JSONB NOT NULL,
  points_refunded INT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_deleted_session_backups_profile
  ON deleted_session_backups(profile_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_session_backups_expiry
  ON deleted_session_backups(expires_at);

ALTER TABLE deleted_session_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deleted_session_backups_owner_select ON deleted_session_backups;
CREATE POLICY deleted_session_backups_owner_select ON deleted_session_backups
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS deleted_session_backups_owner_delete ON deleted_session_backups;
CREATE POLICY deleted_session_backups_owner_delete ON deleted_session_backups
  FOR DELETE USING (profile_id = auth.uid());

-- ── Helper: opportunistic cleanup of expired backups ─────────
CREATE OR REPLACE FUNCTION cleanup_expired_session_backups()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM deleted_session_backups WHERE expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Soft delete: snapshot, refund points, then delete ────────
CREATE OR REPLACE FUNCTION soft_delete_workout_session(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_gym_id    UUID;
  v_session   workout_sessions%ROWTYPE;
  v_payload   JSONB;
  v_pr_count  INT := 0;
  v_refund    INT := 0;
  v_backup_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_session
    FROM workout_sessions
   WHERE id = p_session_id AND profile_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or not owned by caller';
  END IF;

  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;
  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile missing gym_id';
  END IF;

  -- Snapshot session + child rows into a single JSONB blob.
  v_payload := jsonb_build_object(
    'session', to_jsonb(v_session),
    'exercises', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'exercise', to_jsonb(se),
          'sets', (
            SELECT COALESCE(jsonb_agg(to_jsonb(ss) ORDER BY ss.set_number), '[]'::jsonb)
              FROM session_sets ss
             WHERE ss.session_exercise_id = se.id
          )
        ) ORDER BY se.position
      ), '[]'::jsonb)
        FROM session_exercises se
       WHERE se.session_id = p_session_id
    )
  );

  -- Count PR sets in this session for the refund calculation.
  SELECT COALESCE(SUM(CASE WHEN ss.is_pr THEN 1 ELSE 0 END), 0)
    INTO v_pr_count
    FROM session_exercises se
    JOIN session_sets      ss ON ss.session_exercise_id = se.id
   WHERE se.session_id = p_session_id;

  IF v_session.status = 'completed' THEN
    v_refund := 50 + (100 * v_pr_count);
  END IF;

  -- Persist the snapshot.
  INSERT INTO deleted_session_backups (
    profile_id, gym_id, original_session_id, payload, points_refunded
  ) VALUES (
    v_user_id, v_gym_id, p_session_id, v_payload, v_refund
  ) RETURNING id INTO v_backup_id;

  -- Refund the deterministic XP/points and log the deduction.
  IF v_refund > 0 THEN
    UPDATE reward_points
       SET total_points    = GREATEST(0, total_points - v_refund),
           lifetime_points = GREATEST(0, lifetime_points - v_refund),
           last_updated    = NOW()
     WHERE profile_id = v_user_id;

    INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
    VALUES (
      v_user_id, v_gym_id, 'session_deleted', -v_refund,
      'Session deleted: ' || COALESCE(v_session.name, 'Workout'), NOW()
    );

    -- Drop personal_records rows attached to this session — they'd be stale.
    DELETE FROM personal_records
     WHERE profile_id = v_user_id AND session_id = p_session_id;
  END IF;

  -- Delete the session. Foreign keys cascade to session_exercises +
  -- session_sets (and any other child tables that ON DELETE CASCADE).
  DELETE FROM workout_sessions WHERE id = p_session_id;

  -- Opportunistic cleanup so the backup table doesn't grow unbounded.
  PERFORM cleanup_expired_session_backups();

  RETURN jsonb_build_object(
    'backup_id',       v_backup_id,
    'points_refunded', v_refund
  );
END;
$$;

-- ── Restore a soft-deleted session within the 24h window ─────
CREATE OR REPLACE FUNCTION restore_deleted_session(p_backup_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_backup         deleted_session_backups%ROWTYPE;
  v_session        JSONB;
  v_new_session_id UUID;
  v_ex             JSONB;
  v_se_id          UUID;
  v_set            JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_backup
    FROM deleted_session_backups
   WHERE id = p_backup_id AND profile_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;
  IF v_backup.expires_at < NOW() THEN
    RAISE EXCEPTION 'Backup has expired (24h window passed)';
  END IF;

  v_session := v_backup.payload->'session';

  -- Reuse the original session id when available so any external
  -- references (achievements, references in other tables, etc.) stay valid.
  INSERT INTO workout_sessions (
    id, profile_id, gym_id, routine_id, name, status,
    started_at, completed_at, duration_seconds, total_volume_lbs
  ) VALUES (
    COALESCE(NULLIF(v_session->>'id', '')::UUID, gen_random_uuid()),
    v_user_id,
    v_backup.gym_id,
    NULLIF(v_session->>'routine_id', '')::UUID,
    v_session->>'name',
    v_session->>'status',
    (v_session->>'started_at')::TIMESTAMPTZ,
    NULLIF(v_session->>'completed_at', '')::TIMESTAMPTZ,
    COALESCE((v_session->>'duration_seconds')::INT, 0),
    COALESCE((v_session->>'total_volume_lbs')::NUMERIC, 0)
  )
  RETURNING id INTO v_new_session_id;

  FOR v_ex IN SELECT jsonb_array_elements(v_backup.payload->'exercises')
  LOOP
    INSERT INTO session_exercises (session_id, exercise_id, snapshot_name, position)
    VALUES (
      v_new_session_id,
      v_ex->'exercise'->>'exercise_id',
      v_ex->'exercise'->>'snapshot_name',
      COALESCE((v_ex->'exercise'->>'position')::INT, 0)
    )
    RETURNING id INTO v_se_id;

    FOR v_set IN SELECT jsonb_array_elements(v_ex->'sets')
    LOOP
      INSERT INTO session_sets (
        session_exercise_id, set_number, weight_lbs, reps,
        is_completed, is_pr, estimated_1rm
      ) VALUES (
        v_se_id,
        COALESCE((v_set->>'set_number')::INT, 1),
        COALESCE((v_set->>'weight_lbs')::NUMERIC, 0),
        COALESCE((v_set->>'reps')::INT, 0),
        COALESCE((v_set->>'is_completed')::BOOLEAN, true),
        COALESCE((v_set->>'is_pr')::BOOLEAN, false),
        COALESCE((v_set->>'estimated_1rm')::NUMERIC, 0)
      );
    END LOOP;
  END LOOP;

  -- Re-credit the refunded points.
  IF v_backup.points_refunded > 0 THEN
    INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
    VALUES (v_user_id, v_backup.gym_id, v_backup.points_refunded, v_backup.points_refunded, NOW())
    ON CONFLICT (profile_id) DO UPDATE SET
      total_points    = reward_points.total_points + v_backup.points_refunded,
      lifetime_points = reward_points.lifetime_points + v_backup.points_refunded,
      last_updated    = NOW();

    INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
    VALUES (
      v_user_id, v_backup.gym_id, 'session_restored', v_backup.points_refunded,
      'Restored deleted session', NOW()
    );
  END IF;

  DELETE FROM deleted_session_backups WHERE id = p_backup_id;

  RETURN jsonb_build_object(
    'session_id',      v_new_session_id,
    'points_restored', v_backup.points_refunded
  );
END;
$$;

GRANT EXECUTE ON FUNCTION soft_delete_workout_session(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION restore_deleted_session(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_session_backups()        TO authenticated;

NOTIFY pgrst, 'reload schema';
