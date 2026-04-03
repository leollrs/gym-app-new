-- Security fix: Restrict password_reset_requests anon SELECT policy
-- The current policy allows anyone to read ALL reset requests including tokens and emails.
-- Also remove from realtime publication to prevent subscription-based interception.

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "anon_read_own_reset_request" ON password_reset_requests;

-- Create a restrictive policy - anon can only read by matching token
CREATE POLICY "anon_read_own_reset_request" ON password_reset_requests
  FOR SELECT TO anon
  USING (false);  -- Anon should never directly SELECT; the reset-password edge function uses service_role

-- Remove from realtime publication (wrapped in DO block since DROP TABLE doesn't support IF EXISTS)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE password_reset_requests;
EXCEPTION WHEN undefined_object OR undefined_table THEN
  NULL; -- Table not in publication, ignore
END;
$$;
