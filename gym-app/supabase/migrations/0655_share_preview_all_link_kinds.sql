-- ============================================================================
-- 0655 — get_share_preview: cover the remaining shareable link kinds
-- ============================================================================
-- 0653 shipped `referral`, `class` and `gym`. Every OTHER link the app can
-- share still unfurls as the generic "TuGymPR — Train. Compete. Progress."
-- card: challenge invites, the gym's own member invites, trainer profiles and
-- friend adds. For a white-label product that is the wrong brand on the most
-- visible surface the gym has — a stranger's lock screen.
--
-- This is a VERBATIM rebuild of 0653's get_share_preview with four branches
-- appended. Nothing in the existing three changed.
--
-- PRIVACY POSTURE PER KIND — each of these is a new anonymous read surface, so
-- each one states what it exposes and why that is the minimum:
--
--   challenge  Name + dates of a NON-DRAFT challenge, plus the gym. A draft is
--              the admin's unpublished work and never resolves.
--   invite     Gym only. No inviter, no email, no role. An expired or already
--              used invite does not resolve — a dead invite should not paint a
--              live-looking card.
--   trainer    Name, tagline, avatar. NOT bio, phone, location, credentials or
--              services. get_trainer_public_profile deliberately requires a
--              session in the same gym (it returns NULL to anonymous callers),
--              so this is a genuinely new exposure and is kept to what a link
--              card can actually display. The avatar honours
--              trainer_photo_visible exactly like 0553 does.
--   friend     FIRST NAME only, same rule as referral. A friend code is 8 hex
--              chars (0116) — short enough to brute force — so this rides the
--              same share_preview_misses budget: once an hour looks like
--              scraping, names stop coming back and only the gym remains.
--
-- NOT covered on purpose: /invite/go/:section is a marketing deep link to an
-- app screen, not an entity — there is nothing to preview.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_share_preview(p_kind TEXT, p_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind      TEXT := lower(coalesce(p_kind, ''));
  v_id        TEXT := trim(coalesce(p_id, ''));
  v_uuid      UUID;
  v_gym_id    UUID;
  v_gym       JSONB;
  v_full_name TEXT;
  v_first     TEXT;
  v_offer     JSONB;
  v_misses    INT;
  v_cls       RECORD;
  v_chl       RECORD;
  v_trn       RECORD;
BEGIN
  IF v_id = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- ── referral ──────────────────────────────────────────────────────────────
  IF v_kind = 'referral' THEN
    SELECT rc.gym_id, p.full_name, g.referral_config -> 'join_offer'
      INTO v_gym_id, v_full_name, v_offer
      FROM public.referral_codes rc
      JOIN public.profiles p ON p.id = rc.profile_id
      JOIN public.gyms     g ON g.id = rc.gym_id
     WHERE rc.code = v_id
       AND g.is_active = TRUE;

    IF v_gym_id IS NULL THEN
      INSERT INTO public.share_preview_misses DEFAULT VALUES;
      IF random() < 0.01 THEN PERFORM public.prune_share_preview_misses(); END IF;
      RETURN jsonb_build_object('found', false);
    END IF;

    v_gym := public.share_preview_gym(v_gym_id);
    IF v_gym IS NULL THEN
      RETURN jsonb_build_object('found', false);
    END IF;

    -- First name only. "Leonel" is all the page needs to say who invited you;
    -- a harvest of first names is worth close to nothing, a harvest of full
    -- names is a member list.
    v_first := split_part(trim(coalesce(v_full_name, '')), ' ', 1);

    -- Enumeration budget spent? Drop the name, keep the page.
    SELECT COUNT(*) INTO v_misses
      FROM public.share_preview_misses
     WHERE missed_at >= now() - INTERVAL '1 hour';
    IF v_misses >= 60 THEN
      v_first := NULL;
    END IF;

    RETURN jsonb_build_object(
      'found',               true,
      'kind',                'referral',
      'gym',                 v_gym,
      'referrer_first_name', NULLIF(v_first, ''),
      'offer',               COALESCE(v_offer, '{}'::jsonb)
    );
  END IF;

  -- ── class ─────────────────────────────────────────────────────────────────
  IF v_kind = 'class' THEN
    BEGIN
      v_uuid := v_id::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('found', false);
    END;

    SELECT c.name, c.name_es, c.description, c.description_es,
           c.image_path, c.image_url, c.instructor_name, c.duration_minutes,
           c.color, s.day_of_week, s.start_time, s.end_time, s.gym_id
      INTO v_cls
      FROM public.gym_class_schedules s
      JOIN public.gym_classes c ON c.id = s.class_id
     WHERE s.id = v_uuid
       AND s.is_active = TRUE
       AND c.is_active = TRUE;

    -- FOUND, not `v_cls.gym_id IS NULL`: reading a field off a record that no
    -- SELECT ever populated is the kind of thing that works in testing and
    -- raises in production.
    IF NOT FOUND THEN
      RETURN jsonb_build_object('found', false);
    END IF;

    v_gym := public.share_preview_gym(v_cls.gym_id);
    IF v_gym IS NULL THEN
      RETURN jsonb_build_object('found', false);
    END IF;

    RETURN jsonb_build_object(
      'found', true,
      'kind',  'class',
      'gym',   v_gym,
      'class', jsonb_build_object(
        'name',             v_cls.name,
        'name_es',          v_cls.name_es,
        'description',      v_cls.description,
        'description_es',   v_cls.description_es,
        'image_path',       v_cls.image_path,
        'image_url',        v_cls.image_url,
        'instructor_name',  v_cls.instructor_name,
        'duration_minutes', v_cls.duration_minutes,
        'color',            v_cls.color,
        'day_of_week',      v_cls.day_of_week,
        -- substr(::text), not to_char(): to_char has no `time` overload, it
        -- only works by leaning on an implicit cast to interval. '18:00:00'
        -- trimmed to 5 chars is exact and has nothing to go wrong.
        'start_time',       substr(v_cls.start_time::text, 1, 5),
        'end_time',         substr(v_cls.end_time::text,   1, 5)
      )
    );
  END IF;

  -- ── gym ───────────────────────────────────────────────────────────────────
  IF v_kind = 'gym' THEN
    SELECT id INTO v_gym_id FROM public.gyms
     WHERE slug = v_id AND is_active = TRUE;

    IF v_gym_id IS NULL THEN
      RETURN jsonb_build_object('found', false);
    END IF;

    v_gym := public.share_preview_gym(v_gym_id);
    RETURN jsonb_build_object('found', v_gym IS NOT NULL, 'kind', 'gym', 'gym', v_gym);
  END IF;

  -- ── challenge ─────────────────────────────────────────────────────────────
  -- A member shares a challenge to pull friends into it, so the card leads with
  -- the challenge name and says which gym it belongs to.
  IF v_kind = 'challenge' THEN
    BEGIN
      v_uuid := v_id::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('found', false);
    END;

    SELECT c.name, c.description, c.type::text AS ctype,
           c.start_date, c.end_date, c.reward_description, c.gym_id
      INTO v_chl
      FROM public.challenges c
     WHERE c.id = v_uuid
       -- Drafts are the admin's unpublished work. A draft that leaked a card
       -- would advertise a challenge nobody can join yet.
       AND c.status <> 'draft';

    IF NOT FOUND THEN
      RETURN jsonb_build_object('found', false);
    END IF;

    v_gym := public.share_preview_gym(v_chl.gym_id);
    IF v_gym IS NULL THEN
      RETURN jsonb_build_object('found', false);
    END IF;

    RETURN jsonb_build_object(
      'found', true,
      'kind',  'challenge',
      'gym',   v_gym,
      'challenge', jsonb_build_object(
        'name',        v_chl.name,
        'description', v_chl.description,
        'type',        v_chl.ctype,
        'reward',      v_chl.reward_description,
        'start_date',  to_char(v_chl.start_date, 'YYYY-MM-DD'),
        'end_date',    to_char(v_chl.end_date,   'YYYY-MM-DD')
      )
    );
  END IF;

  -- ── invite ────────────────────────────────────────────────────────────────
  -- The gym's own member invite. The card is purely the gym: who created the
  -- invite, the target email and the role are all none of a crawler's business,
  -- and none of them would improve the card.
  IF v_kind = 'invite' THEN
    SELECT gym_id INTO v_gym_id
      FROM public.gym_invites
     WHERE invite_code = upper(trim(v_id))
       -- Same validity rules the claim path uses. A dead invite should fall
       -- back to the generic card rather than paint a live-looking one.
       AND used_at IS NULL
       AND (expires_at IS NULL OR expires_at > now());

    IF v_gym_id IS NULL THEN
      INSERT INTO public.share_preview_misses DEFAULT VALUES;
      IF random() < 0.01 THEN PERFORM public.prune_share_preview_misses(); END IF;
      RETURN jsonb_build_object('found', false);
    END IF;

    v_gym := public.share_preview_gym(v_gym_id);
    RETURN jsonb_build_object('found', v_gym IS NOT NULL, 'kind', 'invite', 'gym', v_gym);
  END IF;

  -- ── trainer ───────────────────────────────────────────────────────────────
  -- A trainer shares their own profile to win clients. Today that link unfurls
  -- as the app's generic card, which wastes the share entirely.
  IF v_kind = 'trainer' THEN
    BEGIN
      v_uuid := v_id::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('found', false);
    END;

    SELECT p.full_name,
           p.trainer_tagline,
           -- Photo masking copied from 0553: a trainer who hid their photo has
           -- it hidden here too. There is no `p.id = auth.uid()` escape hatch
           -- because this path has no session by definition.
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) THEN p.avatar_url END AS avatar_url,
           p.gym_id
      INTO v_trn
      FROM public.profiles p
     -- Role test copied VERBATIM from get_trainer_public_profile (0553).
     -- additional_roles is user_role[] NOT NULL DEFAULT '{}' (0332), so there
     -- is nothing to COALESCE and a text[] fallback would fail on type.
     WHERE p.id = v_uuid
       AND (p.role = 'trainer' OR 'trainer' = ANY(p.additional_roles));

    IF NOT FOUND THEN
      INSERT INTO public.share_preview_misses DEFAULT VALUES;
      IF random() < 0.01 THEN PERFORM public.prune_share_preview_misses(); END IF;
      RETURN jsonb_build_object('found', false);
    END IF;

    v_gym := public.share_preview_gym(v_trn.gym_id);
    IF v_gym IS NULL THEN
      RETURN jsonb_build_object('found', false);
    END IF;

    -- Full name, not first name: a trainer's card is a business card. They
    -- generated this link precisely so people would know who they are.
    RETURN jsonb_build_object(
      'found', true,
      'kind',  'trainer',
      'gym',   v_gym,
      'trainer', jsonb_build_object(
        'full_name',  NULLIF(trim(coalesce(v_trn.full_name, '')), ''),
        'tagline',    NULLIF(trim(coalesce(v_trn.trainer_tagline, '')), ''),
        'avatar_url', v_trn.avatar_url
      )
    );
  END IF;

  -- ── friend ────────────────────────────────────────────────────────────────
  -- /add-friend/:code. A regular member, not a public-facing trainer, so this
  -- is the most conservative branch: first name and the gym, nothing else.
  IF v_kind = 'friend' THEN
    SELECT p.full_name, p.gym_id
      INTO v_full_name, v_gym_id
      FROM public.profiles p
      JOIN public.gyms g ON g.id = p.gym_id AND g.is_active = TRUE
     WHERE p.friend_code = v_id;

    IF v_gym_id IS NULL THEN
      INSERT INTO public.share_preview_misses DEFAULT VALUES;
      IF random() < 0.01 THEN PERFORM public.prune_share_preview_misses(); END IF;
      RETURN jsonb_build_object('found', false);
    END IF;

    v_gym := public.share_preview_gym(v_gym_id);
    IF v_gym IS NULL THEN
      RETURN jsonb_build_object('found', false);
    END IF;

    v_first := split_part(trim(coalesce(v_full_name, '')), ' ', 1);

    -- friend_code is 8 hex chars — brute-forceable in bulk. Same budget as
    -- referral: sustained misses mean someone is scraping, so names stop and
    -- the card degrades to the gym alone.
    SELECT COUNT(*) INTO v_misses
      FROM public.share_preview_misses
     WHERE missed_at >= now() - INTERVAL '1 hour';
    IF v_misses >= 60 THEN
      v_first := NULL;
    END IF;

    RETURN jsonb_build_object(
      'found', true,
      'kind',  'friend',
      'gym',   v_gym,
      'friend_first_name', NULLIF(v_first, '')
    );
  END IF;

  -- Unknown kind
  RETURN jsonb_build_object('found', false);
END;
$$;

-- CREATE OR REPLACE preserves the existing ACL, so the 0653 grants stand. They
-- are repeated here only so this file is self-contained if replayed alone.
GRANT EXECUTE ON FUNCTION public.get_share_preview(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_share_preview(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
