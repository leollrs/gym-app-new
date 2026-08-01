-- 0663_trainer_social_handles.sql
-- purpose: let a trainer publish Instagram / Facebook handles on their public
--          profile, next to the existing in-app Message and Call actions.
--
-- Stored as BARE HANDLES, never as URLs. The client reduces input to a
-- character whitelist (src/lib/socialHandles.js) before writing and again
-- before building the href, so a stored value can't become `javascript:` or
-- point at another host. The CHECK below is the same rule at the DB level, so
-- anything writing outside the app (SQL console, a future admin tool) can't
-- park a URL in here either.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trainer_instagram TEXT,
  ADD COLUMN IF NOT EXISTS trainer_facebook  TEXT;

-- Instagram: letters, digits, period, underscore (max 30 — Instagram's own cap).
--
-- Facebook needs more than a bare username, because a profile's address can
-- legitimately carry a path prefix and the prefix is load-bearing:
--     facebook.com/p/Leonel-Llorens-61590619448098
--     facebook.com/pages/Gym-PR/123456789
--     facebook.com/people/Leo/61590619448098
-- Only that fixed set of prefixes may contain a slash, and each segment is
-- still whitelisted — so a stored value can never carry a scheme or a host.
--
-- DROP-then-ADD rather than add-if-missing: this migration is re-runnable, and
-- an add-if-missing guard would silently keep an older, stricter CHECK in place
-- on a database where an earlier version of 0663 already ran.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_trainer_instagram_handle,
  DROP CONSTRAINT IF EXISTS profiles_trainer_facebook_handle;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_trainer_instagram_handle
  CHECK (trainer_instagram IS NULL OR trainer_instagram ~ '^[A-Za-z0-9._]{1,30}$');

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_trainer_facebook_handle
  CHECK (
    trainer_facebook IS NULL
    OR trainer_facebook ~ '^(?:(?:p|pages|people|groups)/[A-Za-z0-9.-]{1,80}(?:/[A-Za-z0-9.-]{1,80})?|[A-Za-z0-9.-]{1,100})$'
  );

COMMENT ON COLUMN public.profiles.trainer_instagram IS
  'Bare Instagram handle (no @, no URL). Rendered as instagram.com/<handle> on the public trainer profile.';
COMMENT ON COLUMN public.profiles.trainer_facebook IS
  'Bare Facebook username, page slug, or numeric profile id. Rendered as facebook.com/<handle>.';

-- ───────────────────────────────────────────────────────────────
-- get_trainer_public_profile — rebuilt from the LATEST definition
-- (0553, which added the photo masking), plus the two new columns.
-- Rebuilding from 0391 instead would silently drop that masking.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_trainer_public_profile(p_trainer_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    UUID := auth.uid();
  _gym_id UUID;
  _result JSON;
BEGIN
  SELECT gym_id INTO _gym_id FROM profiles WHERE id = _uid;
  IF _gym_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT row_to_json(t) INTO _result
  FROM (
    SELECT p.id, p.full_name, p.username,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) OR p.id = _uid THEN p.avatar_url END AS avatar_url,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) OR p.id = _uid THEN p.avatar_type
                WHEN p.avatar_type = 'photo' THEN NULL
                ELSE p.avatar_type END AS avatar_type,
           CASE WHEN COALESCE(p.trainer_photo_visible, TRUE) OR p.id = _uid THEN p.avatar_value
                WHEN p.avatar_type = 'photo' THEN NULL
                ELSE p.avatar_value END AS avatar_value,
           p.bio,
           p.trainer_tagline, p.trainer_cover_url, p.trainer_years_exp,
           p.trainer_location, p.trainer_pronouns, p.trainer_specialties,
           p.trainer_credentials, p.trainer_services, p.trainer_availability,
           p.trainer_verified, p.trainer_directory_visible,
           p.trainer_instagram, p.trainer_facebook,
           p.phone_number, p.gym_id, p.role
      FROM profiles p
     WHERE p.id = p_trainer_id
       AND p.gym_id = _gym_id
       AND (p.role = 'trainer' OR 'trainer' = ANY(p.additional_roles))
  ) t;

  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trainer_public_profile(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
