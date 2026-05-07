-- ══════════════════════════════════════════════════════════════════════
-- FIX REFERRAL SYSTEM
-- 1. Add missing is_active column to referral_codes
-- 2. Add missing admin SELECT policy on referrals
--    (Admins had UPDATE but no SELECT — admin panel showed empty list)
-- 3. Add public RPC for looking up a referral code at signup
--    (Migration 0117 locked referral_codes to authenticated users only,
--     but signup happens before auth — so validation returned 406.)
-- ══════════════════════════════════════════════════════════════════════

-- 1. Add is_active to referral_codes
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. Add admin SELECT policy on referrals
DROP POLICY IF EXISTS "Admins can view gym referrals" ON referrals;
CREATE POLICY "Admins can view gym referrals" ON referrals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND gym_id = referrals.gym_id
        AND role IN ('admin', 'super_admin')
    )
  );

-- 3. Public referral-code lookup RPC (SECURITY DEFINER bypasses RLS).
--    Returns only the fields needed for signup validation — no uses_count,
--    no timestamps, no other PII.
CREATE OR REPLACE FUNCTION public.lookup_referral_code(p_code TEXT)
RETURNS TABLE (
  code_id       UUID,
  referrer_id   UUID,
  referrer_name TEXT,
  gym_id        UUID
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    rc.id              AS code_id,
    rc.profile_id      AS referrer_id,
    COALESCE(p.full_name, 'Member') AS referrer_name,
    rc.gym_id
  FROM referral_codes rc
  LEFT JOIN profiles p ON p.id = rc.profile_id
  WHERE upper(rc.code) = upper(p_code)
    AND COALESCE(rc.is_active, true) = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_referral_code(TEXT) TO anon, authenticated;
