-- ============================================================
-- 0672 — friend_code stops being a public column, and friendship
--        stops being a second door into a member's full profile
-- ============================================================
-- ⚠️ APPLY ON STAGING FIRST.
--
-- Three pieces that are each defensible alone and, chained, undo 0296 and 0657
-- completely:
--
--   1. `gym_member_profiles_safe` (0569) and its RPC twin (0289) publish
--      `friend_code` for EVERY member of the gym.
--   2. `add_friend_by_code` (0563) turns a code into an ACCEPTED friendship
--      immediately, one-sided, no notification. Its comment states the premise:
--      "adding someone via their shared code/link is explicit mutual consent
--      (they handed you the code)".
--   3. `profiles_friends_select` (0289) grants a **trainer** full-column SELECT
--      on any accepted friend's profile row.
--
-- So: read any member's code off the safe view → call the RPC → you are now
-- their friend → read their phone number, date of birth, bodyweight, address,
-- admin notes, medical notes. No consent, no request, nothing on their screen.
--
-- 0296 had deliberately narrowed `profiles_select` so trainers get full columns
-- only where `is_trainer_of()` holds, and 0657 put the member's yes/no inside
-- that helper. `profiles_friends_select` is a parallel grant that neither one
-- looks at — the work of both migrations, walked around in two RPC calls.
--
-- ── What this changes ─────────────────────────────────────────────────────
-- Premise 1 is the false one. A code you can look up is not a code someone
-- handed you, so the fix is to make it true again rather than to take away the
-- instant-add the product deliberately chose (0563 supersedes 0558 on purpose).
-- friend_code is masked to its owner in both readers, so the only way to get
-- someone's code is still the way the UI gives it out: they share it.
--
-- And premise 3 goes entirely. A friendship is not a clinical relationship, so
-- it should never have carried PII access:
--   • trainers keep full columns for their consented clients (0296 + 0657),
--   • admins and super_admins already read every same-gym profile through
--     `profiles_select`, so nothing they can do today is lost — the only reach
--     this policy added for them was into OTHER gyms, which is a cross-tenant
--     leak, not a feature,
--   • everyone else keeps the safe view, which is what they already used.
--
-- The column is masked, not dropped: CREATE OR REPLACE VIEW cannot drop a
-- column, and DROP VIEW would take the grants and any dependent object with it.
-- Same column, same type, same position — an expression change only. Nothing in
-- the app reads friend_code from either reader (both places that show it query
-- `profiles` for the caller's own row), so this is invisible.
-- ============================================================

-- ⚠️ RUN THE THREE BLOCKS BELOW SEPARATELY, one at a time — same reason 0671
-- has to be split. This file also takes an ACCESS EXCLUSIVE lock on two objects
-- the app reads constantly (`gym_member_profiles_safe` and `profiles`), and
-- holding one while waiting for the other is what deadlocked 0671 against live
-- traffic. One exclusive lock per block, with a lock_timeout so a blocked block
-- aborts instead of queueing every later request behind it. Each block is an
-- independent tightening, so stopping between them is safe.
-- ============================================================

-- ═══════════════ BLOCK 1 — the view (ACCESS EXCLUSIVE) ════════════════════
SET lock_timeout = '5s';

-- ── 1. The view ───────────────────────────────────────────────────────────
-- Rebuilt from 0569's column list verbatim, in order, with ONE expression
-- changed. Diff against 0569 before applying.
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
    CASE WHEN p.id = auth.uid() THEN p.friend_code END AS friend_code,
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

NOTIFY pgrst, 'reload schema';

-- ═══════════════ BLOCK 2 — the RPC twin (no table locks) ══════════════════
-- ── 2. The RPC twin ───────────────────────────────────────────────────────
-- Same signature and RETURNS TABLE as 0289 (unchanged, so CREATE OR REPLACE is
-- legal); same body except the one column.
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
    CASE WHEN p.id = auth.uid() THEN p.friend_code END,
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

NOTIFY pgrst, 'reload schema';

-- ═══════════════ BLOCK 3 — profiles (ACCESS EXCLUSIVE) ════════════════════
-- ── 3. Friendship is not consent ──────────────────────────────────────────
SET lock_timeout = '5s';

DROP POLICY IF EXISTS "profiles_friends_select" ON profiles;

NOTIFY pgrst, 'reload schema';
