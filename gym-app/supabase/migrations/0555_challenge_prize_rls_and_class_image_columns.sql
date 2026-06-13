-- =============================================================
-- 0555_challenge_prize_rls_and_class_image_columns.sql
--
-- 1) challenge_prizes admin RLS: include additional_roles.
--    The new challenge-prize SCAN handler (handleChallengePrizeScan) does a
--    client-side `SELECT ... WHERE qr_code = ...` before calling the
--    redeem_challenge_prize SECURITY DEFINER RPC. The 0186 admin SELECT/UPDATE
--    policies only check profiles.role IN ('admin','super_admin') and were
--    never patched for multi-role admins (the sibling earned_rewards policy
--    WAS, in 0463). Result: a scanner whose PRIMARY role is trainer/member but
--    who has 'admin' in additional_roles gets "Challenge prize not found" on
--    every valid prize QR. Mirror the 0463/0551 additional_roles pattern.
--
-- 2) gym_classes.image_path + cover_preset: add if missing.
--    AdminClasses writes these columns and the member Classes page reads
--    cls.image_path, but NO migration ever added them to gym_classes (only the
--    original image_url from 0157). On any gym whose DB lacks them, PostgREST
--    rejects the admin save (unknown column) and class cards never show a
--    photo. IF NOT EXISTS makes this a no-op where they were added manually.
-- =============================================================

-- ── 1. challenge_prizes admin policies — add additional_roles ──
DROP POLICY IF EXISTS "admin_read_gym_prizes" ON public.challenge_prizes;
CREATE POLICY "admin_read_gym_prizes" ON public.challenge_prizes
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin')
          OR 'admin'::user_role = ANY(COALESCE(p.additional_roles, '{}'))
          OR 'super_admin'::user_role = ANY(COALESCE(p.additional_roles, '{}'))
        )
    )
  );

DROP POLICY IF EXISTS "admin_update_gym_prizes" ON public.challenge_prizes;
CREATE POLICY "admin_update_gym_prizes" ON public.challenge_prizes
  FOR UPDATE USING (
    gym_id IN (
      SELECT p.gym_id FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin')
          OR 'admin'::user_role = ANY(COALESCE(p.additional_roles, '{}'))
          OR 'super_admin'::user_role = ANY(COALESCE(p.additional_roles, '{}'))
        )
    )
  );

-- ── 2. gym_classes image columns (idempotent) ──
ALTER TABLE public.gym_classes ADD COLUMN IF NOT EXISTS image_path   TEXT;
ALTER TABLE public.gym_classes ADD COLUMN IF NOT EXISTS cover_preset TEXT;

NOTIFY pgrst, 'reload schema';
