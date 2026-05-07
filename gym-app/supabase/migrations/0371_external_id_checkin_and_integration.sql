-- ============================================================
-- 0371 — External-ID check-in + per-gym integration config
-- ============================================================
-- Locks the data contract for the upcoming Tauri desktop bridge.
-- Three additive changes; no UI surfaces them yet, no existing
-- code paths change behaviour.
--
-- 1. gyms.integration_config (JSONB)
--    Per-gym sidecar config (window title match, keystroke recipe,
--    target software name). Defaults to {} so existing rows stay valid.
--
-- 2. checkin_method enum: 'external_code'
--    Distinguishes a bridge-driven keypad/badge check-in from a
--    QR scan.
--
-- 3. check_ins.source (TEXT, nullable)
--    Free-form origin tag — 'mobile_qr', 'desktop_bridge',
--    'manual_admin', 'kiosk', etc. NULL for legacy rows.
--
-- 4. RPC checkin_by_external_id(text, text)
--    Server-side reverse lookup — given a gym's existing member
--    code (profiles.qr_external_id), find the TuGymPR member and
--    record a check-in. Mirrors the JS scan handler's 3-hour
--    duplicate guard and points logic. Admin-only.
-- ============================================================

-- ── 1. integration_config column ────────────────────────────
ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS integration_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.gyms.integration_config IS
  'Per-gym desktop bridge config: { software_name, window_title_match, keystroke_recipe, fallback_passthrough }. Empty {} = no bridge configured.';

-- ── 2. checkin_method enum addition ─────────────────────────
-- Postgres requires ADD VALUE outside transactions in some cases;
-- migrations runner handles that. IF NOT EXISTS makes it idempotent.
ALTER TYPE checkin_method ADD VALUE IF NOT EXISTS 'external_code';

-- ── 3. check_ins.source column ──────────────────────────────
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN public.check_ins.source IS
  'Origin label for the check-in: mobile_qr | desktop_bridge | manual_admin | kiosk. NULL on legacy rows.';

CREATE INDEX IF NOT EXISTS idx_check_ins_source
  ON public.check_ins(gym_id, source) WHERE source IS NOT NULL;

-- ── 4. checkin_by_external_id RPC ───────────────────────────
CREATE OR REPLACE FUNCTION public.checkin_by_external_id(
  p_external_id TEXT,
  p_source      TEXT DEFAULT 'desktop_bridge'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_gym  UUID;
  v_caller_role TEXT;
  v_member      RECORD;
  v_recent      INT;
  v_pts_budget  INT := 20;          -- matches calculatePointsForAction('check_in') in lib/rewardsEngine
  v_pts_awarded INT;
  v_trimmed     TEXT;
BEGIN
  v_trimmed := nullif(trim(p_external_id), '');
  IF v_trimmed IS NULL THEN
    RAISE EXCEPTION 'external_id is required';
  END IF;

  -- Caller must be an admin in some gym
  SELECT gym_id, role INTO v_caller_gym, v_caller_role
    FROM public.profiles
   WHERE id = auth.uid();

  IF v_caller_gym IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Reverse lookup, scoped to the caller's gym so a code from gym A
  -- cannot resolve a member at gym B.
  SELECT id, full_name, avatar_url, qr_external_id
    INTO v_member
    FROM public.profiles
   WHERE gym_id = v_caller_gym
     AND qr_external_id = v_trimmed
   LIMIT 1;

  IF v_member.id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'member_not_found',
      'external_id', v_trimmed
    );
  END IF;

  -- 3-hour duplicate guard (mirrors src/lib/scanActionHandlers.js handleCheckinScan)
  SELECT COUNT(*) INTO v_recent
    FROM public.check_ins
   WHERE profile_id = v_member.id
     AND gym_id     = v_caller_gym
     AND checked_in_at >= NOW() - interval '3 hours';

  IF v_recent > 0 THEN
    RETURN json_build_object(
      'success', true,
      'duplicate', true,
      'profile_id', v_member.id,
      'member_name', v_member.full_name,
      'avatar_url', v_member.avatar_url,
      'external_id', v_member.qr_external_id
    );
  END IF;

  INSERT INTO public.check_ins (profile_id, gym_id, method, source)
  VALUES (v_member.id, v_caller_gym, 'external_code', p_source);

  -- 24h points limit lives inside add_reward_points_checked.
  -- Wrapped so a missing function (older deploys) doesn't fail the check-in.
  BEGIN
    SELECT public.add_reward_points_checked(
      v_member.id, v_caller_gym, 'check_in', v_pts_budget, 'External-code check-in'
    ) INTO v_pts_awarded;
  EXCEPTION WHEN OTHERS THEN
    v_pts_awarded := 0;
  END;

  RETURN json_build_object(
    'success', true,
    'duplicate', false,
    'profile_id', v_member.id,
    'member_name', v_member.full_name,
    'avatar_url', v_member.avatar_url,
    'external_id', v_member.qr_external_id,
    'points_awarded', COALESCE(v_pts_awarded, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkin_by_external_id(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
