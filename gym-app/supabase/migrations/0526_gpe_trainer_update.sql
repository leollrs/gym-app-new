-- ============================================================
-- 0526 — gym_program_enrollments: trainer UPDATE policy
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor (after 0525).
--
-- The trainer "assign program" flow upserts the client's enrollment row
-- (onConflict program_id,profile_id). 0175 gave trainers SELECT + INSERT,
-- but the upsert's conflict path (re-assigning a program the client was
-- already enrolled in) is an UPDATE — which had no policy, so re-assigning
-- failed under RLS. This lets the trainer-of-record refresh enrolled_at,
-- so "week N of program" restarts when a program is re-assigned.
--
-- (The client falls back to ON CONFLICT DO NOTHING pre-migration, which
-- keeps the old enrolled_at instead of erroring.)
-- ============================================================

CREATE POLICY "gpe_update_trainer" ON gym_program_enrollments
  FOR UPDATE USING (
    public.is_trainer_of(profile_id)
  ) WITH CHECK (
    public.is_trainer_of(profile_id)
    AND gym_id = public.current_gym_id()
  );
