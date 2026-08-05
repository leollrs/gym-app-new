-- =============================================================
-- 0685 — Email consent, suppression, and a working unsubscribe
-- =============================================================
--
-- WHY THIS BLOCKS EVERYTHING ELSE
--
-- We are about to start sending automated email (lifecycle, win-back, class
-- reminders) that today only goes out as push. Before a single automated
-- message leaves, the system needs something it has never had:
--
--   • No unsubscribe link works anywhere. emailTemplateRenderer.js:203 renders
--     <a href="#">Unsubscribe</a>; the editorial footer renders Unsubscribe,
--     Preferences AND Policy all as href="#"; send-invite and send-admin-email
--     emit no unsubscribe link at all.
--   • No List-Unsubscribe header — required by Gmail and Yahoo bulk rules since
--     Feb 2024.
--   • No suppression list anywhere in 684 migrations.
--   • The nine notif_* columns are PUSH semantics. Reusing them for email would
--     silently kill push for anyone who opted out of email, and a member who
--     left push on has not consented to email either.
--
-- The operational blast radius is what makes this urgent rather than merely
-- correct: every gym on the platform sends from the SAME envelope address,
-- noreply@tugympr.com. One gym's spam complaints get that domain blocked and
-- invites, password resets and access codes stop arriving for ALL of them.
--
-- A "we miss you, come back" message is commercial content. It does not fall
-- under the transactional exemption.
--
-- DEFAULTS, AND WHY THEY DIFFER
--
--   notif_email_winback   → FALSE. Opt-in. Purely promotional, and
--                           notif_reengagement (0338) already set that
--                           precedent for the push equivalent per Apple 4.5.4.
--   notif_email_lifecycle → TRUE. Onboarding for someone who just joined the
--                           gym; defensible as relationship mail.
--   notif_email_classes   → TRUE. They booked the class themselves.
--   notif_email_enabled   → TRUE. Master switch. Deliberately does NOT gate
--                           transactional mail (invite, password reset, access
--                           code) — turning off marketing must not lock someone
--                           out of their own account.
--
-- Idempotent. Additive only.
-- =============================================================

-- ── 1. Per-member email preferences ──────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notif_email_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_email_lifecycle BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_email_classes   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_email_winback   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Stable per member and unguessable. A token column rather than a tokens
  -- table because an unsubscribe link lives in an inbox forever — anything
  -- that expires produces a dead unsubscribe, which is the exact failure we
  -- are fixing.
  ADD COLUMN IF NOT EXISTS email_unsub_token     UUID;

UPDATE public.profiles SET email_unsub_token = gen_random_uuid()
 WHERE email_unsub_token IS NULL;

ALTER TABLE public.profiles ALTER COLUMN email_unsub_token SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unsub_token
  ON public.profiles (email_unsub_token) WHERE email_unsub_token IS NOT NULL;

COMMENT ON COLUMN public.profiles.notif_email_winback IS
  'Opt-IN (default false). Win-back email is promotional; see Apple 4.5.4 and '
  'the notif_reengagement precedent from 0338. Senders must check this.';

-- ── 2. Suppression list ──────────────────────────────────────
-- Keyed on the ADDRESS, not the profile: a hard bounce or a spam complaint is
-- about the mailbox. The same person re-joining with the same address must stay
-- suppressed, and profiles.email does not exist (email lives on auth.users).
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  gym_id     UUID REFERENCES public.gyms(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason     TEXT NOT NULL DEFAULT 'unsubscribed'
               CHECK (reason IN ('unsubscribed','bounced','complained','manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global per address: a suppression is never scoped to one gym. Someone who
-- said stop meant stop.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_suppressions_email
  ON public.email_suppressions (lower(email));

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

-- Staff may read their own gym's suppressions (so an admin can see why a member
-- gets no mail) but nobody writes through RLS — only the definer functions do.
DROP POLICY IF EXISTS email_suppressions_staff_read ON public.email_suppressions;
CREATE POLICY email_suppressions_staff_read
  ON public.email_suppressions FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (gym_id = public.current_gym_id() AND public.is_admin())
  );

GRANT SELECT ON public.email_suppressions TO authenticated;

-- ── 3. Read the unsubscribe page's context ───────────────────
-- Anon-callable: the recipient has no session. Returns only what the page needs
-- to render honestly — their first name, the gym, and the current state of the
-- four switches. No email address, no ids.
CREATE OR REPLACE FUNCTION public.get_unsubscribe_context(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_p   RECORD;
  v_gym RECORD;
BEGIN
  IF p_token IS NULL THEN RETURN json_build_object('found', false); END IF;

  SELECT id, gym_id, full_name, language,
         notif_email_enabled, notif_email_lifecycle, notif_email_classes, notif_email_winback
    INTO v_p
    FROM profiles WHERE email_unsub_token = p_token;

  IF v_p.id IS NULL THEN RETURN json_build_object('found', false); END IF;

  SELECT name, address INTO v_gym FROM gyms WHERE id = v_p.gym_id;

  RETURN json_build_object(
    'found', true,
    'first_name', COALESCE(NULLIF(split_part(v_p.full_name, ' ', 1), ''), ''),
    'gym_name', COALESCE(v_gym.name, ''),
    'gym_address', COALESCE(v_gym.address, ''),
    'language', COALESCE(v_p.language, 'en'),
    'prefs', json_build_object(
      'all',       v_p.notif_email_enabled,
      'lifecycle', v_p.notif_email_lifecycle,
      'classes',   v_p.notif_email_classes,
      'winback',   v_p.notif_email_winback
    )
  );
END;
$$;

-- ── 4. Act on it ─────────────────────────────────────────────
-- `p_scope`: 'all' | 'lifecycle' | 'classes' | 'winback'.
-- `p_on`: false to unsubscribe (the default and the one-click case), true to
-- re-subscribe from the preference page.
--
-- Scope 'all' also writes a suppression row keyed on the mailbox, so the person
-- stays off even if a new profile is later created with the same address.
CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(
  p_token UUID,
  p_scope TEXT DEFAULT 'all',
  p_on    BOOLEAN DEFAULT FALSE
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_p     RECORD;
  v_email TEXT;
BEGIN
  IF p_token IS NULL THEN RETURN json_build_object('success', false, 'error', 'NOT_FOUND'); END IF;
  IF p_scope NOT IN ('all','lifecycle','classes','winback') THEN
    RETURN json_build_object('success', false, 'error', 'BAD_SCOPE');
  END IF;

  SELECT id, gym_id INTO v_p FROM profiles WHERE email_unsub_token = p_token;
  IF v_p.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'NOT_FOUND'); END IF;

  UPDATE profiles SET
    notif_email_enabled   = CASE WHEN p_scope = 'all'       THEN p_on ELSE notif_email_enabled   END,
    notif_email_lifecycle = CASE WHEN p_scope = 'lifecycle' THEN p_on ELSE notif_email_lifecycle END,
    notif_email_classes   = CASE WHEN p_scope = 'classes'   THEN p_on ELSE notif_email_classes   END,
    notif_email_winback   = CASE WHEN p_scope = 'winback'   THEN p_on ELSE notif_email_winback   END
  WHERE id = v_p.id;

  IF p_scope = 'all' THEN
    -- profiles has no email column — the real address is on auth.users, and for
    -- admin-created members it may still be the invite-<uuid>@…invalid shadow,
    -- with the real one in raw_user_meta_data.pending_email (0603).
    SELECT COALESCE(
             NULLIF(u.raw_user_meta_data ->> 'pending_email', ''),
             CASE WHEN u.email LIKE '%@%.invalid' THEN NULL ELSE u.email END
           )
      INTO v_email
      FROM auth.users u WHERE u.id = v_p.id;

    IF p_on THEN
      DELETE FROM email_suppressions WHERE lower(email) = lower(v_email);
    ELSIF v_email IS NOT NULL THEN
      INSERT INTO email_suppressions (email, gym_id, profile_id, reason)
      VALUES (lower(v_email), v_p.gym_id, v_p.id, 'unsubscribed')
      ON CONFLICT (lower(email)) DO NOTHING;
    END IF;
  END IF;

  RETURN json_build_object('success', true, 'scope', p_scope, 'subscribed', p_on);
END;
$$;

-- ── 5. The gate every automated sender must call ─────────────
-- One place decides. A sender that forgets to check a column is how the
-- win-back push already ended up bypassing notif_reengagement (0402 vs
-- scheduled-reminders:578) — this makes that mistake harder to repeat.
CREATE OR REPLACE FUNCTION public.email_allowed_for(p_profile_id UUID, p_scope TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_p     RECORD;
  v_email TEXT;
BEGIN
  SELECT notif_email_enabled, notif_email_lifecycle, notif_email_classes, notif_email_winback
    INTO v_p FROM profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF NOT v_p.notif_email_enabled THEN RETURN FALSE; END IF;

  IF p_scope = 'lifecycle' AND NOT v_p.notif_email_lifecycle THEN RETURN FALSE; END IF;
  IF p_scope = 'classes'   AND NOT v_p.notif_email_classes   THEN RETURN FALSE; END IF;
  IF p_scope = 'winback'   AND NOT v_p.notif_email_winback   THEN RETURN FALSE; END IF;

  SELECT COALESCE(
           NULLIF(u.raw_user_meta_data ->> 'pending_email', ''),
           CASE WHEN u.email LIKE '%@%.invalid' THEN NULL ELSE u.email END
         )
    INTO v_email FROM auth.users u WHERE u.id = p_profile_id;

  -- No usable address is a hard no, not a silent success.
  IF v_email IS NULL THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM email_suppressions WHERE lower(email) = lower(v_email)) THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

-- ── 6. Grants ────────────────────────────────────────────────
-- The two token functions MUST be anon-callable: the recipient has no session.
-- 0486_anon_execute_capstone revoked EXECUTE from anon on every public function
-- outside a 7-name allowlist, so without these explicit grants the unsubscribe
-- link would 404 in silence — the exact failure this migration exists to fix.
-- Allowlist, extended: lookup_invite_by_code, lookup_gym_invite_by_code,
-- lookup_referral_code, tv_authenticate, tv_get_dashboard_data,
-- get_maintenance_status, get_app_version, get_unsubscribe_context,
-- unsubscribe_by_token.
REVOKE EXECUTE ON FUNCTION public.get_unsubscribe_context(UUID)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unsubscribe_by_token(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_unsubscribe_context(UUID)            TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.unsubscribe_by_token(UUID, TEXT, BOOLEAN) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.email_allowed_for(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_allowed_for(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.email_allowed_for(UUID, TEXT) TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verify:
--   SELECT email_unsub_token FROM profiles LIMIT 1;
--   SELECT get_unsubscribe_context('<token>');
--   SELECT unsubscribe_by_token('<token>', 'winback', false);
--   SELECT email_allowed_for('<profile>', 'winback');   -- false
--   SELECT unsubscribe_by_token('<token>', 'all', false);
--   SELECT * FROM email_suppressions;                    -- one row
--   SELECT email_allowed_for('<profile>', 'lifecycle');  -- false, suppressed
--
-- As anon (the recipient's browser), both token functions must work:
--   SET ROLE anon; SELECT get_unsubscribe_context('<token>');
-- =============================================================
