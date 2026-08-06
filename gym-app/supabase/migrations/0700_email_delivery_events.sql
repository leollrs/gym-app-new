-- ============================================================
-- 0700 — Rebotes y quejas: el correo deja de ser un agujero negro
-- ============================================================
-- HOY «ENVIADO» NO SIGNIFICA «LLEGÓ». Significa que la API de Resend aceptó el
-- payload y devolvió un id. El rebote ocurre después, asíncrono, y no hay
-- absolutamente nada escuchándolo: en todo el repositorio no existe un solo
-- webhook de Resend.
--
-- La prueba más limpia de que esto se diseñó y nunca se construyó está en la
-- propia 0685:80, donde `email_suppressions.reason` ya admite:
--
--   CHECK (reason IN ('unsubscribed','bounced','complained','manual'))
--
-- `'bounced'` y `'complained'` aparecen en todo el código UNA vez — esa línea.
-- Nadie los escribe jamás. La lista de supresión existe, la columna que
-- distingue el motivo existe, y el que tenía que rellenarla no se llegó a
-- escribir.
--
-- LO QUE CUESTA, Y NO ES LA PANTALLA QUE FALTA
--
-- Una dirección muerta nunca entra en supresión, así que se le vuelve a
-- escribir en CADA campaña futura. Y como toda la plataforma manda desde el
-- mismo `noreply@tugympr.com`, la reputación que se quema no es la del gimnasio
-- con los datos sucios: es la de todos: sus invitaciones, sus recuperaciones de
-- contraseña y sus códigos de acceso. Los proveedores puntúan el DOMINIO.
--
-- Gmail y Yahoo publican el umbral desde febrero de 2024: por debajo de 0,3% de
-- quejas. Sin registrar quejas no se puede ni saber si se está por encima.
--
-- Lo único que hay hoy es que `email_allowed_for` anula las direcciones que
-- terminan en `.invalid`. Un falso realista —`juan@gmial.com`, un dedazo— sale,
-- rebota, y el rebote se pierde.
-- ============================================================

-- ── 1. Un renglón por evento del proveedor ──────────────────
CREATE TABLE IF NOT EXISTS public.email_delivery_events (
  id          BIGSERIAL PRIMARY KEY,
  -- El id del MENSAJE DE WEBHOOK (cabecera `svix-id`), no el del correo. Es lo
  -- que hace idempotente esta tabla: Svix reintenta el mismo mensaje hasta que
  -- le contestas 2xx, y sin esta clave un fallo transitorio nuestro se
  -- convierte en el mismo rebote contado cinco veces.
  event_id    TEXT NOT NULL UNIQUE,
  -- El id que devolvió Resend al aceptar el envío. Es la única forma de atar un
  -- rebote a la campaña que lo provocó.
  provider_id TEXT,
  email       TEXT NOT NULL,
  event_type  TEXT NOT NULL
                CHECK (event_type IN ('delivered','bounced','complained','delayed','failed')),
  -- Permanente vs transitorio, tal como lo clasifica el proveedor. LA
  -- DIFERENCIA ES TODA LA TABLA: un buzón lleno (transitorio) se reintenta y no
  -- se suprime; una dirección que no existe (permanente) se suprime para
  -- siempre. Suprimir por un rebote blando es perder a un miembro real.
  bounce_kind TEXT CHECK (bounce_kind IN ('permanent','transient','undetermined')),
  detail      TEXT,
  gym_id      UUID REFERENCES public.gyms(id)     ON DELETE CASCADE,
  profile_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- De dónde salió el correo: 'automated', 'outreach' o NULL si no se pudo atar.
  source      TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_events_gym
  ON public.email_delivery_events (gym_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_delivery_events_provider
  ON public.email_delivery_events (provider_id) WHERE provider_id IS NOT NULL;

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

-- Solo lectura, y solo del propio gimnasio. La escribe el service_role desde el
-- webhook: poder insertar aquí es poder suprimir el correo de cualquiera.
DROP POLICY IF EXISTS email_delivery_events_admin_read ON public.email_delivery_events;
CREATE POLICY email_delivery_events_admin_read
  ON public.email_delivery_events FOR SELECT TO authenticated
  USING (gym_id = public.current_gym_id() AND public.is_admin());

DROP POLICY IF EXISTS email_delivery_events_super_read ON public.email_delivery_events;
CREATE POLICY email_delivery_events_super_read
  ON public.email_delivery_events FOR SELECT TO authenticated
  USING (public.is_super_admin());

GRANT SELECT ON public.email_delivery_events TO authenticated;

-- ── 2. Poder atar un rebote a su campaña ────────────────────
--
-- `automated_email_log` ya guarda `provider_id` (0691) pero sin índice: la
-- búsqueda del webhook sería un recorrido completo de la tabla por cada evento.
CREATE INDEX IF NOT EXISTS idx_automated_email_log_provider
  ON public.automated_email_log (provider_id) WHERE provider_id IS NOT NULL;

-- La cola (0695) no lo guardaba en absoluto, así que un rebote de una campaña
-- de Outreach era incorrelacionable: se sabía que la dirección rebotó, no a
-- quién se le había mandado ni desde qué envío.
--
-- Todo el bloque va tras un centinela porque la 0695 puede no estar aplicada
-- todavía. Sin él, un `ALTER TABLE` sobre una tabla inexistente aborta la
-- migración entera y se queda sin registrar TAMBIÉN el correo automático, que
-- no tiene nada que ver con la cola. Un `IF NOT EXISTS` de columna no protege
-- de que falte la tabla.
DO $outreach_provider$
BEGIN
  IF to_regclass('public.outreach_job_recipients') IS NULL THEN
    RAISE NOTICE '[0700] outreach_job_recipients no existe (0695 sin aplicar) — se omite la correlación de campañas. Vuelve a correr esta migración después de la 0695.';
    RETURN;
  END IF;

  ALTER TABLE public.outreach_job_recipients ADD COLUMN IF NOT EXISTS provider_id TEXT;

  CREATE INDEX IF NOT EXISTS idx_outreach_recipients_provider
    ON public.outreach_job_recipients (provider_id) WHERE provider_id IS NOT NULL;

  -- La firma de 4 argumentos se SUSTITUYE, no se complementa. Un
  -- `CREATE OR REPLACE` con un parámetro más deja las dos vivas y toda llamada
  -- con los 4 originales pasa a ser ambigua (42725), o sea que la cola dejaría
  -- de poder cerrar destinatarios.
  DROP FUNCTION IF EXISTS public.finish_outreach_recipient(BIGINT, TEXT, TEXT, INTEGER);

  CREATE OR REPLACE FUNCTION public.finish_outreach_recipient(
    p_recipient_id BIGINT,
    p_status       TEXT,
    p_reason       TEXT    DEFAULT NULL,
    p_retry_after  INTEGER DEFAULT NULL,  -- segundos; devuelve la fila a 'pending'
    p_provider_id  TEXT    DEFAULT NULL   -- el id de Resend, para atar el rebote
  )
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
  BEGIN
    IF p_retry_after IS NOT NULL THEN
      UPDATE public.outreach_job_recipients
         SET status = 'pending',
             reason = p_reason,
             next_attempt_at = NOW() + make_interval(secs => GREATEST(1, LEAST(p_retry_after, 900)))
       WHERE id = p_recipient_id;
      RETURN;
    END IF;

    IF p_status NOT IN ('sent','failed','skipped') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;

    UPDATE public.outreach_job_recipients
       SET status  = p_status,
           reason  = p_reason,
           sent_at = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END,
           -- COALESCE: un reintento que no traiga id no debe borrar el que ya
           -- había, o el rebote se quedaría huérfano.
           provider_id = COALESCE(NULLIF(p_provider_id, ''), provider_id)
     WHERE id = p_recipient_id;
  END;
  $fn$;

  REVOKE EXECUTE ON FUNCTION public.finish_outreach_recipient(BIGINT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
  GRANT  EXECUTE ON FUNCTION public.finish_outreach_recipient(BIGINT, TEXT, TEXT, INTEGER, TEXT) TO service_role;
END $outreach_provider$;

-- ── 3. El registrador ───────────────────────────────────────
--
-- La lógica vive AQUÍ y no en la edge function a propósito: es la que decide
-- quién deja de recibir correo para siempre, y en SQL se puede probar con una
-- transacción y un ROLLBACK. La función se queda con lo suyo, que es verificar
-- la firma.
CREATE OR REPLACE FUNCTION public.record_email_delivery_event(
  p_event_id    TEXT,
  p_provider_id TEXT,
  p_email       TEXT,
  p_event_type  TEXT,
  p_bounce_kind TEXT DEFAULT NULL,
  p_detail      TEXT DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_gym        UUID;
  v_profile    UUID;
  v_source     TEXT;
  v_suppressed BOOLEAN := FALSE;
  v_inserted   BIGINT;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_id required');
  END IF;
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email required');
  END IF;

  -- ── Atar el evento a un miembro ──
  --
  -- Por `provider_id` primero, que es exacto. Se mira el correo automático y
  -- luego la cola de Outreach.
  IF p_provider_id IS NOT NULL AND p_provider_id <> '' THEN
    SELECT l.gym_id, l.profile_id, 'automated'
      INTO v_gym, v_profile, v_source
      FROM public.automated_email_log l
     WHERE l.provider_id = p_provider_id
     LIMIT 1;

    -- El centinela `to_regclass` no es adorno. plpgsql planifica cada sentencia
    -- la primera vez que LA EJECUTA, así que con la 0695 sin aplicar este
    -- SELECT reventaría con 42P01 en tiempo de ejecución — no al crear la
    -- función — y el rebote se perdería justo cuando importa. Con la guarda, la
    -- sentencia ni se planifica y la correlación cae a la dirección de abajo.
    IF v_profile IS NULL AND to_regclass('public.outreach_job_recipients') IS NOT NULL THEN
      SELECT j.gym_id, r.profile_id, 'outreach'
        INTO v_gym, v_profile, v_source
        FROM public.outreach_job_recipients r
        JOIN public.outreach_jobs j ON j.id = r.job_id
       WHERE r.provider_id = p_provider_id
       LIMIT 1;
    END IF;
  END IF;

  -- Sin id de proveedor —los envíos sueltos de send-admin-email no lo
  -- guardan— se cae a la dirección. Es menos preciso (dos personas pueden
  -- compartir buzón) pero para SUPRIMIR da igual: la supresión es del buzón,
  -- no de la persona, y por eso 0685 la indexó por `lower(email)`.
  IF v_profile IS NULL THEN
    SELECT p.id, p.gym_id INTO v_profile, v_gym
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
     WHERE lower(u.email) = lower(btrim(p_email))
     LIMIT 1;
  END IF;

  INSERT INTO public.email_delivery_events
    (event_id, provider_id, email, event_type, bounce_kind, detail,
     gym_id, profile_id, source, occurred_at)
  VALUES
    (p_event_id, NULLIF(p_provider_id, ''), btrim(p_email), p_event_type,
     p_bounce_kind, left(COALESCE(p_detail, ''), 1000),
     v_gym, v_profile, v_source, COALESCE(p_occurred_at, NOW()))
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO v_inserted;

  -- Reentrega del mismo mensaje de webhook. Ya está contado; no se vuelve a
  -- suprimir ni se devuelve error, porque a Svix hay que contestarle 2xx o
  -- reintenta indefinidamente.
  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  -- ── La supresión ──
  --
  -- SOLO rebote PERMANENTE y queja. Un rebote transitorio es un buzón lleno o
  -- un servidor caído: suprimir por eso es echar a un miembro real por un
  -- problema de un martes. Y 'undetermined' tampoco, por lo mismo — ante la
  -- duda, se sigue escribiendo.
  --
  -- Una queja SÍ suprime siempre, y es lo más importante de esta función: quien
  -- pulsa «spam» ya le dijo a su proveedor que este remitente no le importa.
  -- Volver a escribirle es cómo se pierde el dominio para todos los gimnasios.
  IF (p_event_type = 'bounced' AND p_bounce_kind = 'permanent')
     OR p_event_type = 'complained' THEN
    INSERT INTO public.email_suppressions (email, gym_id, profile_id, reason)
    VALUES (
      btrim(p_email), v_gym, v_profile,
      CASE WHEN p_event_type = 'complained' THEN 'complained' ELSE 'bounced' END
    )
    ON CONFLICT (lower(email)) DO NOTHING;
    v_suppressed := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'suppressed', v_suppressed,
    'profile_id', v_profile, 'gym_id', v_gym, 'source', v_source
  );
END;
$$;

-- Solo el webhook. Ningún cliente: escribir aquí es poder silenciar el correo
-- de otra persona para siempre.
REVOKE ALL ON FUNCTION public.record_email_delivery_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_email_delivery_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_delivery_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ── 4. El resumen que mira el admin ─────────────────────────
--
-- `security_invoker`: la vista no da acceso a nada; la RLS de la tabla sigue
-- decidiendo, así que cada gimnasio ve el suyo.
CREATE OR REPLACE VIEW public.email_deliverability_30d
WITH (security_invoker = true) AS
  SELECT
    e.gym_id,
    COUNT(*) FILTER (WHERE e.event_type = 'delivered')                                    AS delivered,
    COUNT(*) FILTER (WHERE e.event_type = 'bounced')                                      AS bounced,
    COUNT(*) FILTER (WHERE e.event_type = 'bounced' AND e.bounce_kind = 'permanent')      AS bounced_hard,
    COUNT(*) FILTER (WHERE e.event_type = 'complained')                                   AS complained,
    MAX(e.occurred_at)                                                                    AS last_event_at
  FROM public.email_delivery_events e
 WHERE e.occurred_at >= NOW() - INTERVAL '30 days'
 GROUP BY e.gym_id;

GRANT SELECT ON public.email_deliverability_30d TO authenticated;

COMMENT ON VIEW public.email_deliverability_30d IS
  'Entregas, rebotes y quejas por gimnasio, últimos 30 días. La tasa de quejas '
  'debe quedar por debajo de 0,3% (umbral público de Gmail/Yahoo desde 2024) o '
  'el dominio COMPARTIDO se degrada para toda la plataforma.';

-- ── 5. Limpieza ─────────────────────────────────────────────
DO $purge$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-email-delivery-events')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-email-delivery-events');
    -- Dos vencimientos distintos a propósito. Un 'delivered' es ruido pasados
    -- tres meses y es el 95% del volumen. Un rebote o una queja es la razón por
    -- la que alguien dejó de recibir correo, y eso hay que poder demostrarlo
    -- tanto como la baja: mismo plazo que automated_email_log.
    PERFORM cron.schedule(
      'purge-email-delivery-events',
      '50 3 * * *',
      $q$DELETE FROM public.email_delivery_events
          WHERE (event_type IN ('delivered','delayed') AND occurred_at < NOW() - INTERVAL '90 days')
             OR occurred_at < NOW() - INTERVAL '18 months'$q$
    );
  END IF;
END $purge$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verificar:
--
--   -- 1. Un rebote duro suprime; el blando NO:
--   BEGIN;
--   SELECT record_email_delivery_event('evt_test_1','re_x','nadie@ejemplo.com',
--            'bounced','permanent','550 no such user');
--   SELECT reason FROM email_suppressions WHERE lower(email)='nadie@ejemplo.com';  -- bounced
--   SELECT record_email_delivery_event('evt_test_2','re_y','lleno@ejemplo.com',
--            'bounced','transient','452 mailbox full');
--   SELECT COUNT(*) FROM email_suppressions WHERE lower(email)='lleno@ejemplo.com'; -- 0
--   ROLLBACK;
--
--   -- 2. Idempotencia (Svix reintenta): el segundo no cuenta.
--   BEGIN;
--   SELECT record_email_delivery_event('evt_dup','re_z','a@b.com','delivered');
--   SELECT record_email_delivery_event('evt_dup','re_z','a@b.com','delivered');
--   SELECT COUNT(*) FROM email_delivery_events WHERE event_id='evt_dup';  -- 1
--   ROLLBACK;
--
--   -- 3. Nadie salvo el service_role puede llamarla:
--   SET ROLE authenticated;
--   SELECT record_email_delivery_event('x','y','z@z.com','bounced');  -- permission denied
--   RESET ROLE;
-- ============================================================
