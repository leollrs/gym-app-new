-- 0666_member_active_trainer_plan.sql
-- purpose: let a trainer's plan BE the member's current program.
--
-- Until now three program systems ran in parallel and only two of them could
-- ever reach the Workouts hero:
--
--   generated_programs                  → the hero ("Current Program")
--   gym_programs + gym_program_enrollments → the gym catalogue, and the ONLY
--                                            thing a trainer's "Assign" button
--                                            could write (profiles.assigned_program_id)
--   trainer_workout_plans               → a card at the top of Workouts that
--                                         built a throwaway routine per day
--
-- So a trainer could never put their OWN plan in front of the member as the
-- thing to do next. This adds the missing pointer.
--
-- Deliberately NOT destructive: the member's generated program is left exactly
-- as it is. While active_trainer_plan_id is set, the hero renders the trainer's
-- plan instead; clearing the column restores the member's own program
-- untouched. "Archived" is a UI state, not a data migration — nothing to lose
-- and nothing to restore incorrectly.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_trainer_plan_id UUID
    REFERENCES public.trainer_workout_plans(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.active_trainer_plan_id IS
  'Trainer plan the member has adopted as their current program. NULL = use their own generated_programs row. ON DELETE SET NULL so deleting a plan silently returns the member to their own program rather than leaving a dangling hero.';

-- Partial index: the lookups are "is this member on a trainer plan" and, for
-- the trainer, "which of my clients adopted this plan". Both only ever care
-- about non-NULL rows, which are the minority.
CREATE INDEX IF NOT EXISTS idx_profiles_active_trainer_plan
  ON public.profiles(active_trainer_plan_id)
  WHERE active_trainer_plan_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────
-- Adopting is the MEMBER's action, and it must stay that way.
--
-- profiles' own UPDATE policy already restricts a member to their own row, so
-- no new policy is needed for the write. What DOES need guarding is which plan
-- they may point at: without this, a member could set the column to any plan id
-- they could name and pull a stranger's programme into their app. The trigger
-- re-checks the same conditions TrainerPlanSection reads under — the plan is
-- active, and it was actually shared with them.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_active_trainer_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  IF NEW.active_trainer_plan_id IS NULL
     OR NEW.active_trainer_plan_id IS NOT DISTINCT FROM OLD.active_trainer_plan_id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM trainer_workout_plans p
     WHERE p.id = NEW.active_trainer_plan_id
       AND p.is_active IS TRUE
       AND COALESCE(p.is_draft, FALSE) IS FALSE
       AND (
            p.client_id = NEW.id
         OR EXISTS (SELECT 1 FROM trainer_plan_members m
                     WHERE m.plan_id = p.id AND m.member_id = NEW.id)
       )
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'active_trainer_plan_id must reference a live plan shared with this member'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_active_trainer_plan ON public.profiles;
CREATE TRIGGER trg_guard_active_trainer_plan
  BEFORE UPDATE OF active_trainer_plan_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_active_trainer_plan();

NOTIFY pgrst, 'reload schema';
