-- ============================================================================
-- 0653 — Public share preview: gym website, join offer, and get_share_preview
-- ============================================================================
-- Foundation for the white-label share work. Everything an ANONYMOUS visitor
-- needs to render a branded preview — the OG card a crawler fetches, and the
-- landing page a human without the app lands on — comes from the one RPC at the
-- bottom of this file.
--
-- Today every shared URL returns the same static OG block from index.html, and
-- a visitor without the app who taps a class link hits a login wall
-- (App.jsx:1501) while a referral link dumps them on a bare signup form
-- (App.jsx:1584). Both need gym name, logo and colours WITHOUT a session.
-- `gym_branding` is gated to `current_gym_id()` (0002:97), so an anonymous
-- caller sees nothing — hence SECURITY DEFINER.
--
-- Sections:
--   A. gyms.website_url                — where /g/:slug sends humans
--   B. referral_config.join_offer      — human-readable offer for non-members
--   C. gyms_public                     — expose website_url on the existing view
--   D. generate_referral_code          — 4 → 8 hex chars for NEW codes
--   E. share_preview_misses            — enumeration guard
--   F. get_share_preview(kind, id)     — the anon-callable entry point
--
-- All additive. Nothing is dropped, no existing behaviour changes.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- A. gyms.website_url
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every gym gets a website built as part of onboarding, so this is populated by
-- construction rather than hopefully. It is the destination `/g/:slug` redirects
-- a human to after the crawler has already been served the branded card.
--
-- NOTE: the `gyms_select_anon_active` policy (0110:48) exposes every column of
-- an active gym to anonymous callers, so this column is public the moment it
-- exists. That is fine for a website URL — it is meant to be public — but it is
-- worth remembering before adding anything sensitive to this table.

ALTER TABLE public.gyms ADD COLUMN IF NOT EXISTS website_url TEXT;

COMMENT ON COLUMN public.gyms.website_url IS
  'Public website for the gym. Shown on share landings and used as the redirect target for /g/:slug. Built for the gym during onboarding.';


-- ════════════════════════════════════════════════════════════════════════════
-- B. referral_config.join_offer
-- ════════════════════════════════════════════════════════════════════════════
--
-- `referral_config` already carries `referrer_reward` / `referred_reward`, but
-- both are POINTS (0116:51). Points are meaningless to someone who has never
-- heard of the app — "2,000 Points" persuades nobody to walk into a gym. The
-- offer that converts a stranger is "50% off your first month", written by the
-- gym owner, swappable whenever they want to run something different.
--
-- One active offer per gym, free text. Not a table of offers: a single editable
-- record is already "interchangeable", and history/A-B is a different build that
-- nothing here blocks.
--
-- `headline_en` is optional and falls back to `headline`. Gym owners here write
-- in Spanish; English-speaking members should not see an empty card.
--
-- `ends_on` is a CAMPAIGN date the gym sets — one date for everyone. Deliberately
-- NOT a per-visitor countdown: a timer that restarts for each person is a lie,
-- and people compare screenshots.

ALTER TABLE public.gyms
  ALTER COLUMN referral_config SET DEFAULT '{
  "enabled": false,
  "referrer_reward": { "type": "points", "points": 5000, "label": "5,000 Points" },
  "referred_reward": { "type": "points", "points": 2000, "label": "2,000 Points" },
  "max_referrals_per_month": null,
  "require_admin_approval": false,
  "join_offer": {
    "enabled": false,
    "headline": null,
    "headline_en": null,
    "detail": null,
    "ends_on": null
  }
}'::jsonb;

-- Backfill existing gyms so the admin UI always has a shape to edit.
UPDATE public.gyms
   SET referral_config = COALESCE(referral_config, '{}'::jsonb) || jsonb_build_object(
         'join_offer', jsonb_build_object(
           'enabled',     false,
           'headline',    NULL,
           'headline_en', NULL,
           'detail',      NULL,
           'ends_on',     NULL
         )
       )
 WHERE referral_config IS NULL
    OR NOT (referral_config ? 'join_offer');


-- ════════════════════════════════════════════════════════════════════════════
-- C. gyms_public — add website_url
-- ════════════════════════════════════════════════════════════════════════════
--
-- The security-barrier view anon already reads for signup (0110:64). Adding the
-- website keeps the "use the view, not the table" path viable for the client.
-- Column list is otherwise unchanged.

CREATE OR REPLACE VIEW public.gyms_public
  WITH (security_barrier = true)
AS
  SELECT id, name, slug, website_url, is_active
  FROM public.gyms
  WHERE is_active = TRUE;

GRANT SELECT ON public.gyms_public TO anon;
GRANT SELECT ON public.gyms_public TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- D. generate_referral_code — widen NEW codes from 4 to 8 hex chars
-- ════════════════════════════════════════════════════════════════════════════
--
-- The code is `REF-<GYM4>-<4 hex>`. The prefix is derived from the gym NAME, so
-- it is guessable, leaving 16^4 = 65,536 possibilities. That was survivable
-- while the code only fed signup. Section F makes a code resolve to a member's
-- first name over an ANONYMOUS endpoint, which turns 65k guesses into a roster
-- of who trains at that gym.
--
-- 16^8 = 4.3 billion kills enumeration outright. Existing codes are NOT rewritten
-- — they are already printed on invites and sitting in people's chat history —
-- so section E still guards the short ones that remain in circulation.
--
-- Body is otherwise identical to 0232:161 (the authoritative version): same
-- auth.uid() check, same ON CONFLICT / collision-retry behaviour.

CREATE OR REPLACE FUNCTION public.generate_referral_code(p_profile_id UUID, p_gym_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code TEXT;
  gym_short TEXT;
BEGIN
  IF p_profile_id != auth.uid() THEN
    RAISE EXCEPTION 'Can only generate own referral code';
  END IF;

  SELECT upper(substr(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'), 1, 4))
  INTO gym_short FROM gyms WHERE id = p_gym_id;

  LOOP
    -- 8 hex chars (was 4) — see the note above.
    new_code := 'REF-' || COALESCE(gym_short, 'GYM') || '-' || upper(substr(md5(random()::text), 1, 8));
    BEGIN
      INSERT INTO referral_codes (profile_id, gym_id, code)
      VALUES (p_profile_id, p_gym_id, new_code)
      ON CONFLICT (profile_id, gym_id) DO NOTHING;

      IF FOUND THEN
        RETURN new_code;
      ELSE
        SELECT code INTO new_code FROM referral_codes WHERE profile_id = p_profile_id AND gym_id = p_gym_id;
        RETURN new_code;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- E. share_preview_misses — enumeration guard
-- ════════════════════════════════════════════════════════════════════════════
--
-- Codes already in circulation are still 4 hex chars, so section D alone does
-- not protect them. The guard here is deliberately shaped around the attack:
--
--   A REAL visitor opens ONE code and it HITS. Hits are never limited — a
--   legitimate referral link must always work, no exceptions.
--
--   An ENUMERATOR misses ~65,000 times to find one hit. So the budget is spent
--   on MISSES, and once it is exhausted the function stops returning the field
--   being harvested (`referrer_first_name`) for everyone, briefly. The attacker
--   turns off the very thing they are digging for; the landing page still
--   renders, just without "Leonel invited you".
--
-- Degrade, never fail: a public landing that 500s is worse than one that is a
-- little less personal for an hour.
--
-- 60 misses/hour is enormous headroom for real traffic (a real miss is someone
-- typing a code wrong) and reduces a 65k-guess sweep to roughly 45 days.

CREATE TABLE IF NOT EXISTS public.share_preview_misses (
  id        BIGSERIAL PRIMARY KEY,
  missed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_share_preview_misses_time
  ON public.share_preview_misses (missed_at DESC);

ALTER TABLE public.share_preview_misses ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER function below touches this table.

-- Append-only; nothing here needs history beyond the window.
CREATE OR REPLACE FUNCTION public.prune_share_preview_misses()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.share_preview_misses WHERE missed_at < now() - INTERVAL '2 hours';
$$;


-- ── Gym block builder ───────────────────────────────────────────────────────
-- Shared by every `kind`. SECURITY DEFINER because gym_branding is gated to
-- current_gym_id() and an anonymous caller has none. Returns NULL for an
-- inactive or unknown gym, which is what makes every caller below fall through
-- to `found: false` for free.
CREATE OR REPLACE FUNCTION public.share_preview_gym(p_gym_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'name',            g.name,
    'slug',            g.slug,
    'address',         g.address,
    'website_url',     g.website_url,
    'logo_url',        b.logo_url,
    'primary_color',   COALESCE(b.primary_color,   '#D4AF37'),
    'secondary_color', COALESCE(b.secondary_color, '#0F172A'),
    'accent_color',    COALESCE(b.accent_color,    '#10B981')
  )
  FROM public.gyms g
  LEFT JOIN public.gym_branding b ON b.gym_id = g.id
  WHERE g.id = p_gym_id
    AND g.is_active = TRUE;
$$;

-- Internal helper only — never called directly by a client.
REVOKE ALL ON FUNCTION public.share_preview_gym(UUID) FROM PUBLIC, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- F. get_share_preview(kind, id) — the anon-callable entry point
-- ════════════════════════════════════════════════════════════════════════════
--
-- Returns ONLY what a public preview needs: gym branding, the shared item's
-- title/image, and (for referrals) the inviter's FIRST NAME. No emails, no
-- phones, no member lists, no counts, no ids beyond what the caller already
-- holds in the URL. Anything added here is public — treat that as the bar.
--
--   kind = 'referral'  → p_id is a referral CODE      (REF-XXXX-…)
--   kind = 'class'     → p_id is a gym_class_schedules.id (UUID)
--   kind = 'gym'       → p_id is a gym SLUG
--
-- Always returns a JSON object. `found: false` is the answer for unknown,
-- inactive, or malformed input — never an exception, because a crawler that
-- gets a 500 caches the failure.

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

  -- Unknown kind
  RETURN jsonb_build_object('found', false);
END;
$$;

-- Anonymous by design: the whole point is a visitor with no account and no app.
GRANT EXECUTE ON FUNCTION public.get_share_preview(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_share_preview(TEXT, TEXT) TO authenticated;


-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
