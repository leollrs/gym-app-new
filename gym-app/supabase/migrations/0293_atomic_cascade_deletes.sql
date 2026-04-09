-- S15: Atomic cascade deletes for challenges and classes
-- Wraps multi-step deletes in transactions so partial failures can't leave orphaned data.

-- ── Challenge delete ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_delete_challenge(p_challenge_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be the admin of the gym that owns this challenge
  IF NOT EXISTS (
    SELECT 1 FROM challenges c
    JOIN profiles p ON p.gym_id = c.gym_id
    WHERE c.id = p_challenge_id
      AND p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Challenge not found or access denied';
  END IF;

  DELETE FROM challenge_participants     WHERE challenge_id = p_challenge_id;
  DELETE FROM daily_challenge_completions WHERE challenge_id = p_challenge_id;

  DELETE FROM challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found or access denied';
  END IF;
END;
$$;

-- ── Class delete ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_delete_class(p_class_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be the admin of the gym that owns this class
  IF NOT EXISTS (
    SELECT 1 FROM gym_classes gc
    JOIN profiles p ON p.gym_id = gc.gym_id
    WHERE gc.id = p_class_id
      AND p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Class not found or access denied';
  END IF;

  DELETE FROM gym_class_schedules WHERE class_id = p_class_id;
  DELETE FROM gym_class_bookings  WHERE class_id = p_class_id;

  DELETE FROM gym_classes WHERE id = p_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class not found or access denied';
  END IF;
END;
$$;

-- Grant execute to authenticated users (RLS enforced inside the functions)
GRANT EXECUTE ON FUNCTION public.admin_delete_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_class(UUID)     TO authenticated;
