-- Security fix: Mark twilio_auth_token for vault migration
-- The actual migration to vault.create_secret() requires edge function changes.
-- For now, we restrict access further and add documentation.

-- Ensure only super_admins can access twilio config
DROP POLICY IF EXISTS "super_admin_manage_twilio" ON gym_twilio_config;
CREATE POLICY "super_admin_manage_twilio" ON gym_twilio_config
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profile_lookup WHERE id = auth.uid() AND role = 'super_admin')
  );

-- Add comment for documentation
COMMENT ON COLUMN gym_twilio_config.twilio_auth_token IS
  'SECURITY: This should be migrated to Supabase Vault (vault.create_secret). Currently stored as plaintext.';

COMMENT ON TABLE gym_twilio_config IS
  'SECURITY TODO: Migrate twilio_account_sid and twilio_auth_token to vault.decrypted_secrets';
