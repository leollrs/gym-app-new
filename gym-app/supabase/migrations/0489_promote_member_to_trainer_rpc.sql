-- 0489_promote_member_to_trainer_rpc.sql
--
-- Symmetry fix for trainer role management. demote_trainer_atomically (0358 →
-- 0471) is a hardened, gym-clamped, additional_roles-aware SECURITY DEFINER RPC.
-- Promotion, however, was a raw client-side `UPDATE profiles SET role='trainer'`
-- with only an `.eq('gym_id', gymId)` filter — i.e. the only real guard was RLS,
-- and it BLINDLY OVERWROTE the primary role (so promoting an admin who is also a
-- member would clobber their admin primary role; and a member who was an admin
-- via additional_roles kept it only by luck of column placement).
--
-- This RPC mirrors the demote pattern:
--   * admin-only (is_admin covers primary OR additional_roles per 0332),
--   * gym-clamped for non-super-admins,
--   * additional_roles-aware: a plain member is promoted at the primary-role
--     level; anyone who already holds a higher/other primary role (admin,
--     super_admin) keeps it and simply gains 'trainer' in additional_roles.
--   * idempotent: re-promoting an existing trainer is a no-op.
--
-- ⚠️ Apply via Supabase Dashboard SQL Editor (see project memory).

CREATE OR REPLACE FUNCTION public.promote_member_to_trainer(p_member_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_gym UUID;
  v_target_gym UUID;
  v_target_role TEXT;
  v_target_additional TEXT[];
BEGIN
  -- Caller must be an admin (primary or additional role).
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  v_caller_gym := public.current_gym_id();

  SELECT gym_id, role, additional_roles
    INTO v_target_gym, v_target_role, v_target_additional
  FROM profiles WHERE id = p_member_id;

  IF v_target_gym IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Gym clamp: non-super-admins can only promote within their own gym.
  IF NOT public.is_super_admin() AND v_caller_gym IS DISTINCT FROM v_target_gym THEN
    RAISE EXCEPTION 'Unauthorized: cannot promote member in another gym';
  END IF;

  -- Already a trainer (primary or additional) → no-op.
  IF v_target_role = 'trainer'
     OR 'trainer' = ANY (COALESCE(v_target_additional, '{}')) THEN
    RETURN;
  END IF;

  IF v_target_role = 'member' THEN
    -- Plain member: promote the primary role. (Mirrors demote, which sets a
    -- trainer's primary role back to 'member'.)
    UPDATE profiles
       SET role = 'trainer',
           updated_at = now()
     WHERE id = p_member_id;
  ELSE
    -- Holds a higher/other primary role (admin / super_admin). Preserve it and
    -- grant trainer capability via the additional_roles bag instead of
    -- clobbering the primary role.
    UPDATE profiles
       SET additional_roles = (
             SELECT ARRAY(
               SELECT DISTINCT unnest(COALESCE(additional_roles, '{}') || ARRAY['trainer'])
             )
           ),
           updated_at = now()
     WHERE id = p_member_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_member_to_trainer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_member_to_trainer(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
