-- ==========================================================================
-- 0641_member_goals_trainer_write.sql
-- Let a trainer/admin CREATE, EDIT and DELETE a client's member_goals from the
-- trainer client-detail screen. Until now member_goals writes were owner-locked
-- (profile_id = auth.uid()); the only staff access was the read policy
-- member_goals_trainer_read (0527). These add write parity, gated by the
-- multi-role _can_manage_client() helper (admin-or-trainer, same-gym — the same
-- gate the workout per-client copy uses in 0640), with writes still pinned to
-- current_gym_id() so a staff member can only write goals inside their own gym.
-- Additive: the existing owner policies stay, so members keep full control of
-- their own goals.
--
-- NOTE (deadlock-safe apply): CREATE/DROP POLICY needs an ACCESS EXCLUSIVE lock
-- on member_goals. The first apply deadlocked because it ran while the app was
-- live on the trainer client page (holding AccessShareLock on member_goals). We
-- now take the table lock ONCE, up front, inside a single transaction with a
-- short lock_timeout: if a live reader is mid-query the migration aborts cleanly
-- after 5s (retryable) instead of hanging into a deadlock. Re-run it when the
-- trainer client page isn't actively open and it will apply instantly.
-- ==========================================================================

BEGIN;

-- Fail fast instead of deadlocking if member_goals is busy; re-run when idle.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Serialize on member_goals up front so the three policy statements below can't
-- interleave with live traffic and form a new lock cycle.
LOCK TABLE public.member_goals IN ACCESS EXCLUSIVE MODE;

DROP POLICY IF EXISTS "member_goals_staff_insert" ON public.member_goals;
CREATE POLICY "member_goals_staff_insert" ON public.member_goals
  FOR INSERT TO authenticated
  WITH CHECK (public._can_manage_client(profile_id) AND gym_id = public.current_gym_id());

DROP POLICY IF EXISTS "member_goals_staff_update" ON public.member_goals;
CREATE POLICY "member_goals_staff_update" ON public.member_goals
  FOR UPDATE TO authenticated
  USING (public._can_manage_client(profile_id))
  WITH CHECK (public._can_manage_client(profile_id) AND gym_id = public.current_gym_id());

DROP POLICY IF EXISTS "member_goals_staff_delete" ON public.member_goals;
CREATE POLICY "member_goals_staff_delete" ON public.member_goals
  FOR DELETE TO authenticated
  USING (public._can_manage_client(profile_id));

COMMIT;

NOTIFY pgrst, 'reload schema';
