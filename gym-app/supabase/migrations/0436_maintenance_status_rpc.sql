-- =============================================================
-- 0436_maintenance_status_rpc.sql
--
-- Makes "maintenance mode" actually work. The platform_config table is
-- super_admin-only (RLS, 0277), so members could never read the flag — which
-- is why toggling maintenance in Operations did nothing to their apps.
--
-- This SECURITY DEFINER RPC exposes ONLY the maintenance flag + message to
-- anyone (anon + authenticated), without opening up the rest of platform_config.
-- The client polls it and, when enabled, shows a full-screen maintenance gate
-- to every non-super-admin (super admins stay in so they can turn it back off).
--
-- Optional 'maintenance_message' key in platform_config overrides the default
-- copy shown on the screen.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_maintenance_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'enabled',
      COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'maintenance_mode'), 'false') = 'true',
    'message',
      (SELECT value #>> '{}' FROM platform_config WHERE key = 'maintenance_message')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_maintenance_status() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_maintenance_status() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
