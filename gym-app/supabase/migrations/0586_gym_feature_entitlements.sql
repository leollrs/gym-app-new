-- ============================================================================
-- 0586 — Per-gym feature entitlements                       (audit: completeness-1 / H4)
-- ============================================================================
-- The Operations kill switches (platform_config feature_<name>, read by
-- get_platform_flags) are FLEET-WIDE only. An operator routinely needs to turn
-- a capability off for ONE tenant (kill messaging for an abusive gym, hide
-- social for a corporate-wellness client, gate AI/nutrition behind a plan).
--
-- Model: the GLOBAL flag stays the emergency master kill (off = off everywhere).
-- A per-gym row in gym_entitlements with enabled=false additionally disables the
-- feature for THAT gym. Missing row = enabled (default on). So the effective
-- value = global_master AND (no explicit per-gym disable). This is a denylist:
-- to gate a feature to a subset of gyms, leave it globally on and disable it for
-- the others.
--
-- The member app reads the merged result via get_effective_feature_flags()
-- (swapped in for get_platform_flags in usePlatformFlags), preserving the
-- existing fail-open behavior.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gym_entitlements (
  gym_id     uuid        NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  feature    text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (gym_id, feature)
);

ALTER TABLE public.gym_entitlements ENABLE ROW LEVEL SECURITY;

-- super_admin manages every gym's entitlements (the platform Features card
-- upserts/deletes directly under this policy — no management RPC needed).
DROP POLICY IF EXISTS gym_entitlements_super_admin_all ON public.gym_entitlements;
CREATE POLICY gym_entitlements_super_admin_all ON public.gym_entitlements
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- members can read their OWN gym's entitlements (harmless, and lets the app
-- read them directly if ever needed; the effective-flags RPC is the real path).
DROP POLICY IF EXISTS gym_entitlements_member_select ON public.gym_entitlements;
CREATE POLICY gym_entitlements_member_select ON public.gym_entitlements
  FOR SELECT USING (gym_id = public.current_gym_id());

-- ── Effective flags = global master kill AND per-gym override ───────────────
-- Reuses get_platform_flags() verbatim for the global part (so the master-kill
-- semantics can never drift), then turns OFF any feature the caller's gym has
-- explicitly disabled. Same fail-open spirit: only an explicit per-gym `false`
-- disables; the global flag still wins when it is off.
CREATE OR REPLACE FUNCTION public.get_effective_feature_flags()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym   uuid  := public.current_gym_id();
  v_flags jsonb := public.get_platform_flags();
  k       text;
  v_on    boolean;
BEGIN
  IF v_gym IS NULL THEN
    RETURN v_flags;  -- no gym context (anon / unscoped) → global flags only
  END IF;
  FOR k, v_on IN
    SELECT feature, enabled FROM gym_entitlements WHERE gym_id = v_gym
  LOOP
    IF v_on = false AND v_flags ? k THEN
      v_flags := v_flags || jsonb_build_object(k, false);
    END IF;
  END LOOP;
  RETURN v_flags;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_effective_feature_flags() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_effective_feature_flags() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
