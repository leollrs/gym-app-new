-- ============================================================
-- 0305: Fix admin_create_invite_code overload ambiguity
--
-- Problem: Two overloads exist in the DB:
--   (uuid, text, text, text, text)        — from 0107
--   (uuid, text, text, text, text, uuid)  — from 0253
-- When called with fewer args + defaults, Supabase can't pick.
--
-- Fix: Drop the old 5-param signature. The 6-param version
-- (with p_referral_code_id DEFAULT NULL) handles all calls.
-- ============================================================

-- Drop the old 5-param overload
DROP FUNCTION IF EXISTS public.admin_create_invite_code(UUID, TEXT, TEXT, TEXT, TEXT);

-- Re-create the 6-param version with SET search_path (from 0265)
CREATE OR REPLACE FUNCTION public.admin_create_invite_code(
  p_gym_id            UUID,
  p_member_name       TEXT,
  p_phone             TEXT DEFAULT NULL,
  p_email             TEXT DEFAULT NULL,
  p_role              TEXT DEFAULT 'member',
  p_referral_code_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_id UUID;
  v_expires TIMESTAMPTZ;
  v_attempts INT := 0;
BEGIN
  -- Admin check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  -- Force member role (security)
  IF p_role != 'member' AND p_role != 'trainer' THEN
    p_role := 'member';
  END IF;

  v_expires := now() + interval '30 days';

  -- Generate unique code with retry
  LOOP
    v_code := public.generate_invite_code();
    v_attempts := v_attempts + 1;

    BEGIN
      INSERT INTO gym_invites (gym_id, created_by, invite_code, member_name, phone, email, role, expires_at, referral_code_id)
      VALUES (p_gym_id, auth.uid(), v_code, p_member_name, p_phone, p_email, p_role, v_expires, p_referral_code_id)
      RETURNING id INTO v_id;
      EXIT; -- success
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 10 THEN
        RAISE EXCEPTION 'Failed to generate unique invite code after 10 attempts';
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_id,
    'invite_code', v_code,
    'expires_at', v_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_invite_code(UUID, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
