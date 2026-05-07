-- 0323 — Rename ai_rate_limits.requested_at to created_at
--
-- Every edge function reading this table queries `created_at` for sliding-
-- window rate limiting (generate-apple-pass, generate-punch-card-pass,
-- generate-google-pass, sign-qr, verify-qr, translate, send-push-user,
-- analyze-food-photo, analyze-menu-photo, analyze-body-photo). The column
-- created in 0090 was named `requested_at`, so EVERY rate-limit check has
-- been silently 500'ing with "column does not exist". Rename the column +
-- index + cleanup function to match the function code.

ALTER TABLE ai_rate_limits RENAME COLUMN requested_at TO created_at;

-- Recreate the index with the new column name
DROP INDEX IF EXISTS idx_ai_rate_limits_lookup;
CREATE INDEX idx_ai_rate_limits_lookup
  ON ai_rate_limits (profile_id, endpoint, created_at DESC);

-- Update the cleanup function to use the new column name
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM ai_rate_limits WHERE created_at < now() - interval '24 hours';
$$;

NOTIFY pgrst, 'reload schema';
