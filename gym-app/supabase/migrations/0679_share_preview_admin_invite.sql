-- 0679_share_preview_admin_invite.sql
--
-- The gym-branded share card never rendered for an admin-created invite.
--
-- `get_share_preview` (0656) treats an invite as shareable only while
-- `used_at IS NULL`. Admin "Add Member" writes the gym_invites row PRE-CLAIMED
-- — used_by + used_at are set at insert, since the member profile is created in
-- the same breath — so those invites read as already spent the moment they
-- exist. The RPC answered `found: false`, middleware.js fell through to the SPA,
-- and the crawler unfurled the static index.html: the stock "TuGymPR — Train.
-- Compete. Progress." card, with no gym logo and no gym name, on every access
-- code an admin ever texted. Member-side shares (referral, class, gym) were
-- unaffected, which is exactly how it presented — "the other shares look right,
-- these don't".
--
-- Verified against production before writing this:
--   curl -A 'facebookexternalhit/1.1' https://app.tugympr.com/invite/<code>
-- returned the static index.html, not the middleware's card.
--
-- Body below is 0656's VERBATIM, with only the invite validity predicate
-- widened — same placeholder-shell rule 0603 added to
-- lookup_gym_invite_by_code, for the same reason.

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
      INSERT INTO public.share_preview_misses (kind) VALUES (v_kind);
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
     WHERE missed_at >= now() - INTERVAL '1 hour'
       AND kind = v_kind;
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
       --
       -- ...but "claimed" is not the same as "used_at IS NOT NULL". An invite
       -- created through admin "Add Member" is written PRE-CLAIMED
       -- (CreateInviteModal sets used_by + used_at at insert time, because the
       -- member row already exists), so a brand-new, never-opened invite looked
       -- spent to this branch from the second it was made. It returned found:
       -- false, middleware.js fell through, and the crawler got the generic SPA
       -- index.html — which is why every admin invite unfurled as the stock
       -- TuGymPR card while member-side shares showed the gym's.
       --
       -- Live means: never claimed, OR claimed only by a placeholder shell that
       -- has not activated yet. Exactly the rule 0603 had to teach
       -- lookup_gym_invite_by_code for the same reason.
       AND (
         used_at IS NULL
         OR EXISTS (
           SELECT 1 FROM auth.users u
            WHERE u.id = gym_invites.used_by
              AND u.email LIKE '%@%.invalid'
         )
       )
       AND (expires_at IS NULL OR expires_at > now());

    IF v_gym_id IS NULL THEN
      -- Does the code EXIST but is simply spent? Then this is not enumeration —
      -- it is a real invite someone already claimed, still sitting in a group
      -- chat and re-unfurled by every crawler that walks past it. Counting those
      -- as misses is what let ordinary traffic exhaust the budget.
      IF EXISTS (SELECT 1 FROM public.gym_invites
                  WHERE invite_code = upper(trim(v_id))) THEN
        RETURN jsonb_build_object('found', false);
      END IF;

      INSERT INTO public.share_preview_misses (kind) VALUES (v_kind);
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
      INSERT INTO public.share_preview_misses (kind) VALUES (v_kind);
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
      INSERT INTO public.share_preview_misses (kind) VALUES (v_kind);
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
     WHERE missed_at >= now() - INTERVAL '1 hour'
       AND kind = v_kind;
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

NOTIFY pgrst, 'reload schema';

-- Verify — a freshly created "Add Member" invite must now unfurl branded:
--   SELECT public.get_share_preview('invite', '<code>');   -- found: true + gym
-- and from the shell, against prod:
--   curl -A 'facebookexternalhit/1.1' https://app.tugympr.com/invite/<code> \
--     | grep -E 'og:title|og:image'
-- A genuinely spent invite (member has activated, shell replaced) must still
-- return found:false and fall back to the generic card.
