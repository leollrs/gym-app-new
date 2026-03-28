-- 0109: RPC Rate Limiting
-- Prevents abuse of Supabase RPCs (add_reward_points, complete_workout, redeem_reward, etc.)

-- 1. Create the rate limits tracking table
CREATE TABLE IF NOT EXISTS public.rpc_rate_limits (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Index for efficient lookups by user + action within time windows
CREATE INDEX idx_rpc_rate_limits_lookup
  ON public.rpc_rate_limits (user_id, action, created_at);

-- 3. Enable RLS
ALTER TABLE public.rpc_rate_limits ENABLE ROW LEVEL SECURITY;

-- Authenticated users can only insert their own rows
CREATE POLICY "Users can insert own rate limit rows"
  ON public.rpc_rate_limits
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No select/update/delete needed from client side; the SECURITY DEFINER
-- function bypasses RLS when reading.

-- 4. Reusable rate-limit check function
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action TEXT,
  p_max_calls INT DEFAULT 10,
  p_window_minutes INT DEFAULT 1
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT COUNT(*) INTO v_count
    FROM rpc_rate_limits
   WHERE user_id = v_uid
     AND action  = p_action
     AND created_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;

  IF v_count >= p_max_calls THEN
    RETURN false;
  END IF;

  INSERT INTO rpc_rate_limits (user_id, action) VALUES (v_uid, p_action);
  RETURN true;
END;
$$;

-- 5. Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) TO authenticated;

-- 6. Cleanup function to prevent table bloat (deletes records older than 1 hour)
CREATE OR REPLACE FUNCTION public.cleanup_rpc_rate_limits()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.rpc_rate_limits
   WHERE created_at < NOW() - INTERVAL '1 hour';
END;
$$;

-- Grant execute so it can be called via pg_cron or a scheduled edge function
GRANT EXECUTE ON FUNCTION public.cleanup_rpc_rate_limits() TO authenticated;
