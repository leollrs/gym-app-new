-- ============================================================
-- 0235 — Security Advisor fixes: move extensions out of public
--        schema and tighten anon INSERT on password_reset_requests
-- ============================================================

-- ============================================================
-- 1. Move extensions from public to extensions schema
--    Supabase Security Advisor flags extensions installed in
--    the public schema. Moving them to "extensions" keeps the
--    public schema clean and follows Supabase best practices.
-- ============================================================

-- Ensure the extensions schema exists (Supabase projects
-- normally have it, but be safe).
CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION pg_trgm   SET SCHEMA extensions;
ALTER EXTENSION btree_gin SET SCHEMA extensions;
-- Note: pg_net does not support SET SCHEMA (Supabase-managed,
-- must remain in public). This is a known Supabase limitation
-- and can be safely ignored in the Security Advisor.

-- ============================================================
-- 2. Tighten anon INSERT policy on password_reset_requests
--    The original policy "anon_insert_reset_request" uses
--    WITH CHECK (true), which allows anon users to INSERT rows
--    with arbitrary column values (e.g. status = 'approved',
--    or pre-filled approved_by / used_at).
--
--    In practice, inserts go through the create_password_reset_request
--    RPC (SECURITY DEFINER), so direct anon INSERT is only a
--    fallback path. Constrain it so that any direct insert must:
--      - set status = 'pending'
--      - leave used_at NULL
--      - leave approved_by NULL
-- ============================================================

DROP POLICY IF EXISTS "anon_insert_reset_request" ON password_reset_requests;

CREATE POLICY "anon_insert_reset_request" ON password_reset_requests
  FOR INSERT TO anon
  WITH CHECK (
    status = 'pending'
    AND used_at IS NULL
    AND approved_by IS NULL
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
