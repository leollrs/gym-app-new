-- Security fix: trainer-related RLS policies and is_trainer_of() function
-- Issues addressed:
--   1. is_trainer_of() lacks gym_id cross-check (trainer in gym A could act on client in gym B)
--   2. trainer_clients UPDATE policy missing WITH CHECK (client_id/gym_id manipulation)
--   3. trainer_followups INSERT missing gym_id check
--   4. trainer_sessions FOR ALL missing gym_id in WITH CHECK
--   5. trainer_workout_plans FOR ALL missing gym_id in WITH CHECK

-- Fix 1: is_trainer_of - add gym_id cross-check via profile_lookup
CREATE OR REPLACE FUNCTION public.is_trainer_of(p_client_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trainer_clients tc
    JOIN public.profile_lookup tp ON tp.id = tc.trainer_id
    JOIN public.profile_lookup cp ON cp.id = tc.client_id
    WHERE tc.trainer_id = auth.uid()
      AND tc.client_id = p_client_id
      AND tc.is_active = TRUE
      AND tp.gym_id = cp.gym_id
  );
$$;

-- Fix 2: trainer_clients UPDATE - add WITH CHECK to prevent client_id/gym_id manipulation
DROP POLICY IF EXISTS "trainer_clients_update_trainer" ON trainer_clients;
CREATE POLICY "trainer_clients_update_trainer" ON trainer_clients
  FOR UPDATE USING (trainer_id = auth.uid())
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );

-- Fix 3: trainer_followups INSERT - add gym_id check
DROP POLICY IF EXISTS "Trainers can insert own followups" ON trainer_followups;
CREATE POLICY "trainer_followups_insert" ON trainer_followups
  FOR INSERT WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );

-- Fix 4: trainer_sessions - add gym_id to WITH CHECK
DROP POLICY IF EXISTS "trainer_sessions_trainer_all" ON trainer_sessions;
CREATE POLICY "trainer_sessions_trainer_all" ON trainer_sessions
  FOR ALL USING (trainer_id = auth.uid())
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );

-- Fix 5: trainer_workout_plans - add gym_id to WITH CHECK
DROP POLICY IF EXISTS "trainer_plans_trainer_all" ON trainer_workout_plans;
CREATE POLICY "trainer_plans_trainer_all" ON trainer_workout_plans
  FOR ALL USING (trainer_id = auth.uid())
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
  );
