-- =============================================================
-- 0542_platform_gym_onboarding.sql
--
-- ROOT CAUSE (audit P0-1a/b/d + P2-8, 2026-06-11): gym onboarding was broken
-- end-to-end at the platform tier.
--   (a) GymCreateModal called an RPC `platform_create_gym` that exists in NO
--       migration (only 0363's exempt list mentions the name) — on a fresh DB
--       Create Gym surfaced a raw error, and its fallback regexed error.message
--       for codes PostgREST puts in error.code, so it never ran either.
--   (b) The owner invite was silently never created: gym_invites' INSERT
--       policy (0022) requires gym_id = current_gym_id(), which for the
--       founder is his OWN gym — never the freshly created one. The client
--       discarded { error } and toasted success anyway.
--   (d) No platform UI could create/copy/revoke invites cross-gym at all
--       (same 0022 clamp on UPDATE/DELETE; only a SELECT arm exists via 0040).
--   (P2-8) The GymDetail rewards sub-tab needs gym_rewards rows, but the
--       0187/0266 policies clamp reads to the caller's OWN gym_id even for
--       super_admin → permanently empty cross-gym.
--
-- This migration makes the RPC real, opens super_admin write arms on
-- gym_invites, and adds a cross-gym super_admin SELECT on gym_rewards.
--
-- Conventions reused (NOT invented here):
--   * invite codes: 6-char human code via public.generate_invite_code()
--     (0107), stored in gym_invites.invite_code (unique partial index),
--     30-day expiry (0107 default), role forced to 'member' on claim (0198).
--   * gyms.plan_type is the canonical tier (0043); subscription_tier kept in
--     sync for backwards compat.
--   * platform_config key 'gym_defaults' is written by PlatformSettings as a
--     JSON *string* inside the jsonb column ({dailyCalories, trainingDays,
--     defaultLanguage, defaultTheme}). gyms has no matching columns today, so
--     the defaults snapshot is echoed back in the response (and can be applied
--     by future onboarding wiring); a 'timezone'/'country' key, if ever added
--     to the defaults JSON, IS applied to the new gym row.
--
-- ⚠️ Apply manually via Supabase Dashboard SQL Editor.
-- =============================================================

-- ── 1. platform_create_gym ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_create_gym(
  p_name        text,
  p_slug        text,
  p_owner_email text DEFAULT NULL,
  p_plan_type   text DEFAULT 'starter'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name       text;
  v_slug       text;
  v_plan       text;
  v_email      text;
  v_gym_id     uuid;
  v_code       text;
  v_invite_id  uuid;
  v_attempts   int := 0;
  v_defaults   jsonb := '{}'::jsonb;
  v_raw        jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  v_name := NULLIF(trim(p_name), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Gym name is required';
  END IF;

  -- Normalize slug (derive from name when blank): lowercase, hyphens only.
  v_slug := lower(COALESCE(NULLIF(trim(p_slug), ''), v_name));
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
  IF v_slug = '' THEN
    RAISE EXCEPTION 'Could not derive a valid slug from "%"', p_name;
  END IF;
  IF EXISTS (SELECT 1 FROM gyms WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'Slug "%" is already taken', v_slug;
  END IF;

  -- Canonical tier set (0043 + lifetime/enterprise badges used by the UI).
  v_plan := lower(COALESCE(NULLIF(trim(p_plan_type), ''), 'starter'));
  IF v_plan NOT IN ('free', 'starter', 'pro', 'lifetime', 'enterprise') THEN
    v_plan := 'starter';
  END IF;

  v_email := lower(NULLIF(trim(p_owner_email), ''));
  IF v_email IS NOT NULL AND v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'Invalid owner email "%"', v_email;
  END IF;

  -- Consult platform_config gym_defaults (tolerates both jsonb-object and
  -- json-encoded-string storage; PlatformSettings writes the latter).
  SELECT value INTO v_raw FROM platform_config WHERE key = 'gym_defaults';
  IF v_raw IS NOT NULL THEN
    BEGIN
      IF jsonb_typeof(v_raw) = 'string' THEN
        v_defaults := (v_raw #>> '{}')::jsonb;
      ELSIF jsonb_typeof(v_raw) = 'object' THEN
        v_defaults := v_raw;
      END IF;
    EXCEPTION WHEN others THEN
      v_defaults := '{}'::jsonb;  -- malformed config must not block creation
    END;
  END IF;

  -- Create the gym. plan_type canonical, subscription_tier mirrored (0043).
  -- timezone/country honoured from gym_defaults when present (gyms has no
  -- language/calories/days columns — those defaults are returned to the
  -- caller instead of being dropped on the floor).
  INSERT INTO gyms (name, slug, plan_type, subscription_tier, is_active, timezone, country)
  VALUES (
    v_name,
    v_slug,
    v_plan,
    v_plan,
    TRUE,
    COALESCE(NULLIF(trim(v_defaults->>'timezone'), ''), 'UTC'),
    NULLIF(trim(v_defaults->>'country'), '')
  )
  RETURNING id INTO v_gym_id;

  -- Owner invite (optional). Same shape admin_create_invite_code (0305)
  -- produces: human invite_code + auto token, 30-day expiry, role 'member'
  -- (claim flow forces member anyway per 0198; founder promotes after claim).
  IF v_email IS NOT NULL THEN
    LOOP
      v_code := public.generate_invite_code();
      v_attempts := v_attempts + 1;
      BEGIN
        INSERT INTO gym_invites (gym_id, created_by, email, invite_code, member_name, role, expires_at)
        VALUES (v_gym_id, auth.uid(), v_email, v_code, 'Owner', 'member', now() + interval '30 days')
        RETURNING id INTO v_invite_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempts >= 10 THEN
          RAISE EXCEPTION 'Failed to generate a unique invite code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'gym_id',      v_gym_id,
    'slug',        v_slug,
    'plan_type',   v_plan,
    'invite_code', v_code,          -- null when no owner email given
    'invite_id',   v_invite_id,
    'defaults',    v_defaults       -- echo so the caller knows what applied
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_create_gym(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_create_gym(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.platform_create_gym(text, text, text, text) IS
  'Platform-tier gym onboarding: creates the gym (plan_type canonical, '
  'subscription_tier mirrored), honours platform_config gym_defaults where '
  'columns exist, and creates the owner''s gym_invite (member role; promoted '
  'after claim). super_admin only. Returns {gym_id, slug, invite_code}.';

-- ── 2. gym_invites: super_admin write arms ──────────────────
-- 0022's policies are all clamped to current_gym_id(); 0040 added a SELECT
-- arm only. The platform tier needs INSERT (owner/staff invites for any gym),
-- UPDATE (expire) and DELETE (revoke) cross-gym.
DROP POLICY IF EXISTS "super_admin manage all gym_invites" ON gym_invites;
CREATE POLICY "super_admin manage all gym_invites" ON gym_invites
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ── 3. gym_rewards: cross-gym super_admin SELECT ────────────
-- 0266 widened the admin policy to role IN ('admin','super_admin') but kept
-- the own-gym_id clamp, so the founder still can't read another gym's reward
-- catalog. Read-only arm — writes stay gym-admin-owned.
DROP POLICY IF EXISTS "gym_rewards_super_admin_select" ON gym_rewards;
CREATE POLICY "gym_rewards_super_admin_select" ON gym_rewards
  FOR SELECT
  USING (public.is_super_admin());

NOTIFY pgrst, 'reload schema';
