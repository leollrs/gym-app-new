-- ============================================================================
-- 0712 — «Solo hoy»: una rutina en UNA fecha, sin tocar la semana
-- ============================================================================
--
-- LO QUE FALTABA. El calendario del socio es puramente RECURRENTE:
-- `workout_schedule` es `(profile_id, day_of_week, routine_id)` con un único
-- por día, y **no existe ninguna columna de fecha en todo el sistema de
-- entrenos**. Poner algo «en tu día» solo podía significar «en todos los
-- miércoles, para siempre».
--
-- Eso hace imposible lo más normal del mundo: «hoy quiero hacer la rutina del
-- reto en vez de lo que me toca». Con lo que había, o te cargabas el miércoles
-- de todas las semanas, o no lo hacías.
--
-- Y hay una segunda razón, más traicionera: las cinco rutas que instalan un
-- programa (`enrollInTemplate`, adoptar plan, generar, regenerar, constructor)
-- **borran la semana entera** antes de sembrar. Un cambio de un día metido en
-- `workout_schedule` moría en la siguiente instalación sin decir nada. Una
-- excepción con fecha propia sobrevive: no vive en la semana.
--
-- REGLA: la excepción GANA sobre lo recurrente para esa fecha. Punto.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workout_schedule_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id          UUID REFERENCES public.gyms(id) ON DELETE CASCADE,
  scheduled_date  DATE NOT NULL,
  routine_id      UUID NOT NULL REFERENCES public.routines(id) ON DELETE CASCADE,
  -- De dónde salió, para poder decir «viene del reto X» y para poder medir si
  -- esto se usa. Libre a propósito: hoy 'challenge', mañana lo que sea.
  source          TEXT,
  source_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, scheduled_date)
);

COMMENT ON TABLE public.workout_schedule_overrides IS
  'Una rutina en UNA fecha concreta. Gana sobre workout_schedule para ese día y sobrevive a los reinstalados de programa, que borran la semana entera.';

CREATE INDEX IF NOT EXISTS idx_wso_profile_date
  ON public.workout_schedule_overrides (profile_id, scheduled_date);

-- `gym_id` admite NULL igual que en `routines` desde la 0550: un socio sin
-- gimnasio (que saltó el paso) tiene rutinas propias y debe poder usarlas.

ALTER TABLE public.workout_schedule_overrides ENABLE ROW LEVEL SECURITY;

-- Mismo contrato que `workout_schedule` (0046): dueño y nadie más. Ni el
-- entrenador ni el admin escriben aquí desde el cliente.
DROP POLICY IF EXISTS "wso_select_own" ON public.workout_schedule_overrides;
CREATE POLICY "wso_select_own" ON public.workout_schedule_overrides
  FOR SELECT USING (profile_id = auth.uid());

-- `gym_id` atado al gimnasio del socio, no a lo que mande el cliente: es la
-- única columna de tenencia de esta tabla, y sin el WITH CHECK cualquiera podía
-- escribir el id de otro gimnasio y envenenar cualquier informe futuro. Mismo
-- patrón que `routines_insert_own` tras la 0550 (que admite NULL para el socio
-- que se saltó el paso de gimnasio).
DROP POLICY IF EXISTS "wso_insert_own" ON public.workout_schedule_overrides;
CREATE POLICY "wso_insert_own" ON public.workout_schedule_overrides
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND gym_id IS NOT DISTINCT FROM public.current_gym_id()
  );

DROP POLICY IF EXISTS "wso_update_own" ON public.workout_schedule_overrides;
CREATE POLICY "wso_update_own" ON public.workout_schedule_overrides
  FOR UPDATE USING (profile_id = auth.uid())
  WITH CHECK (
    profile_id = auth.uid()
    AND gym_id IS NOT DISTINCT FROM public.current_gym_id()
  );

DROP POLICY IF EXISTS "wso_delete_own" ON public.workout_schedule_overrides;
CREATE POLICY "wso_delete_own" ON public.workout_schedule_overrides
  FOR DELETE USING (profile_id = auth.uid());

-- ── Barrido de lo viejo ─────────────────────────────────────────────────────
-- Son filas efímeras por naturaleza: una vez pasada la fecha no le sirven a
-- nadie. Se limpian solas para que la tabla no crezca durante años.
CREATE OR REPLACE FUNCTION public.sweep_workout_schedule_overrides()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM workout_schedule_overrides WHERE scheduled_date < CURRENT_DATE - INTERVAL '45 days';
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_workout_schedule_overrides() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.schedule('sweep-schedule-overrides', '30 4 * * *',
    $cron$ SELECT public.sweep_workout_schedule_overrides(); $cron$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[0712] pg_cron no disponible — barrer manualmente o programarlo (30 4 * * *).';
END $$;

NOTIFY pgrst, 'reload schema';
