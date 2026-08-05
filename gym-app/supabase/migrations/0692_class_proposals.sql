-- =============================================================
-- 0692 — class_proposals: la propuesta del entrenador pasa a existir
-- =============================================================
--
-- QUÉ ESTABA ROTO
--
-- Un entrenador rellena "Proponer nueva clase" (nombre, descripción, día, hora,
-- duración), pulsa enviar, y ve "Propuesta enviada al admin". Pero la propuesta
-- no se guardaba en ninguna parte consultable:
--
--   • Una fila en admin_audit_log con action='class_proposal' y los detalles en
--     JSONB. Un grep por 'class_proposal' en todo src/ fuera de trainer/
--     devuelve CERO: ninguna pantalla del admin la lee jamás.
--
--   • Una notificación in-app + push que dice "revisa los detalles y créala
--     desde Clases si te cuadra" — pero el cuerpo solo lleva el NOMBRE. El día,
--     la hora, la duración y la descripción viajan en el payload `data` y en el
--     JSONB del audit, y ninguna pantalla pinta ninguno de los dos.
--
-- O sea: el admin recibe un aviso de que existe una propuesta que no puede
-- leer, sobre la que no puede actuar, y a la que no puede responder. Y el
-- entrenador nunca se entera de si se aceptó o no.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- Le da a la propuesta una fila propia con ESTADO. El audit log se queda como
-- rastro de cumplimiento; esta tabla es el flujo de trabajo.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.class_proposals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id           UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  trainer_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  -- Domingo = 0, como en toda la app (workout_schedule, gym_class_schedules).
  suggested_day    SMALLINT CHECK (suggested_day BETWEEN 0 AND 6),
  suggested_time   TIME,
  duration_minutes INT NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 480),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'dismissed')),
  decided_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  -- Qué clase salió de esta propuesta, cuando salió alguna. SET NULL y no
  -- CASCADE: borrar la clase no debe borrar el registro de que se propuso.
  created_class_id UUID REFERENCES public.gym_classes(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El panel del admin lee las pendientes de su gimnasio, más nuevas primero.
CREATE INDEX IF NOT EXISTS idx_class_proposals_gym_status
  ON public.class_proposals (gym_id, status, created_at DESC);

-- El entrenador lee las suyas.
CREATE INDEX IF NOT EXISTS idx_class_proposals_trainer
  ON public.class_proposals (trainer_id, created_at DESC);

ALTER TABLE public.class_proposals ENABLE ROW LEVEL SECURITY;

-- El entrenador ve las SUYAS — incluido el resultado, que hasta ahora nunca
-- volvía a él.
DROP POLICY IF EXISTS "class_proposals_own_read" ON public.class_proposals;
CREATE POLICY "class_proposals_own_read"
  ON public.class_proposals FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

-- El admin ve y decide las de su gimnasio. Multi-rol correcto vía is_admin()
-- (0465 ya lo amplió para leer additional_roles).
DROP POLICY IF EXISTS "class_proposals_admin_read" ON public.class_proposals;
CREATE POLICY "class_proposals_admin_read"
  ON public.class_proposals FOR SELECT TO authenticated
  USING (gym_id = public.current_gym_id() AND public.is_admin());

DROP POLICY IF EXISTS "class_proposals_super_read" ON public.class_proposals;
CREATE POLICY "class_proposals_super_read"
  ON public.class_proposals FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Sin INSERT ni UPDATE por policy: se escribe solo a través de los dos RPC de
-- abajo. Poder escribir la fila directamente sería poder marcar como aceptada
-- la propuesta de otro, o proponer en nombre de otro entrenador.
GRANT SELECT ON public.class_proposals TO authenticated;

-- ── Enviar una propuesta ─────────────────────────────────────
--
-- Sustituye al par log_admin_action + notify_class_proposal que hacía el
-- cliente por su cuenta. Aquí las tres cosas pasan juntas: fila, auditoría y
-- aviso. Si algo falla, no queda una propuesta a medias.

CREATE OR REPLACE FUNCTION public.submit_class_proposal(
  p_name        TEXT,
  p_description TEXT DEFAULT NULL,
  p_day         SMALLINT DEFAULT NULL,
  p_time        TIME DEFAULT NULL,
  p_duration    INT DEFAULT 60
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_role    TEXT;
  v_extra   user_role[];
  v_gym     UUID;
  v_id      UUID;
  v_name    TEXT := NULLIF(trim(p_name), '');
  v_details JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF v_name IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NAME_REQUIRED');
  END IF;

  SELECT role::text, additional_roles, gym_id INTO v_role, v_extra, v_gym
    FROM profiles WHERE id = v_uid;

  -- Entrenadores y admins. Mismo patrón multi-rol que admin_create_member
  -- (0467:67-83): la autoridad puede venir de `role` O de `additional_roles`.
  IF v_gym IS NULL OR NOT (
       v_role IN ('trainer', 'admin', 'super_admin')
       OR 'trainer'::user_role     = ANY(COALESCE(v_extra, '{}'))
       OR 'admin'::user_role       = ANY(COALESCE(v_extra, '{}'))
       OR 'super_admin'::user_role = ANY(COALESCE(v_extra, '{}'))
     ) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- Un mismo entrenador no puede acumular propuestas idénticas pendientes a
  -- base de pulsar dos veces.
  IF EXISTS (
    SELECT 1 FROM class_proposals
    WHERE trainer_id = v_uid AND status = 'pending' AND lower(name) = lower(v_name)
  ) THEN
    RETURN json_build_object('success', false, 'error', 'ALREADY_PENDING');
  END IF;

  INSERT INTO class_proposals (
    gym_id, trainer_id, name, description, suggested_day, suggested_time, duration_minutes
  ) VALUES (
    v_gym, v_uid, v_name, NULLIF(trim(COALESCE(p_description, '')), ''),
    p_day, p_time, GREATEST(5, LEAST(480, COALESCE(p_duration, 60)))
  )
  RETURNING id INTO v_id;

  v_details := jsonb_build_object(
    'proposal_id', v_id,
    'class_name', v_name,
    'description', p_description,
    'suggested_day', p_day,
    'suggested_time', p_time,
    'duration_minutes', p_duration
  );

  -- Auditoría y aviso, best-effort: la propuesta ya está guardada y ni un fallo
  -- de log ni uno de notificación deben tumbarla.
  BEGIN
    PERFORM public.log_admin_action('class_proposal', 'class', v_id, v_details);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'submit_class_proposal: audit failed: %', SQLERRM;
  END;

  BEGIN
    PERFORM public.notify_class_proposal(v_name, v_details);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'submit_class_proposal: notify failed: %', SQLERRM;
  END;

  RETURN json_build_object('success', true, 'proposal_id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_class_proposal(TEXT, TEXT, SMALLINT, TIME, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_class_proposal(TEXT, TEXT, SMALLINT, TIME, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.submit_class_proposal(TEXT, TEXT, SMALLINT, TIME, INT) TO authenticated;

-- ── Decidir una propuesta ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decide_class_proposal(
  p_proposal_id UUID,
  p_status      TEXT,
  p_class_id    UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_role   TEXT;
  v_extra  user_role[];
  v_gym    UUID;
  v_p      RECORD;
BEGIN
  IF p_status NOT IN ('accepted', 'dismissed') THEN
    RETURN json_build_object('success', false, 'error', 'BAD_STATUS');
  END IF;

  SELECT role::text, additional_roles, gym_id INTO v_role, v_extra, v_gym
    FROM profiles WHERE id = v_uid;

  IF v_gym IS NULL OR NOT (
       v_role IN ('admin', 'super_admin')
       OR 'admin'::user_role       = ANY(COALESCE(v_extra, '{}'))
       OR 'super_admin'::user_role = ANY(COALESCE(v_extra, '{}'))
     ) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_p FROM class_proposals WHERE id = p_proposal_id;
  IF v_p.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- El gimnasio se deriva de auth.uid(), nunca del argumento.
  IF v_role <> 'super_admin'
     AND NOT ('super_admin'::user_role = ANY(COALESCE(v_extra, '{}')))
     AND v_p.gym_id IS DISTINCT FROM v_gym THEN
    RETURN json_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  IF v_p.status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'ALREADY_DECIDED',
                             'status', v_p.status);
  END IF;

  UPDATE class_proposals SET
    status           = p_status,
    decided_by       = v_uid,
    decided_at       = NOW(),
    decision_note    = NULLIF(trim(COALESCE(p_note, '')), ''),
    created_class_id = CASE WHEN p_status = 'accepted' THEN p_class_id ELSE NULL END
  WHERE id = p_proposal_id;

  -- Cerrar el círculo: el entrenador se entera. Hasta ahora proponía y nunca
  -- volvía a saber nada.
  BEGIN
    -- OJO con el orden: _notify_member (0538:173-182) toma
    -- (…, title_EN, body_EN, title_ES, body_ES, …). Inglés primero. Invertirlo
    -- le manda el texto inglés a un entrenador hispanohablante y al revés — el
    -- mismo modo de fallo que 0538 existe para documentar.
    PERFORM public._notify_member(
      v_p.trainer_id, v_p.gym_id, 'announcement'::notification_type,
      CASE WHEN p_status = 'accepted' THEN 'Your class proposal was accepted'
           ELSE 'Your class proposal was dismissed' END,
      CASE WHEN p_status = 'accepted'
           THEN '"' || v_p.name || '" is now on the gym calendar.'
           ELSE '"' || v_p.name || '" is not moving forward for now.'
             || COALESCE(' ' || NULLIF(trim(COALESCE(p_note, '')), ''), '') END,
      CASE WHEN p_status = 'accepted' THEN 'Tu propuesta de clase fue aceptada'
           ELSE 'Tu propuesta de clase fue descartada' END,
      CASE WHEN p_status = 'accepted'
           THEN '"' || v_p.name || '" ya está en el calendario del gimnasio.'
           ELSE '"' || v_p.name || '" no sigue adelante por ahora.'
             || COALESCE(' ' || NULLIF(trim(COALESCE(p_note, '')), ''), '') END,
      jsonb_build_object('route', '/trainer/classes', 'proposal_id', p_proposal_id),
      'class_proposal_decided_' || p_proposal_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'decide_class_proposal: notify failed: %', SQLERRM;
  END;

  BEGIN
    PERFORM public.log_admin_action(
      'class_proposal_' || p_status, 'class', p_proposal_id,
      jsonb_build_object('class_name', v_p.name, 'created_class_id', p_class_id));
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'decide_class_proposal: audit failed: %', SQLERRM;
  END;

  RETURN json_build_object('success', true, 'status', p_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decide_class_proposal(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decide_class_proposal(UUID, TEXT, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.decide_class_proposal(UUID, TEXT, UUID, TEXT) TO authenticated;

-- ── Rescatar las propuestas que ya se enviaron ───────────────
--
-- Todo lo propuesto hasta hoy vive únicamente como fila de admin_audit_log. Sin
-- este backfill, cada entrenador que ya usó el botón perdería su propuesta al
-- estrenar la pantalla que por fin las muestra.

INSERT INTO public.class_proposals (
  gym_id, trainer_id, name, description, suggested_day, suggested_time,
  duration_minutes, created_at
)
SELECT
  a.gym_id,
  a.actor_id,
  COALESCE(NULLIF(trim(a.details ->> 'class_name'), ''), 'Clase propuesta'),
  NULLIF(trim(COALESCE(a.details ->> 'description', '')), ''),
  -- El cliente mandaba estos campos sin tipar: se validan antes de castear o
  -- un valor raro abortaría la migración entera.
  CASE WHEN a.details ->> 'suggested_day' ~ '^[0-6]$'
       THEN (a.details ->> 'suggested_day')::SMALLINT END,
  CASE WHEN a.details ->> 'suggested_time' ~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$'
       THEN (a.details ->> 'suggested_time')::TIME END,
  CASE WHEN a.details ->> 'duration_minutes' ~ '^[0-9]{1,3}$'
       THEN GREATEST(5, LEAST(480, (a.details ->> 'duration_minutes')::INT))
       ELSE 60 END,
  a.created_at
FROM public.admin_audit_log a
WHERE a.action = 'class_proposal'
  AND a.gym_id IS NOT NULL
  AND a.actor_id IS NOT NULL
  -- Solo las de los últimos 90 días: una propuesta de hace un año no es una
  -- tarea pendiente, es historia.
  AND a.created_at >= NOW() - INTERVAL '90 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.class_proposals cp
    WHERE cp.trainer_id = a.actor_id
      AND lower(cp.name) = lower(COALESCE(NULLIF(trim(a.details ->> 'class_name'), ''), 'Clase propuesta'))
  );

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verificar:
--
--   -- Cuántas propuestas se rescataron del audit log:
--   SELECT gym_id, status, COUNT(*) FROM class_proposals GROUP BY 1, 2;
--
--   -- Que ninguna quedó sin gimnasio o sin entrenador (no debería salir nada):
--   SELECT * FROM class_proposals WHERE gym_id IS NULL OR trainer_id IS NULL;
-- =============================================================
