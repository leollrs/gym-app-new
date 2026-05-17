-- ============================================================
-- 0393 — App version config + get_app_version RPC (client update gating)
-- ============================================================
-- Single-row config table holding the minimum app version the API expects,
-- the latest released version, and per-platform store URLs. Client polls
-- get_app_version() on cold start + every 15 min; if the client's bundled
-- version is below min_required_version, a hard-gate modal forces the
-- user to install the new build before continuing to use the app.
--
-- Bump min_required_version when shipping a breaking API change. Bump
-- latest_version on every release for parity even when not gating.
--
-- Capgo OTA interaction:
--   The app version compared on the client is the one baked into the JS
--   bundle from package.json — which means a Capgo OTA bundle's version
--   wins over the App Store binary's version. So bumping min_required to
--   force an update ALSO requires shipping a Capgo bundle whose
--   package.json version >= the new floor, otherwise users who depend on
--   Capgo for updates will see the gate even though they "have" the new
--   build. Native App Store users update via the store URL as expected.
--
-- Writes / audit:
--   Only super-admins can mutate app_config (RLS policy below). Every
--   UPDATE fires the app_config_audit trigger which appends a row to
--   audit_log so the bump shows up in the platform audit feed — this is
--   a high-blast-radius change (locks everyone out), so it needs a paper
--   trail.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_config (
  id                    INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_required_version  TEXT NOT NULL,
  latest_version        TEXT NOT NULL,
  ios_store_url         TEXT,
  android_store_url     TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (id, min_required_version, latest_version)
VALUES (1, '1.0.0', '1.0.0')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Public read — every client (including pre-auth signup screens) needs to
-- know the gating version.
DROP POLICY IF EXISTS "app_config_read_all" ON app_config;
CREATE POLICY "app_config_read_all"
  ON app_config FOR SELECT
  TO authenticated, anon
  USING (TRUE);

-- Super-admin writes — bumping min_required_version locks everyone else
-- out, so it's strictly a platform-tier action. is_super_admin() is the
-- helper introduced in 0040.
DROP POLICY IF EXISTS "app_config_update_super_admin" ON app_config;
CREATE POLICY "app_config_update_super_admin"
  ON app_config FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ============================================================
-- Audit trigger — append every change to audit_log so the platform audit
-- feed surfaces version bumps alongside member moderation / gym edits.
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_app_config_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_log (gym_id, actor_id, action, target_type, target_id, metadata)
  VALUES (
    NULL,
    auth.uid(),
    'update_app_version',
    'app_config',
    NULL,
    jsonb_build_object(
      'previous', jsonb_build_object(
        'min_required_version', OLD.min_required_version,
        'latest_version',       OLD.latest_version,
        'ios_store_url',        OLD.ios_store_url,
        'android_store_url',    OLD.android_store_url
      ),
      'current', jsonb_build_object(
        'min_required_version', NEW.min_required_version,
        'latest_version',       NEW.latest_version,
        'ios_store_url',        NEW.ios_store_url,
        'android_store_url',    NEW.android_store_url
      )
    )
  );
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_config_audit ON app_config;
CREATE TRIGGER app_config_audit
  BEFORE UPDATE ON app_config
  FOR EACH ROW
  EXECUTE FUNCTION public.log_app_config_change();

CREATE OR REPLACE FUNCTION public.get_app_version()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'min_required_version', min_required_version,
    'latest_version',       latest_version,
    'ios_store_url',        ios_store_url,
    'android_store_url',    android_store_url,
    'updated_at',           updated_at
  )
  FROM app_config
  WHERE id = 1
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_version() TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
