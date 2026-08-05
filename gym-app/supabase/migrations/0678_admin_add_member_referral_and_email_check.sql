-- 0678_admin_add_member_referral_and_email_check.sql
--
-- Two server-side gaps behind the admin "Agregar Miembro" flow.
--
-- ── (A) The referral attached to an invite was WRITE-ONLY ────────────────────
-- CreateInviteModal lets an admin scan or type a referrer's code and stores it
-- on `gym_invites.referral_code_id` (CreateInviteModal.jsx:246). Nothing ever
-- read it back:
--   · `lookup_gym_invite_by_code` (0306, last touched 0603) returns only
--     id / code / gym_id / full_name / email / phone.
--   · `claim_imported_invite` (0468) never mentions referrals either.
--   · The referral is actually registered CLIENT-side, by Onboarding calling
--     `register_referral(p_code, p_referred_id)` — and that takes the code
--     TEXT, which the client was never told.
-- So the invite carried the member's name, email and phone across perfectly and
-- dropped the referral on the floor: the field came up blank in onboarding and
-- the referrer was never credited. Return the code text so the client can
-- prefill it and run the same register_referral path a manually-typed code
-- takes.
--
-- Body is otherwise 0603's (B) verbatim — same claimed/placeholder-shell rule,
-- same expiry filter.

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
      'id',        gi.id,
      'code',      gi.invite_code,
      'gym_id',    gi.gym_id,
      'full_name', gi.member_name,
      'email',     gi.email,
      'phone',     gi.phone,
      -- The referrer's code, not the row id: register_referral takes the text.
      -- LEFT JOIN — an invite with no referral must still resolve, and a
      -- referral_code row deleted since must not swallow the whole invite.
      'referral_code', rc.code
    )
    FROM gym_invites gi
    LEFT JOIN referral_codes rc ON rc.id = gi.referral_code_id
    WHERE gi.invite_code = upper(trim(p_code))
      AND (
        -- never claimed, OR pre-created by admin/import and still a placeholder
        -- shell (claim_imported_invite merges these and links the gym).
        gi.used_by IS NULL
        OR EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = gi.used_by
            AND u.email LIKE '%@%.invalid'
        )
      )
      AND (gi.expires_at IS NULL OR gi.expires_at > now())
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_gym_invite_by_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_gym_invite_by_code(TEXT) TO anon;


-- ── (B) "Email already registered" only after submitting ────────────────────
-- `admin_create_member` (0467:100) rejects a taken address, but only once the
-- admin has filled the whole form and pressed Add — the same late-failure the
-- member-facing onboarding was already fixed for. The client cannot run that
-- check itself: the collision is on `auth.users`, which is not readable from
-- the browser under any role.
--
-- So: a boolean-only probe with the SAME rule as the create path (placeholder
-- shadows at '…@*.invalid' never block, since those are unactivated members
-- whose real address is still free). Boolean-only and admin-only on purpose —
-- it tells an admin nothing they would not learn by pressing the button, and
-- it does not expose WHICH gym or WHICH member owns the address, so it is not
-- an enumeration oracle for anyone else.
CREATE OR REPLACE FUNCTION public.admin_email_available(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  -- Malformed input is not "taken" — the form's own validation owns that
  -- message, and returning false here would show the wrong error.
  IF v_email IS NULL OR v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RETURN TRUE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE email = v_email
      AND email NOT LIKE '%@%.invalid'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_email_available(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_email_available(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   -- (A) an admin-created invite carrying a referral now returns it:
--   SELECT public.lookup_gym_invite_by_code('<code>') -> 'referral_code';
--   -- ...and one without a referral still resolves, with NULL there:
--   SELECT public.lookup_gym_invite_by_code('<code without referral>');
--
--   -- (B) as a gym admin:
--   SELECT public.admin_email_available('brand-new@example.com');   -- true
--   SELECT public.admin_email_available('<an existing member email>'); -- false
--   -- as a plain member: must RAISE 'Unauthorized: admin only'.
