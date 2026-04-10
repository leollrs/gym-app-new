-- ============================================================
-- 0306: Add lookup_gym_invite_by_code RPC
--
-- Problem: Signup.jsx can't query gym_invites directly because
-- RLS only allows lookup by the old `token` field, not by
-- `invite_code`. Unauthenticated users get zero rows.
--
-- Fix: SECURITY DEFINER RPC that returns only the fields
-- needed for signup validation, matching the existing
-- lookup_invite_by_code pattern for member_invites.
-- ============================================================

CREATE OR REPLACE FUNCTION public.lookup_gym_invite_by_code(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT json_build_object(
      'id',        id,
      'code',      invite_code,
      'gym_id',    gym_id,
      'full_name', member_name,
      'email',     email,
      'phone',     phone
    )
    FROM gym_invites
    WHERE invite_code = upper(trim(p_code))
      AND used_by IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  );
END;
$$;

-- Allow both authenticated and anonymous users to look up invite codes
GRANT EXECUTE ON FUNCTION public.lookup_gym_invite_by_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_gym_invite_by_code(TEXT) TO anon;

-- Also grant the existing member_invites lookup to anon (was missing)
GRANT EXECUTE ON FUNCTION public.lookup_invite_by_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_invite_by_code(TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
