-- ============================================================
-- 0539 — Maintenance mode: estimated-time support
-- ============================================================
-- get_maintenance_status() (0436) returned only {enabled, message}. The
-- founder wants the lock screen to show an estimated return time, so the
-- RPC now also exposes 'eta' — an ISO timestamp stored in platform_config
-- under 'maintenance_eta' (written by the new Operations enable flow,
-- cleared on disable by writing ''). NULLIF guards turn cleared/blank
-- values back into JSON null so the client only renders real ETAs.
-- Grants unchanged: anon + authenticated can read ONLY this projection,
-- never platform_config itself (super_admin-only per 0277).
-- ============================================================

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
      NULLIF((SELECT value #>> '{}' FROM platform_config WHERE key = 'maintenance_message'), ''),
    'eta',
      NULLIF((SELECT value #>> '{}' FROM platform_config WHERE key = 'maintenance_eta'), '')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_maintenance_status() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_maintenance_status() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
