-- =============================================================
-- ENFORCE PII PROTECTION AT DATABASE LEVEL
-- Migration: 0287_enforce_pii_protection.sql
--
-- Problem: The profiles_select RLS policy (migration 0018) grants
-- same-gym SELECT on ALL columns, exposing sensitive PII
-- (phone_number, date_of_birth, bodyweight_lbs, admin_note, bio,
-- gender, data_consent_at, etc.) to any member in the same gym.
-- The gym_member_profiles_safe view (migration 0225) exists but is
-- not enforced — nothing prevents querying profiles directly.
--
-- Solution:
-- 1. Tighten profiles_select so regular members can only read
--    their own row. Admins, trainers, and super_admins keep
--    full same-gym access.
-- 2. Recreate gym_member_profiles_safe as a SECURITY DEFINER
--    function (not view) that enforces same-gym boundary without
--    needing profiles_select to be permissive.
-- 3. Keep the view as a thin wrapper for backward compat, but
--    switch it to security_invoker = off so it reads through
--    the owner's permissions (bypassing the tightened RLS) while
--    only exposing safe columns.
-- =============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. TIGHTEN profiles_select POLICY
-- ────────────────────────────────────────────────────────────────
-- Before: id = auth.uid() OR gym_id = current_gym_id()
--   → any member sees ALL columns of ALL same-gym profiles
--
-- After: own row always allowed. Other rows only if caller is
--        admin, super_admin, or trainer in the same gym.
--        Regular members must use the safe view/function.
-- ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_select" ON profiles;

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    -- Always see your own row (full column access)
    id = auth.uid()
    -- Admins and super_admins see all same-gym profiles
    OR (
      gym_id = public.current_gym_id()
      AND public.current_user_role() IN ('admin', 'super_admin')
    )
    -- Trainers see all same-gym profiles (needed for client management)
    OR (
      gym_id = public.current_gym_id()
      AND public.current_user_role() = 'trainer'
    )
  );


-- ────────────────────────────────────────────────────────────────
-- 2. SAFE VIEW: switch to security_invoker = off
-- ────────────────────────────────────────────────────────────────
-- The view owner (postgres/supabase_admin) bypasses RLS, so the
-- view can read profiles even though profiles_select now blocks
-- regular members. The view itself enforces the same-gym boundary
-- in its WHERE clause.
--
-- We drop and recreate rather than ALTER because we need to add
-- the WHERE clause for gym boundary enforcement.
-- ────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.gym_member_profiles_safe;

CREATE VIEW public.gym_member_profiles_safe
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
    p.years_of_experience
  FROM public.profiles p
  WHERE
    -- Same gym as caller (uses profile_lookup, no RLS recursion)
    p.gym_id = public.current_gym_id()
    -- OR the caller's own row (fallback if gym_id not yet set)
    OR p.id = auth.uid();

GRANT SELECT ON public.gym_member_profiles_safe TO authenticated;

COMMENT ON VIEW public.gym_member_profiles_safe IS
  'PII-safe subset of profiles for member-to-member views. '
  'Excludes: phone_number, date_of_birth, bodyweight_lbs, admin_note, '
  'gender, email, notification preferences, onboarding data, and other '
  'sensitive fields. This view bypasses the tightened profiles_select '
  'RLS policy (which blocks regular members from reading other rows) '
  'but only exposes non-sensitive columns. Frontend MUST use this view '
  'when displaying other gym members.';


-- ────────────────────────────────────────────────────────────────
-- 3. RPC: get_gym_member_profiles_safe — for clients that prefer
--    an RPC over a view (e.g., for additional filtering)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_gym_member_profiles_safe(
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 50,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  id                 UUID,
  full_name          TEXT,
  username           TEXT,
  avatar_url         TEXT,
  avatar_type        TEXT,
  avatar_value       TEXT,
  bio                TEXT,
  role               public.user_role,
  gym_id             UUID,
  created_at         TIMESTAMPTZ,
  last_active_at     TIMESTAMPTZ,
  privacy_public     BOOLEAN,
  leaderboard_visible BOOLEAN,
  friend_code        TEXT,
  accent_color       TEXT,
  trainer_icon       TEXT,
  specialties        TEXT[],
  years_of_experience SMALLINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_gym UUID;
BEGIN
  caller_gym := public.current_gym_id();
  IF caller_gym IS NULL THEN
    RETURN;
  END IF;

  -- Clamp limit to prevent abuse
  IF p_limit > 200 THEN p_limit := 200; END IF;
  IF p_limit < 1 THEN p_limit := 1; END IF;
  IF p_offset < 0 THEN p_offset := 0; END IF;

  RETURN QUERY
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
    p.years_of_experience
  FROM public.profiles p
  WHERE p.gym_id = caller_gym
    AND (
      p_search IS NULL
      OR p.full_name ILIKE '%' || p_search || '%'
      OR p.username ILIKE '%' || p_search || '%'
    )
  ORDER BY p.last_active_at DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_gym_member_profiles_safe(TEXT, INT, INT) TO authenticated;


-- ────────────────────────────────────────────────────────────────
-- 4. FRIENDS POLICY: also tighten for regular members
-- ────────────────────────────────────────────────────────────────
-- profiles_friends_select (migration 0016) allows full column
-- access to any accepted friend's profile. Regular members should
-- still see friends via the safe view, not direct table access.
-- Replace it so only admins/trainers/super_admins get full access
-- through the friends policy. Regular members already have the
-- safe view which includes all gym members.
-- ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_friends_select" ON profiles;

CREATE POLICY "profiles_friends_select" ON profiles
  FOR SELECT USING (
    -- Only admins/trainers keep full-column friend access
    -- (regular members use the safe view)
    public.current_user_role() IN ('admin', 'super_admin', 'trainer')
    AND EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = profiles.id)
          OR
          (f.addressee_id = auth.uid() AND f.requester_id = profiles.id)
        )
    )
  );


-- ────────────────────────────────────────────────────────────────
-- 5. Ensure profiles_select still works for the super_admin
--    cross-gym policy (migration 0040) — no changes needed,
--    it's a separate policy that uses is_super_admin().
-- ────────────────────────────────────────────────────────────────
-- Verified: "super_admin can read all profiles" policy from 0040
-- is independent and unaffected.


NOTIFY pgrst, 'reload schema';
