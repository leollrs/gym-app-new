-- =============================================================
-- 0547_get_platform_flags.sql
--
-- Makes the Operations "feature kill switches" actually work. The platform
-- Operations page (super_admin) writes platform_config keys feature_<name>,
-- but platform_config is super_admin-only (RLS, 0277) so the member app
-- could never read them — toggling a kill switch did nothing (audit P0-3).
--
-- This SECURITY DEFINER RPC exposes ONLY the 7 kill-switch flags to anyone
-- (anon + authenticated), without opening up the rest of platform_config —
-- exactly mirroring get_maintenance_status (0436/0539).
--
-- Semantics (fail-open): a flag is FALSE only when the stored value is the
-- text 'false'; anything else — missing row, malformed value — reads TRUE,
-- so a half-applied config can never lock members out of a feature.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_platform_flags()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'referrals',  COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_referrals'),  'true') <> 'false',
    'classes',    COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_classes'),    'true') <> 'false',
    'social',     COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_social'),     'true') <> 'false',
    'messaging',  COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_messaging'),  'true') <> 'false',
    'qr',         COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_qr'),         'true') <> 'false',
    'challenges', COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_challenges'), 'true') <> 'false',
    'nutrition',  COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_nutrition'),  'true') <> 'false'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_flags() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_platform_flags() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
