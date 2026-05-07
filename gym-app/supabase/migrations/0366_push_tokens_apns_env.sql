-- ============================================================
-- 0366 — Track APNs environment per push token
-- ============================================================
-- Debug-signed iOS builds installed via Xcode/devicectl register
-- with the SANDBOX APNs environment even when the entitlements
-- file declares `aps-environment = production`. The edge function
-- currently sends only to the production host (api.push.apple.com)
-- so sandbox tokens are silently rejected with BadDeviceToken (400)
-- and the user never sees a banner — only the in-app inbox row.
--
-- Add an `apns_env` column so the edge function can:
--   • Send straight to sandbox when we already know a token is
--     sandbox-registered (typical for TestFlight + dev builds).
--   • Detect a BadDeviceToken response, retry on the other host,
--     and persist whichever one worked — so future sends are
--     single-shot.
--
-- 'unknown' → try production first, fall back to sandbox.
-- 'production' / 'sandbox' → send straight to the matching host.
-- ============================================================

ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS apns_env TEXT;

ALTER TABLE public.push_tokens
  DROP CONSTRAINT IF EXISTS push_tokens_apns_env_check;

ALTER TABLE public.push_tokens
  ADD CONSTRAINT push_tokens_apns_env_check
  CHECK (apns_env IS NULL OR apns_env IN ('production', 'sandbox'));

COMMENT ON COLUMN public.push_tokens.apns_env IS
  'APNs environment the iOS token registered with (production|sandbox|null=unknown). FCM tokens leave this null.';

NOTIFY pgrst, 'reload schema';
