-- Add rate limiting support to password_reset_requests
-- Tracks failed attempts per request and locks after 5 failures

-- Add failed_attempts counter column
ALTER TABLE password_reset_requests
  ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0;

-- Expand the status CHECK constraint to include 'locked'
ALTER TABLE password_reset_requests
  DROP CONSTRAINT IF EXISTS password_reset_requests_status_check;

ALTER TABLE password_reset_requests
  ADD CONSTRAINT password_reset_requests_status_check
  CHECK (status IN ('pending', 'approved', 'denied', 'used', 'expired', 'locked'));

-- Atomic increment RPC (called by the edge function via service_role)
CREATE OR REPLACE FUNCTION public.increment_failed_reset_attempts(request_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE password_reset_requests
     SET failed_attempts = failed_attempts + 1
   WHERE id = request_id;
END;
$$;

-- Only service_role calls this, but grant to authenticated as a safety net
GRANT EXECUTE ON FUNCTION public.increment_failed_reset_attempts(UUID) TO authenticated;
