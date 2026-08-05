-- =============================================================
-- 0691 — automated_email_log: el correo automático gana dedup propio
-- =============================================================
--
-- POR QUÉ
--
-- El correo de recordatorio de clase colgaba de la notificación in-app: solo
-- se disparaba si insertNotif() había creado fila, y esa fila la mataba
-- `notif_workout_reminders` — una preferencia de PUSH, que vive en la sección
-- de push de los ajustes, bajo el maestro notif_push_enabled.
--
-- Efecto: un miembro con el push apagado y notif_email_classes ENCENDIDO no
-- recibía el correo. Dos canales distintos, un solo interruptor, y el
-- equivocado.
--
-- No se podía arreglar solo moviendo el guard, porque entonces el correo se
-- quedaba sin dedup: send-automated-email no tenía ninguno propio, y el
-- recordatorio corre dos veces por clase.
--
-- Esta tabla es las dos cosas a la vez:
--
--   • El DEDUP. Se reclama la fila ANTES de enviar; si el índice único la
--     rechaza, ya salió y no se manda otra vez. Es a prueba de carreras: la
--     unicidad la decide Postgres, no una lectura previa.
--
--   • El REGISTRO. Hasta ahora no había rastro en ninguna parte de que un
--     correo automático se hubiera intentado, salido o fallado — el insert a
--     admin_audit_log violaba su propio actor_id NOT NULL y, como un insert de
--     Supabase resuelve en vez de lanzar, nadie se enteraba. Y admin_audit_log
--     es para acciones de un ADMIN; un envío disparado por cron no lo es.
--
-- Con `status` guardado, un fallo de proveedor deja de ser invisible y se
-- puede barrer para reintento. Antes, un 502 de Resend quemaba el paso para
-- siempre: la fila de lifecycle_message_log ya estaba escrita y su
-- UNIQUE(profile_id, step_key) la hace terminal.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.automated_email_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id      UUID REFERENCES public.gyms(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,
  step_key    TEXT NOT NULL,
  -- Qué hace único a ESTE envío. Para lifecycle y win-back basta
  -- 'scope:step_key' (una vez en la vida, que es lo que ya garantizan sus
  -- tablas de log). Para clases lleva la reserva y la fecha, porque un miembro
  -- puede tener clase muchos días.
  dedup_key   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'claimed'
                CHECK (status IN ('claimed', 'sent', 'failed')),
  provider_id TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ
);

-- El corazón del dedup. Un miembro, una clave, un correo.
--
-- PARCIAL sobre status <> 'failed', y eso es la mitad del arreglo: sin el
-- predicado, un 502 del proveedor marcaba la fila 'failed' y el índice
-- bloqueaba el reintento PARA SIEMPRE — exactamente el bug que esta tabla
-- existe para eliminar, reproducido un nivel más abajo. Con el predicado, una
-- fila fallida deja de ocupar el hueco y el siguiente intento puede reclamarlo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_automated_email_log_dedup
  ON public.automated_email_log (profile_id, dedup_key)
  WHERE status <> 'failed';

-- Para el barrido de reintentos y para mirar qué pasó en un gimnasio.
CREATE INDEX IF NOT EXISTS idx_automated_email_log_gym_status
  ON public.automated_email_log (gym_id, status, created_at DESC);

ALTER TABLE public.automated_email_log ENABLE ROW LEVEL SECURITY;

-- Solo lectura, y solo del propio gimnasio. Lo escribe el service_role desde
-- la edge function; ningún cliente tiene INSERT/UPDATE aquí, porque poder
-- escribir una fila de dedup es poder SUPRIMIR el correo de otra persona.
DROP POLICY IF EXISTS "automated_email_log_admin_read" ON public.automated_email_log;
CREATE POLICY "automated_email_log_admin_read"
  ON public.automated_email_log FOR SELECT TO authenticated
  USING (gym_id = public.current_gym_id() AND public.is_admin());

DROP POLICY IF EXISTS "automated_email_log_super_read" ON public.automated_email_log;
CREATE POLICY "automated_email_log_super_read"
  ON public.automated_email_log FOR SELECT TO authenticated
  USING (public.is_super_admin());

GRANT SELECT ON public.automated_email_log TO authenticated;

COMMENT ON TABLE public.automated_email_log IS
  'Una fila por correo automático reclamado. El índice único (profile_id, '
  'dedup_key) ES el dedup: la edge function reclama antes de enviar y un '
  'unique_violation significa "ya salió". También es el único registro de que '
  'un envío automático ocurrió.';

-- Envuelto en el guard de pg_extension que usan 0681:165 y 0682:383. Sin él,
-- la migración falla en cualquier entorno sin pg_cron al tocar `cron.job`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Limpieza: 18 meses basta para depurar y para demostrar qué se mandó, y
    -- evita que la tabla crezca sin techo.
    PERFORM cron.unschedule('purge-automated-email-log')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-automated-email-log');
    PERFORM cron.schedule(
      'purge-automated-email-log',
      '40 3 * * *',
      $q$DELETE FROM public.automated_email_log WHERE created_at < NOW() - INTERVAL '18 months'$q$
    );

    -- Lápidas de reclamos que nunca llegaron a enviarse. Si el proceso muere
    -- entre el claim y Resend, la fila se queda en 'claimed' para siempre y el
    -- índice único bloquea el reintento — el mismo modo de fallo que el
    -- predicado parcial resuelve para 'failed'. Una hora es de sobra: la edge
    -- function tiene un tope de decenas de segundos.
    PERFORM cron.unschedule('sweep-stale-email-claims')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-email-claims');
    PERFORM cron.schedule(
      'sweep-stale-email-claims',
      '*/20 * * * *',
      $q$DELETE FROM public.automated_email_log
          WHERE status = 'claimed' AND created_at < NOW() - INTERVAL '1 hour'$q$
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verificar:
--
--   -- Qué salió, qué falló y por qué:
--   SELECT scope, step_key, status, COUNT(*), MAX(created_at)
--     FROM automated_email_log GROUP BY 1,2,3 ORDER BY 5 DESC;
--
--   -- Nada reclamado que nunca llegó a enviarse (si hay muchos, el proveedor
--   -- está rechazando y hay que mirar los logs de la función):
--   SELECT * FROM automated_email_log
--    WHERE status = 'claimed' AND created_at < NOW() - INTERVAL '1 hour';
-- =============================================================
