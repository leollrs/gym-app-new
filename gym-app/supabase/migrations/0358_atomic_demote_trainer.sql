-- ============================================================================
-- 0358 — Atomic trainer demote
-- ============================================================================
-- Wraps the two writes that demote a trainer to a member into a single
-- transaction so partial failures can't leave a trainer with role='member'
-- but their `trainer_clients` rows still active (zombie state that the
-- AdminTrainers UI saw before this migration).
--
-- Steps performed atomically:
--   1) Verify caller is an admin/super_admin in the trainer's gym.
--   2) Verify the target user is currently a `trainer` in the same gym.
--   3) Deactivate every `trainer_clients` row for that trainer.
--   4) Flip `profiles.role` from 'trainer' to 'member' (only if still trainer).
--
-- If any step fails the whole transaction rolls back. The client
-- (AdminTrainers.jsx) keeps its compensating-rollback path as a belt for the
-- old non-atomic flow's stale callers, but new calls should use this RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION demote_trainer_atomically(p_trainer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainer_gym_id UUID;
  v_caller_role TEXT;
  v_caller_gym_id UUID;
BEGIN
  -- 1. Look up the target trainer's gym + current role.
  SELECT gym_id INTO v_trainer_gym_id
  FROM profiles
  WHERE id = p_trainer_id AND role = 'trainer';

  IF v_trainer_gym_id IS NULL THEN
    RAISE EXCEPTION 'Target user is not a trainer or does not exist'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Verify caller is an admin/super_admin in the trainer's gym.
  SELECT role, gym_id INTO v_caller_role, v_caller_gym_id
  FROM profiles
  WHERE id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = 'P0001';
  END IF;

  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins can demote trainers' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role = 'admin' AND v_caller_gym_id IS DISTINCT FROM v_trainer_gym_id THEN
    RAISE EXCEPTION 'Admin cannot demote a trainer in another gym'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Deactivate trainer_clients rows for this trainer (gym-scoped).
  UPDATE trainer_clients
  SET is_active = FALSE
  WHERE trainer_id = p_trainer_id
    AND gym_id = v_trainer_gym_id;

  -- 4. Flip role. Conditional WHERE protects against a concurrent role change
  --    (e.g. another admin demoted them between our SELECT and UPDATE).
  UPDATE profiles
  SET role = 'member'
  WHERE id = p_trainer_id
    AND gym_id = v_trainer_gym_id
    AND role = 'trainer';

  IF NOT FOUND THEN
    -- Target's role changed mid-flight. Roll back trainer_clients update by
    -- raising — the surrounding transaction will undo the deactivation above.
    RAISE EXCEPTION 'Trainer role changed during demote (concurrent edit)'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION demote_trainer_atomically(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demote_trainer_atomically(UUID) TO authenticated;

COMMENT ON FUNCTION demote_trainer_atomically(UUID) IS
  'Atomically demotes a trainer: deactivates their trainer_clients rows and '
  'flips role=trainer→member in a single transaction. Caller must be admin/'
  'super_admin in the trainer''s gym. Raises 42501 (insufficient privilege) '
  'or P0001 (data consistency) on failure.';
