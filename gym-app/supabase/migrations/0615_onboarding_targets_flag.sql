-- ============================================================
-- 0615 — onboarding_targets feature flag (Onboarding v2 kill switch)
-- ============================================================
-- Gate the new "Your Targets" onboarding step behind a remote flag so it can be
-- enabled/disabled WITHOUT a store release — critical given the cruise (no
-- hotfix window) and that onboarding is the first impression when selling.
--
-- Shipped DARK: we seed feature_onboarding_targets = false so the step is OFF
-- for everyone on release. The founder flips it ON from the platform Operations
-- page (or by setting the config value) once he's tested it with real users —
-- a live DB value, no app update needed. It appears automatically as an
-- "Onboarding targets" kill switch (Operations renders any feature_% row).
--
-- Reproduces get_platform_flags verbatim from 0551 + one added key. The client
-- (usePlatformFlags PLATFORM_FLAG_KEYS) must also list 'onboarding_targets' for
-- the value to survive its fail-open merge — done in the same change.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_platform_flags()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'referrals',          COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_referrals'),          'true') <> 'false',
    'classes',            COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_classes'),            'true') <> 'false',
    'social',             COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_social'),             'true') <> 'false',
    'messaging',          COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_messaging'),          'true') <> 'false',
    'qr',                 COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_qr'),                 'true') <> 'false',
    'challenges',         COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_challenges'),         'true') <> 'false',
    'nutrition',          COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_nutrition'),          'true') <> 'false',
    'ai',                 COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_ai'),                 'true') <> 'false',
    -- New: defaults to 'false' (dark) instead of 'true' — OFF unless explicitly enabled.
    'onboarding_targets', COALESCE((SELECT value #>> '{}' FROM platform_config WHERE key = 'feature_onboarding_targets'), 'false') <> 'false'
  );
$$;

-- Seed the dark default. ON CONFLICT DO NOTHING so re-running never clobbers a
-- value the founder has since set.
INSERT INTO public.platform_config (key, value)
VALUES ('feature_onboarding_targets', to_jsonb(false))
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
