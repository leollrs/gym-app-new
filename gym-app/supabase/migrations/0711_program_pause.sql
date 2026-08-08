-- ============================================================================
-- 0711 — Pausar un programa de verdad
-- ============================================================================
--
-- LO QUE HABÍA. Nada. Cero resultados para «pause», «postpone», «paused_at» u
-- «on_hold» sobre programas, ni en el socio, ni en el entrenador, ni en el
-- admin, ni en el esquema.
--
-- Lo más parecido era salir del programa y luego «Reanudar», que NO reanuda:
-- `reactivatePersonalProgram` **crea un programa nuevo** con la fecha de inicio
-- retrasada para que la píldora diga «Semana 5 de 13». Usa hasta vocabulario de
-- pausa (`pauseDate`, `daysPaused`, `pausedAtWeek`) sobre una fila que ya está
-- muerta. Es una reconstrucción disfrazada.
--
-- Eso trae dos consecuencias que se notan:
--   · durante el hueco el programa figura EXPIRADO, así que la app le dice al
--     socio «tu programa terminó, ¿y ahora qué?» cuando lo que hizo fue
--     apartarlo dos semanas;
--   · y el calendario se queda con lo que sea que hubiera, sin nada que diga
--     a qué había que volver.
--
-- LO QUE HACE ESTO. Una pausa es un estado, no un borrado:
--   · `paused_at` — cuándo se apartó
--   · `paused_days` — cuánto lleva apartado en total (se acumula entre pausas)
--   · `paused_schedule` — el calendario que tenía, para poder devolvérselo
--
-- Al reanudar, `expires_at` se corre hacia adelante los días que estuvo parado:
-- un programa de 13 semanas pausado 10 días sigue siendo de 13 semanas.
-- ============================================================================

ALTER TABLE public.generated_programs
  ADD COLUMN IF NOT EXISTS paused_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_days     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_schedule JSONB;

COMMENT ON COLUMN public.generated_programs.paused_at IS
  'Cuándo se apartó. NULL = corriendo. Un programa pausado NO está expirado.';
COMMENT ON COLUMN public.generated_programs.paused_days IS
  'Días acumulados en pausa. Se suman a expires_at al reanudar para no robarle semanas al socio.';
COMMENT ON COLUMN public.generated_programs.paused_schedule IS
  'El calendario que tenía al pausar: [{day_of_week, routine_id}]. Es lo que se le devuelve.';

CREATE INDEX IF NOT EXISTS idx_generated_programs_paused
  ON public.generated_programs(profile_id) WHERE paused_at IS NOT NULL;

-- ── Pausar ──────────────────────────────────────────────────────────────────
--
-- Guarda el calendario, lo suelta, y marca la fila. No borra rutinas: si se
-- borraran, reanudar sería otra vez una reconstrucción.
CREATE OR REPLACE FUNCTION public.pause_member_program(p_program_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prog     RECORD;
  v_schedule JSONB;
BEGIN
  SELECT * INTO v_prog FROM generated_programs WHERE id = p_program_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found'; END IF;
  -- IS DISTINCT FROM y no `<>`: sin sesión `auth.uid()` es NULL, y `uuid <> NULL`
  -- da NULL, no TRUE — el IF no se toma y la comprobación de propiedad no
  -- comprueba nada. Como la función es SECURITY DEFINER, salta la RLS y le
  -- borraría la semana a un socio cualquiera.
  IF v_prog.profile_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not your program'; END IF;
  IF v_prog.paused_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_paused', true);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('day_of_week', ws.day_of_week, 'routine_id', ws.routine_id)), '[]'::jsonb)
    INTO v_schedule
  FROM workout_schedule ws
  WHERE ws.profile_id = v_prog.profile_id;

  -- `expires_at` se empuja al pausar y no solo al reanudar. Si no, el programa
  -- vence en mitad de la pausa: el socio recibe «tu programa terminó» estando
  -- solo apartado, y al volver la fila queda mintiendo (viva y con el aviso de
  -- caducidad ya dado). Al reanudar se recorta lo que sobró.
  UPDATE generated_programs
  SET paused_at = now(),
      paused_schedule = v_schedule,
      expires_at = GREATEST(expires_at, now()) + INTERVAL '1 year',
      expiry_notified = FALSE
  WHERE id = p_program_id;

  DELETE FROM workout_schedule WHERE profile_id = v_prog.profile_id;

  RETURN jsonb_build_object('paused', true, 'saved_days', jsonb_array_length(v_schedule));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pause_member_program(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pause_member_program(UUID) TO authenticated;

-- ── Reanudar ────────────────────────────────────────────────────────────────
--
-- Devuelve el calendario tal cual estaba y le regala al programa los días que
-- estuvo parado. Las rutinas que ya no existan se saltan en silencio: mejor
-- devolver cuatro días de cinco que no devolver ninguno.
CREATE OR REPLACE FUNCTION public.resume_member_program(p_program_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prog    RECORD;
  v_days    INT;
  v_row     JSONB;
  v_restored INT := 0;
BEGIN
  SELECT * INTO v_prog FROM generated_programs WHERE id = p_program_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found'; END IF;
  -- IS DISTINCT FROM y no `<>`: sin sesión `auth.uid()` es NULL, y `uuid <> NULL`
  -- da NULL, no TRUE — el IF no se toma y la comprobación de propiedad no
  -- comprueba nada. Como la función es SECURITY DEFINER, salta la RLS y le
  -- borraría la semana a un socio cualquiera.
  IF v_prog.profile_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not your program'; END IF;
  IF v_prog.paused_at IS NULL THEN
    RETURN jsonb_build_object('not_paused', true);
  END IF;

  -- EPOCH y no EXTRACT(DAY …): `EXTRACT(DAY FROM interval)` devuelve solo el
  -- componente de días, que es correcto para una resta de timestamps pero se
  -- rompe en cuanto el intervalo pase por `justify_interval` y salgan meses.
  v_days := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_prog.paused_at)) / 86400)::INT);

  -- Un programa vivo a la vez: lo que estuviera corriendo se aparta.
  UPDATE generated_programs
  SET expires_at = now()
  WHERE profile_id = v_prog.profile_id
    AND id <> p_program_id
    AND paused_at IS NULL
    AND expires_at > now();

  -- El calendario, de vuelta. Se limpia primero porque durante la pausa el
  -- socio pudo poner cosas a mano y el programa manda al volver.
  DELETE FROM workout_schedule WHERE profile_id = v_prog.profile_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_prog.paused_schedule, '[]'::jsonb))
  LOOP
    BEGIN
      INSERT INTO workout_schedule (profile_id, gym_id, day_of_week, routine_id)
      SELECT v_prog.profile_id, v_prog.gym_id, (v_row->>'day_of_week')::SMALLINT, (v_row->>'routine_id')::UUID
      WHERE EXISTS (SELECT 1 FROM routines r WHERE r.id = (v_row->>'routine_id')::UUID)
      ON CONFLICT (profile_id, day_of_week) DO UPDATE SET routine_id = EXCLUDED.routine_id;
      v_restored := v_restored + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- una rutina borrada no puede impedir devolver el resto de la semana
    END;
  END LOOP;

  UPDATE generated_programs
  SET paused_at = NULL,
      paused_schedule = NULL,
      paused_days = COALESCE(paused_days, 0) + v_days,
      -- Se quita el año que se le dio al pausar y se le devuelven los días que
      -- estuvo parado: pausar no acorta el plan, pero tampoco lo eterniza.
      expires_at = expires_at - INTERVAL '1 year' + (v_days || ' days')::INTERVAL,
      expiry_notified = FALSE
  WHERE id = p_program_id;

  RETURN jsonb_build_object('resumed', true, 'paused_days', v_days, 'restored_days', v_restored);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resume_member_program(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_member_program(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
