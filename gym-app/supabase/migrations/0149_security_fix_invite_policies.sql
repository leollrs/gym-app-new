-- ══════════════════════════════════════════════════════════════════════
-- FIX: Overly permissive SELECT policies on gym_invites & member_invites
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. gym_invites: replace USING(true) with token-scoped lookup ────

DROP POLICY IF EXISTS "gym_invites_select_by_token" ON gym_invites;

-- Allow anyone (incl. anon) to look up a specific invite by token only.
-- The caller must already know the token — without it no rows are visible.
CREATE POLICY "gym_invites_select_by_token" ON gym_invites
  FOR SELECT USING (
    token = current_setting('request.query.token', true)
    OR token = current_setting('request.headers.x-invite-token', true)
  );

-- The admin policy ("gym_invites_select_admin") already exists and is fine.

-- ── 2. member_invites: replace wide-open SELECT with admin-only ─────

DROP POLICY IF EXISTS "Authenticated can look up invite by code" ON member_invites;

-- Admins/trainers of the same gym can list their gym's invites
-- (the existing "Admins can manage invites" FOR ALL policy already covers this,
--  so we don't need a separate admin SELECT policy)

-- ── 3. RPC for invite code lookup (replaces the open SELECT policy) ─
-- Returns only the fields a claiming user needs, nothing more.

CREATE OR REPLACE FUNCTION public.lookup_invite_by_code(p_code TEXT)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (
    SELECT json_build_object(
      'code',      invite_code,
      'status',    status,
      'gym_id',    gym_id,
      'full_name', member_name
    )
    FROM member_invites
    WHERE invite_code = upper(trim(p_code))
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > now())
  );
END;
$$;
