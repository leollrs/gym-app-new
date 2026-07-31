-- ============================================================
-- 0656 — Scope the share-preview enumeration guard per kind
-- ============================================================
-- 0653 introduced share_preview_misses as an anti-enumeration budget: too many
-- lookups that find nothing in an hour looks like scraping, so the inviter's
-- first name stops coming back and only the gym remains. 0655 then wired three
-- more kinds into the SAME budget.
--
-- THE PROBLEM: it is ONE GLOBAL COUNTER. No gym, no IP, no kind.
--
--   * 60 requests an hour — free, from a laptop, with the public anon key —
--     and NO gym anywhere on the platform shows "Leonel te invita a Casa
--     Hierro" for the next hour. Repeat hourly, indefinitely.
--
--   * It trips on its own. 0655 made `invite`, `trainer` and `friend` misses
--     feed the same bucket, and an invite link lives forever in a group chat:
--     every crawler that re-unfurls a CLAIMED invite books another miss. A gym
--     mid-rollout can burn the platform's whole budget by itself.
--
-- Scoping per kind is the cheap, correct half of the fix: a flood of bogus
-- invite codes can no longer silence referral cards, and a kind that misses for
-- ordinary reasons is quarantined from the ones that don't.
--
-- Also here: `used`/`expired` invites stop counting as misses at all. Those are
-- REAL codes that were simply spent — the opposite of an enumeration signal,
-- and previously the single largest source of organic misses.
--
-- NOT fixed here (needs a request-identity the RPC does not receive): the
-- counter still can't tell one caller from many. Per-IP scoping belongs in the
-- edge middleware, which does see the address.
--
-- The function body below is 0655's, VERBATIM, with exactly three mechanical
-- edits applied: the four miss INSERTs now record `kind`, the two budget COUNTs
-- now filter on it, and the invite branch skips recording a spent code. Do not
-- hand-retype it — regenerate from 0655 if it ever needs to change again.
-- ============================================================

-- 1) Record WHICH kind missed. Nullable + no backfill: existing rows predate the
--    column and age out of the 1-hour window on their own within the hour.
ALTER TABLE public.share_preview_misses
  ADD COLUMN IF NOT EXISTS kind TEXT;

-- The budget query filters on (missed_at, kind) now.
-- 0653 created idx_share_preview_misses_time on (missed_at DESC). The budget
-- query now filters on kind too; keep the old index (prune still scans by time
-- alone) and add the composite the new WHERE actually wants.
CREATE INDEX IF NOT EXISTS idx_share_preview_misses_kind_time
  ON public.share_preview_misses (kind, missed_at DESC);

-- 2) prune_share_preview_misses was left anon-callable (PL/pgSQL functions
--    default to EXECUTE TO PUBLIC and 0653 never revoked it, unlike its sibling
--    share_preview_gym). Harmless today — it only deletes rows older than the
--    window — but it is an evasion the moment that interval changes.
REVOKE ALL ON FUNCTION public.prune_share_preview_misses() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_share_preview_misses() FROM anon;
REVOKE ALL ON FUNCTION public.prune_share_preview_misses() FROM authenticated;

-- 3) The function, regenerated from 0655.
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
       AND used_at IS NULL
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

-- CREATE OR REPLACE preserves the ACL; repeated so this file replays standalone.
GRANT EXECUTE ON FUNCTION public.get_share_preview(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_share_preview(TEXT, TEXT) TO authenticated;
