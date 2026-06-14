-- ============================================================
-- Structured name columns on profiles: first_name + last_name
-- (first_name = given name; last_name = FIRST surname / apellido).
--
-- Names were stored only as a single `full_name` string, so compact UI
-- (leaderboards, podiums, participant lists) had to guess "first name +
-- first last name" by parsing — which grabbed the middle name. These
-- columns hold the real values: captured directly at signup (which already
-- collects first/middle/apellido1/apellido2 separately), and backfilled for
-- existing rows from full_name with the same first-name + first-surname rule.
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name  text;

-- Backfill existing rows from full_name. PR/Latino names carry two apellidos,
-- so for 3+ tokens the first surname is the SECOND-TO-LAST token (this skips
-- any middle / second given name); for exactly 2 tokens it's the last token.
-- Mirrors the client shortName() + Signup.splitFullName heuristic. Only fills
-- rows that don't already have the columns set (idempotent / re-runnable).
WITH parsed AS (
  SELECT
    id,
    string_to_array(regexp_replace(btrim(full_name), '\s+', ' ', 'g'), ' ') AS a
  FROM public.profiles
  WHERE full_name IS NOT NULL AND btrim(full_name) <> ''
)
UPDATE public.profiles p SET
  first_name = parsed.a[1],
  last_name  = CASE
                 WHEN cardinality(parsed.a) >= 3 THEN parsed.a[cardinality(parsed.a) - 1]
                 WHEN cardinality(parsed.a) =  2 THEN parsed.a[2]
                 ELSE NULL
               END
FROM parsed
WHERE p.id = parsed.id
  AND p.first_name IS NULL
  AND p.last_name  IS NULL;

-- Expose the two columns on the member-safe view. CREATE OR REPLACE (not DROP)
-- preserves existing grants; the columns are APPENDED after the exact existing
-- list/order from migration 0289, and security_invoker=off + the same-gym/own
-- filter are kept verbatim so privacy is unchanged.
CREATE OR REPLACE VIEW public.gym_member_profiles_safe
WITH (security_invoker = off)
AS
  SELECT
    p.id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.avatar_type,
    p.avatar_value,
    p.bio,
    p.role,
    p.gym_id,
    p.created_at,
    p.last_active_at,
    p.privacy_public,
    p.leaderboard_visible,
    p.friend_code,
    p.accent_color,
    p.trainer_icon,
    p.specialties,
    p.years_of_experience,
    p.first_name,
    p.last_name
  FROM public.profiles p
  WHERE
    p.gym_id = public.current_gym_id()
    OR p.id = auth.uid();
