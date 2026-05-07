-- ============================================================
-- 0340 — account_deletion_requests table
--
-- Backs the public web account deletion flow (Play Store
-- account-deletion policy: must work without login).
--
-- Written by `request-account-deletion` edge function:
--   - User submits the form at https://tugympr.com/eliminar-cuenta
--   - Edge function validates email, rate-limits, generates a
--     32-byte random token, stores SHA-256(token) here, emails
--     the raw token in a verification link with 1-hour TTL.
--
-- Read by `confirm-account-deletion` edge function (TBD):
--   - Looks up the row by token_hash, verifies status='pending'
--     and now() < expires_at, marks consumed, calls
--     delete_user_account RPC for the linked user_id.
--
-- Security:
--   - Only the SHA-256 hash is stored — DB leak cannot reveal
--     pending verification tokens.
--   - RLS enabled with NO policies = service role only.
--   - No end-user direct access needed or wanted.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token_hash      text NOT NULL,
  reason          text,
  ip_address      text,
  user_agent      text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  consumed_at     timestamptz,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'consumed', 'expired', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS account_deletion_requests_email_idx
  ON public.account_deletion_requests (email, requested_at DESC);

CREATE INDEX IF NOT EXISTS account_deletion_requests_ip_idx
  ON public.account_deletion_requests (ip_address, requested_at DESC);

CREATE INDEX IF NOT EXISTS account_deletion_requests_token_idx
  ON public.account_deletion_requests (token_hash);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- No policies = service role only. The public endpoint runs with the
-- service role key inside the edge function, so no end-user direct
-- access is needed or wanted.

NOTIFY pgrst, 'reload schema';
