-- Fix HIGH security issue: trainer could update ANY column on ANY profile in their gym.
-- Replace the overly permissive UPDATE policy with a SECURITY DEFINER function
-- that only allows trainers to update the assigned_program_id column.

-- 1. Drop the overly permissive trainer UPDATE policy
DROP POLICY IF EXISTS "profiles_trainer_assign_program" ON profiles;

-- 2. Create a SECURITY DEFINER function that restricts trainers to only updating assigned_program_id
CREATE OR REPLACE FUNCTION public.trainer_assign_program(p_member_id UUID, p_program_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_gym_id UUID;
  v_member_gym_id UUID;
BEGIN
  -- Verify the caller is a trainer
  IF public.current_user_role() <> 'trainer' THEN
    RAISE EXCEPTION 'Only trainers can assign programs';
  END IF;

  -- Get the caller's gym_id
  SELECT gym_id INTO v_caller_gym_id
  FROM profiles
  WHERE id = auth.uid();

  -- Get the target member's gym_id
  SELECT gym_id INTO v_member_gym_id
  FROM profiles
  WHERE id = p_member_id;

  -- Verify the target member exists
  IF v_member_gym_id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Verify the trainer and member are in the same gym
  IF v_caller_gym_id <> v_member_gym_id THEN
    RAISE EXCEPTION 'Cannot assign programs to members outside your gym';
  END IF;

  -- Only update the assigned_program_id column
  UPDATE profiles
  SET assigned_program_id = p_program_id
  WHERE id = p_member_id
    AND gym_id = v_caller_gym_id;
END;
$$;

-- 3. Revoke direct execute from public, grant only to authenticated users
REVOKE ALL ON FUNCTION public.trainer_assign_program(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trainer_assign_program(UUID, UUID) TO authenticated;
