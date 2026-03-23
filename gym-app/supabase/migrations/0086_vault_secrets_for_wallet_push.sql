-- =============================================================
-- VAULT SECRETS FOR WALLET PUSH TRIGGER
-- Migration: 0086_vault_secrets_for_wallet_push.sql
--
-- Stores the Supabase URL and service role key in Vault so the
-- trigger_wallet_push() function can call the edge function.
--
-- Uses vault.create_secret() API (direct INSERT into vault.secrets
-- is not permitted outside the postgres role).
-- =============================================================

-- Enable vault if not already enabled
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Ensure pg_net is enabled (required for the wallet push trigger)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Create secrets using the vault API ──────────────────────
-- vault.create_secret(secret_value, unique_name, description)

-- Supabase project URL
SELECT vault.create_secret(
  'https://erdhnixjnjullhjzmvpm.supabase.co',
  'supabase_url',
  'Supabase project URL for edge function calls'
)
WHERE NOT EXISTS (
  SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url'
);

-- Service role key — ⚠️ REPLACE with your real key after running!
-- Find it in: Supabase Dashboard → Settings → API → service_role key
-- Then update with:
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'service_role_key'),
--     'eyJhbGciOi...<your real service role key>'
--   );
SELECT vault.create_secret(
  'REPLACE_WITH_REAL_SERVICE_ROLE_KEY',
  'service_role_key',
  'Supabase service role key for edge function auth'
)
WHERE NOT EXISTS (
  SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key'
);
