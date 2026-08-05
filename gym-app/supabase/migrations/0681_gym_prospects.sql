-- =============================================================
-- 0681 — gym_prospects: walk-ins / free-first-class guests, and the
--        admin-side referral attribution that was impossible before.
-- =============================================================
--
-- WHY
--
-- Gyms give away a first class or a guest pass, and the person walks out
-- without ever existing in the system. They are not a member, not an invite,
-- not a row anywhere. This adds the missing first step of the funnel:
--
--     Prospect  →  Invite  →  Member
--
-- THE ATTRIBUTION HOLE THIS CLOSES
--
-- Today, if a member physically brings a friend and that friend signs up at
-- the front desk, the member gets ZERO referral credit. `referrals` is only
-- ever written by `register_referral(p_code, p_referred_id)`, which the NEW
-- USER has to call themselves, from their own phone, with a code typed in.
-- The single behaviour the referral program exists to reward — bringing a
-- friend to the gym — is invisible to the system.
--
-- `register_referral` (0610:28) opens with:
--     IF p_referred_id IS NULL OR p_referred_id <> auth.uid() THEN
--       RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
--
-- so an admin cannot attribute on a member's behalf. (There IS a three-valued
-- logic hole — under service_role `auth.uid()` is NULL, `x <> NULL` is NULL,
-- and `false OR NULL` is NULL, so the guard does not fire — but that is an
-- accident of SQL trinary logic, not a designed bypass. A future COALESCE /
-- IS DISTINCT FROM hardening pass would close it silently, exactly the way
-- 0480 silently reverted 0351's award fix. We do not build on it.)
--
-- Hence `admin_attribute_referral` below: the admin-callable creation half
-- that the system never had. `safe_complete_referral` (0117:251) is the
-- completion half that already existed.
--
-- ALSO FIXED HERE
--
-- `admin_complete_referral` — the Approve button in AdminReferrals has been
-- doing a bare `UPDATE referrals SET status='completed'` and never calling
-- `complete_referral`, so no reward_points_log, no reward_points, no
-- points_awarded, no milestone check. Since `referral_config
-- .require_admin_approval` DEFAULTS to true, approval-gated gyms have been
-- silently paying out nothing. And it is terminal: complete_referral early-
-- returns on status='completed' (0612:70), so it cannot be repaired after
-- the fact without first pushing the row back to 'pending'.
--
-- We do not reuse `safe_complete_referral` for this: it reads `profiles.role`
-- raw (0117:255), so an admin whose primary role is 'member' with 'admin' in
-- `additional_roles` gets rejected. Both new functions copy the authz block
-- from `admin_create_member` (0467:67-83) verbatim, which is the one known-
-- correct multi-role guard in the codebase.
--
-- Idempotent. No policy DDL on existing tables, so no ACCESS EXCLUSIVE on
-- anything live.
-- =============================================================

-- ── Tunable ──────────────────────────────────────────────────
-- How long an unconverted prospect's contact details are retained before the
-- nightly purge deletes them. These are people who are NOT customers, so the
-- row is not ours to keep indefinitely. Converted prospects are exempt — they
-- became members and the provenance is worth keeping.
--   PROSPECT_RETENTION_DAYS = 180

-- ── 1. Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_prospects (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                 UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,

  full_name              TEXT NOT NULL,
  phone                  TEXT,
  email                  TEXT,

  source                 TEXT NOT NULL DEFAULT 'walk_in'
                           CHECK (source IN ('first_free_class','guest_of_member','walk_in','event','other')),

  -- The whole point of the feature. ON DELETE SET NULL, never CASCADE: if the
  -- referring member deletes their account we lose the attribution, not the
  -- prospect.
  referred_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  visited_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gym_class_id           UUID REFERENCES public.gym_classes(id) ON DELETE SET NULL,

  status                 TEXT NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','contacted','converted','lost')),
  lost_reason            TEXT,
  note                   TEXT,

  converted_profile_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  converted_at           TIMESTAMPTZ,

  -- Timestamp, not boolean — same shape as profiles.terms_accepted_at /
  -- privacy_accepted_at (0344:26-27). A boolean cannot answer "when did they
  -- agree, and under which policy", which is the only thing that matters if
  -- anyone ever asks.
  consent_contact_at     TIMESTAMPTZ,

  created_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gym_prospects_gym_status
  ON public.gym_prospects (gym_id, status, visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_gym_prospects_referrer
  ON public.gym_prospects (referred_by_profile_id)
  WHERE referred_by_profile_id IS NOT NULL;

-- ── 2. updated_at trigger ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gym_prospects_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_prospects_updated_at ON public.gym_prospects;
CREATE TRIGGER trg_gym_prospects_updated_at
  BEFORE UPDATE ON public.gym_prospects
  FOR EACH ROW EXECUTE FUNCTION public.gym_prospects_set_updated_at();

-- ── 3. RLS ───────────────────────────────────────────────────
ALTER TABLE public.gym_prospects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_prospects_admin_all" ON public.gym_prospects;
CREATE POLICY "gym_prospects_admin_all"
  ON public.gym_prospects FOR ALL TO authenticated
  USING      (gym_id = public.current_gym_id() AND public.is_admin())
  WITH CHECK (gym_id = public.current_gym_id() AND public.is_admin());

DROP POLICY IF EXISTS "gym_prospects_super_admin_all" ON public.gym_prospects;
CREATE POLICY "gym_prospects_super_admin_all"
  ON public.gym_prospects FOR ALL TO authenticated
  USING      (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_prospects TO authenticated;

-- ── 4. Nightly PII purge ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_stale_prospects()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.gym_prospects
  WHERE status IN ('new','contacted','lost')
    AND visited_at < NOW() - INTERVAL '180 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_stale_prospects() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.purge_stale_prospects() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-stale-prospects')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-stale-prospects');
    PERFORM cron.schedule(
      'purge-stale-prospects',
      '30 8 * * *',
      $cron$ SELECT public.purge_stale_prospects(); $cron$
    );
  END IF;
END $$;

-- ── 5. admin_attribute_referral ──────────────────────────────
-- Creates the referrals row on a member's behalf. Deliberately does NOT
-- complete it — see the note at the bottom of this file.
CREATE OR REPLACE FUNCTION public.admin_attribute_referral(
  p_referred_id UUID,
  p_referrer_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
  v_is_super     BOOLEAN;
  v_is_admin     BOOLEAN;
  v_referred_gym UUID;
  v_referrer_gym UUID;
  v_referrer_nm  TEXT;
  v_code_id      UUID;
  v_referral_id  UUID;
  v_existing_ref UUID;
  v_existing_by  UUID;
  v_existing_nm  TEXT;
BEGIN
  -- ── Authz — copied from admin_create_member (0467:67-83). Honours
  -- additional_roles; `is_admin()` and safe_complete_referral's raw
  -- profiles.role read both miss multi-role admins.
  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_admin := (v_caller_role = 'admin'
                 OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));

  IF NOT (v_is_admin OR v_is_super) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_referred_id IS NULL OR p_referrer_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'MISSING_ARGS');
  END IF;

  IF p_referred_id = p_referrer_id THEN
    RETURN json_build_object('success', false, 'error', 'SELF_REFERRAL');
  END IF;

  SELECT gym_id INTO v_referred_gym FROM profiles WHERE id = p_referred_id;
  SELECT gym_id, full_name INTO v_referrer_gym, v_referrer_nm
    FROM profiles WHERE id = p_referrer_id;

  IF v_referred_gym IS NULL OR v_referrer_gym IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NO_GYM');
  END IF;

  IF v_referred_gym IS DISTINCT FROM v_referrer_gym THEN
    RETURN json_build_object('success', false, 'error', 'CROSS_GYM');
  END IF;

  -- A non-super admin can only act inside their own gym.
  IF NOT v_is_super AND v_referred_gym IS DISTINCT FROM v_caller_gym THEN
    RETURN json_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  -- UNIQUE(referred_id, gym_id) makes attribution permanent and there is no
  -- re-attribution path. Surface the collision by NAME instead of swallowing
  -- it the way register_referral's ON CONFLICT DO NOTHING does — the front
  -- desk needs to learn "already credited to someone else", not get a
  -- success toast that did nothing.
  SELECT id, referrer_id INTO v_existing_ref, v_existing_by
    FROM referrals WHERE referred_id = p_referred_id AND gym_id = v_referred_gym;
  IF v_existing_ref IS NOT NULL THEN
    SELECT full_name INTO v_existing_nm FROM profiles WHERE id = v_existing_by;
    RETURN json_build_object(
      'success', false, 'error', 'ALREADY_ATTRIBUTED',
      'referral_id', v_existing_ref,
      'referrer_name', COALESCE(v_existing_nm, 'Member')
    );
  END IF;

  -- The referrer's own code, when they have one. Nullable: a member who has
  -- never opened the Referrals page has no code row yet, and that must not
  -- block a walk-in attribution.
  SELECT id INTO v_code_id
    FROM referral_codes
    WHERE profile_id = p_referrer_id AND gym_id = v_referred_gym
    LIMIT 1;

  BEGIN
    INSERT INTO referrals (referrer_id, referred_id, gym_id, referral_code_id, status)
    VALUES (p_referrer_id, p_referred_id, v_referred_gym, v_code_id, 'pending')
    RETURNING id INTO v_referral_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Raced with another admin between the SELECT above and here.
      RETURN json_build_object('success', false, 'error', 'ALREADY_ATTRIBUTED');
    WHEN OTHERS THEN
      -- trg_referral_rate_limit (0117:243) RAISEs rather than returning:
      -- >3 rows for the same referred_id in 24h, or referrer not in gym_id.
      -- Without this it surfaces as an opaque 500 in the admin UI.
      RETURN json_build_object('success', false, 'error', 'REJECTED', 'detail', SQLERRM);
  END;

  -- Mirrors register_referral (0610:78-90) exactly, including the reverse-
  -- direction UPDATE: a referral implies a social tie, and that tie is the
  -- retention mechanism the whole referral pillar rests on. Kept for
  -- consistency with the code-based path — remove this block if an admin
  -- creating a friendship between two people is not wanted.
  INSERT INTO friendships (gym_id, requester_id, addressee_id, status)
  VALUES (v_referred_gym, p_referrer_id, p_referred_id, 'accepted')
  ON CONFLICT (requester_id, addressee_id) DO UPDATE
    SET status = 'accepted', updated_at = NOW();

  UPDATE friendships
  SET status = 'accepted', updated_at = NOW()
  WHERE requester_id = p_referred_id
    AND addressee_id = p_referrer_id
    AND status <> 'accepted';

  RETURN json_build_object(
    'success', true,
    'referral_id', v_referral_id,
    'referrer_id', p_referrer_id,
    'referrer_name', COALESCE(v_referrer_nm, 'Member'),
    'status', 'pending'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_attribute_referral(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_attribute_referral(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_attribute_referral(UUID, UUID) TO authenticated;

-- ── 6. admin_complete_referral ───────────────────────────────
-- The payout half. complete_referral is revoked from `authenticated`
-- (0222:190-191) so it can only be reached through a definer wrapper; this is
-- that wrapper, with a multi-role-correct admin guard.
CREATE OR REPLACE FUNCTION public.admin_complete_referral(p_referral_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
  v_is_super     BOOLEAN;
  v_is_admin     BOOLEAN;
  v_ref          referrals%ROWTYPE;
BEGIN
  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_admin := (v_caller_role = 'admin'
                 OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));

  IF NOT (v_is_admin OR v_is_super) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_ref FROM referrals WHERE id = p_referral_id;
  IF v_ref.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  IF NOT v_is_super AND v_ref.gym_id IS DISTINCT FROM v_caller_gym THEN
    RETURN json_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  IF v_ref.status = 'completed' THEN
    RETURN json_build_object('success', false, 'error', 'ALREADY_COMPLETED');
  END IF;

  -- Runs as owner, so the revoke on complete_referral does not apply. This is
  -- what the Approve button was missing: both-side rewards, the monthly cap,
  -- and check_referral_milestones.
  PERFORM public.complete_referral(p_referral_id);

  RETURN json_build_object('success', true, 'referral_id', p_referral_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_complete_referral(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_complete_referral(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_complete_referral(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- WHY ATTRIBUTION DOES NOT PAY OUT IMMEDIATELY
--
-- admin_attribute_referral leaves the row 'pending'. It is completed when the
-- member actually signs up, or when an admin approves it in /admin/referrals.
--
-- The concrete reason: admin_create_member mints a SHADOW auth user at
-- invite-<uuid>@invite.tugympr.invalid (0467:117-131), and claim_imported_invite
-- (0468:74+) merges that shell into the real profile at signup and DELETES the
-- shadow. Paying out against the shadow's id risks the reward_points /
-- reward_points_log rows going with it on CASCADE.
--
-- It is also the honest rule: you do not pay a referral for someone who has
-- not actually joined yet.
--
-- If claim_imported_invite is confirmed to carry reward_points across the
-- merge, the PERFORM complete_referral(...) call can be moved into
-- admin_attribute_referral. That is a one-line change, not a redesign.
--
-- Verify:
--   SELECT public.admin_attribute_referral('<member>', '<referrer>');
--   SELECT id, referrer_id, referred_id, status FROM referrals
--     WHERE referred_id = '<member>';
--   -- second call must return ALREADY_ATTRIBUTED with the first referrer's name
-- =============================================================
