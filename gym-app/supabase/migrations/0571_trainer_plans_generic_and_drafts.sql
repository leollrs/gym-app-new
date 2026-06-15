-- 0571_trainer_plans_generic_and_drafts.sql
-- Trainer workout plans: allow GENERIC (client-less) plans + a DRAFT state.
--
-- Why:
--  • Trainers want to build a reusable/generic plan without first picking a
--    client (e.g. a template they assign later). client_id was NOT NULL.
--  • Trainers want to "save for later" — a draft that lives in their library
--    but isn't an assigned/active plan for any client.
--
-- Safe to re-run.

-- 1) client_id becomes optional (generic plans / templates have NULL client).
ALTER TABLE public.trainer_workout_plans
  ALTER COLUMN client_id DROP NOT NULL;

-- 2) Draft flag. Drafts are work-in-progress plans, surfaced in "Your library"
--    under a Drafts filter and excluded from the client's active plan.
ALTER TABLE public.trainer_workout_plans
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;

-- Helpful for the library's Drafts filter (trainer's own drafts).
CREATE INDEX IF NOT EXISTS idx_trainer_plans_draft
  ON public.trainer_workout_plans(trainer_id) WHERE is_draft;

-- Note: existing RLS already scopes rows to trainer_id = auth.uid() (trainer
-- full access) and client_id = auth.uid() (client read). A NULL client_id simply
-- means no client can read it — correct for a generic/draft plan. No policy
-- change needed.
