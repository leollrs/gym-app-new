-- ============================================================================
-- 0708 — El socio puede LEER la rutina que lleva su clase o su reto
-- ============================================================================
--
-- FALLO VIVO QUE ESTO ARREGLA. La rutina de una clase se crea desde el panel
-- con `created_by = <id del staff>` e `is_public = false`
-- (`ClassRoutineBuilderModal.jsx`). La única política de lectura sobre
-- `routines` es `routines_select_own` (0002:187):
--
--     created_by = auth.uid() OR (gym_id = current_gym_id() AND is_public = TRUE)
--
-- Un socio no cumple ninguna de las dos ramas. Y `is_public` no se pone a TRUE
-- en ningún sitio del código: se comprobó, cero escrituras.
--
-- Consecuencia: el socio marca asistencia a una clase con rutina, pulsa
-- «empezar a registrar», y `ActiveSession.jsx` la pide con `.single()` →
-- 0 filas → error → `if (routineErr || !routine) { setDataLoading(false); return; }`
-- → **entra a una sesión vacía, sin error y sin explicación**. La función de
-- «plantilla de entreno en la clase» lleva rota desde que se lanzó.
--
-- La política nueva no abre `routines` en general: abre exactamente las que
-- están ENGANCHADAS a algo del gimnasio del socio — una clase o un reto. Si la
-- rutina se desengancha, deja de verse.
-- ============================================================================

-- ── 1. El reto puede llevar rutina y programa ───────────────────────────────
-- (Se añaden aquí para que la política se escriba UNA vez y cubra los dos
-- casos, en vez de tener que ampliarla después.)
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS workout_template_id UUID REFERENCES public.routines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS program_id          UUID REFERENCES public.gym_programs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.challenges.workout_template_id IS
  'Rutina que el reto propone. El socio la entrena o la pone en su semana.';
COMMENT ON COLUMN public.challenges.program_id IS
  'Programa del gimnasio que el reto propone entero.';

CREATE INDEX IF NOT EXISTS idx_challenges_template ON public.challenges(workout_template_id)
  WHERE workout_template_id IS NOT NULL;

-- ── 2. La política ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "routines_select_attached" ON public.routines;
CREATE POLICY "routines_select_attached" ON public.routines
  FOR SELECT USING (
    gym_id = public.current_gym_id()
    -- Y que sea una rutina DEL GIMNASIO, no de un socio. Sin esto, enganchar
    -- una rutina personal a un reto la publicaba —nombre y ejercicios— a todo
    -- el gimnasio; y quien engancha puede ser un entrenador, sobre la rutina de
    -- alguien que ni siquiera es cliente suyo. Es lo que el selector
    -- (`RoutineSelector`) ya promete al ofrecer solo rutinas de staff, pero que
    -- nadie imponía.
    AND (
      routines.is_public = TRUE
      OR EXISTS (
        SELECT 1 FROM public.profiles s
        WHERE s.id = routines.created_by AND COALESCE(s.is_staff, FALSE) = TRUE
      )
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.gym_classes c
        WHERE c.workout_template_id = routines.id
          AND c.gym_id = routines.gym_id
      )
      OR EXISTS (
        SELECT 1 FROM public.challenges ch
        WHERE ch.workout_template_id = routines.id
          AND ch.gym_id = routines.gym_id
      )
    )
  );

-- Los ejercicios de esa rutina hacen falta para que la sesión no salga vacía:
-- sin esto se arregla la mitad del problema y la pantalla sigue en blanco.
DROP POLICY IF EXISTS "routine_exercises_select_attached" ON public.routine_exercises;
CREATE POLICY "routine_exercises_select_attached" ON public.routine_exercises
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.routines r
      WHERE r.id = routine_exercises.routine_id
        AND r.gym_id = public.current_gym_id()
        AND (
          r.is_public = TRUE
          OR EXISTS (SELECT 1 FROM public.profiles s WHERE s.id = r.created_by AND COALESCE(s.is_staff, FALSE) = TRUE)
        )
        AND (
          EXISTS (SELECT 1 FROM public.gym_classes c WHERE c.workout_template_id = r.id AND c.gym_id = r.gym_id)
          OR EXISTS (SELECT 1 FROM public.challenges ch WHERE ch.workout_template_id = r.id AND ch.gym_id = r.gym_id)
        )
    )
  );

NOTIFY pgrst, 'reload schema';
