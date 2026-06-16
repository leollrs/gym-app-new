-- ============================================================================
-- 0598 — admin_get_member_email: super_admin cross-gym bypass   (audit: platform)
-- ============================================================================
-- The platform MemberDetail (super-admin clicking into a member of ANY gym, via
-- the new PlatformMemberDetail wrapper) loads the member's login email on mount
-- through admin_get_member_email. That RPC (0183) gates on is_admin() — which
-- a super_admin passes — but then enforces a HARD own-gym boundary with NO
-- super_admin bypass:
--
--     IF member_gym IS NULL OR member_gym != caller_gym THEN
--       RAISE EXCEPTION 'Member not found in your gym';
--
-- A super_admin's current_gym_id() is their own gym, so reading any OTHER gym's
-- member always raised. MemberDetail wraps the call in try/catch, so it didn't
-- crash — the email field just silently stayed empty for cross-gym members.
--
-- This re-creates the function adding the same idempotent super_admin bypass
-- already used by admin_update_member_email (0464) and
-- admin_generate_password_reset (0543): super_admins skip the own-gym check;
-- gym admins are still confined to their own gym. All other behavior (role
-- gate, lookups, return value, SECURITY DEFINER, search_path, grant) is
-- preserved verbatim.
--
-- The OTHER RPCs MemberDetail can call were audited and already permit
-- super_admin cross-gym (no patch needed):
--   • admin_update_member_email (0464)      — explicit IF NOT v_is_super bypass
--   • admin_generate_password_reset (0543)  — explicit is_super_admin() bypass
--   • admin_delete_gym_member (0551)         — explicit IF NOT is_super_admin() bypass
--   • admin_create_gym_member (0217)         — super_admin-only, gym passed as arg
-- get_or_create_conversation (0536) is same-gym-only with NO super_admin bypass,
-- but it is reachable only from MemberDetail's "Send Follow-up" path, which the
-- platform wrapper keeps inert (state='insufficient_data' ⇒ isFollowupCandidate
-- is false), so it is intentionally NOT broadened here — doing so would change
-- core member/trainer DM gating platform-wide.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_member_email(p_member_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_gym   UUID;
  member_gym   UUID;
  member_email TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT gym_id INTO member_gym FROM profiles WHERE id = p_member_id;
  IF member_gym IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Gym admins may only read members of their own gym; super_admins may read
  -- any member on the platform (idempotent bypass — see 0464 / 0543).
  IF NOT public.is_super_admin() THEN
    caller_gym := public.current_gym_id();
    IF member_gym != caller_gym THEN
      RAISE EXCEPTION 'Member not found in your gym';
    END IF;
  END IF;

  SELECT email INTO member_email FROM auth.users WHERE id = p_member_id;
  RETURN member_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_member_email(UUID) TO authenticated;
