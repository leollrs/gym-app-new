-- ============================================================
-- 0474 — Close cross-tenant leaks from bare is_admin() in RLS policies
-- ============================================================
-- is_admin() (per 0465) answers "is this user an admin of SOME gym?" with
-- NO gym boundary. Three policies gate on bare is_admin() with no gym_id
-- check, so an admin of gym A can read (and in one case write) gym B's
-- data. In a white-label B2B product that is a tenant-isolation breach.
--
-- Confirmed from the live policy dump (3of7, 2026-05-30):
--   • gym_class_bookings "bookings_select_admin"  FOR SELECT USING is_admin()
--   • gym_class_recurring "recurring_admin"        FOR ALL    USING is_admin()
--   • push_tokens        "push_tokens_select"      FOR SELECT USING (... OR is_admin() ...)
--
-- All three target tables HAVE a gym_id column (verified:
--   gym_class_bookings.gym_id  0157_class_booking.sql
--   gym_class_recurring.gym_id 0162_class_waitlist_recurring.sql
--   push_tokens.gym_id         0095_push_tokens.sql).
--
-- FIX: scope the admin branch to the caller's own gym, with a super_admin
-- bypass (platform operators may legitimately cross gyms — same idiom as
-- the 0471 gym-boundary fixes). is_admin() is already true for super_admin,
-- so `is_admin() AND (is_super_admin() OR gym_id = current_gym_id())` keeps
-- super_admin global and confines regular gym admins to their own gym.
-- Member/trainer branches are reproduced verbatim from the live policies.
-- ============================================================

-- ── gym_class_bookings: admin SELECT was cross-gym ──
DROP POLICY IF EXISTS "bookings_select_admin" ON public.gym_class_bookings;
CREATE POLICY "bookings_select_admin" ON public.gym_class_bookings
  FOR SELECT
  USING (
    public.is_admin()
    AND (public.is_super_admin() OR gym_id = public.current_gym_id())
  );

-- ── gym_class_recurring: admin ALL (read+write) was cross-gym ──
DROP POLICY IF EXISTS "recurring_admin" ON public.gym_class_recurring;
CREATE POLICY "recurring_admin" ON public.gym_class_recurring
  FOR ALL
  USING (
    public.is_admin()
    AND (public.is_super_admin() OR gym_id = public.current_gym_id())
  );

-- ── push_tokens: admin branch of SELECT was cross-gym ──
-- Preserve the owner branch and the trainer-of-client branch verbatim;
-- only the is_admin() branch gains a gym boundary.
DROP POLICY IF EXISTS "push_tokens_select" ON public.push_tokens;
CREATE POLICY "push_tokens_select" ON public.push_tokens
  FOR SELECT
  USING (
    (auth.uid() = profile_id)
    OR (public.is_admin()
        AND (public.is_super_admin() OR gym_id = public.current_gym_id()))
    OR (
      ((SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid()) = 'trainer'::user_role)
      AND EXISTS (
        SELECT 1 FROM trainer_clients
        WHERE trainer_clients.trainer_id = auth.uid()
          AND trainer_clients.client_id = push_tokens.profile_id
          AND trainer_clients.is_active = true
      )
    )
  );

NOTIFY pgrst, 'reload schema';
