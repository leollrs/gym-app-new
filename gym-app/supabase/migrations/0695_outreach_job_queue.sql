-- ============================================================
-- 0695 — Cola de envío en servidor para Outreach
-- ============================================================
-- HOY EL ENVÍO MASIVO CORRE EN LA PESTAÑA DEL NAVEGADOR.
--
-- `sendOutreach` (src/lib/admin/outreachSender.js) recorre la audiencia desde
-- el cliente, invocando `send-admin-email` una vez por destinatario. Cerrar la
-- pestaña, navegar a otra página, dormir el portátil o perder el wifi corta el
-- envío por donde iba — sin cola, sin reanudar y sin saber a quién le faltó.
-- Para un gimnasio de trescientos miembros eso es la mitad de la campaña.
--
-- Esto lo mueve al servidor:
--   • `outreach_jobs`            — un trabajo por campaña
--   • `outreach_job_recipients`  — la lista DURADERA, fila por miembro
--   • `claim_outreach_batch`     — reparto atómico con SKIP LOCKED
--   • cron cada minuto           — recoge lo que quede pendiente
--
-- El cliente encola y le da un empujón a la función para que empiece ya. Si la
-- pestaña sigue abierta, termina rápido; si se cierra, el cron lo remata.
--
-- NO CAMBIA el consentimiento: cada envío sigue pasando por `email_allowed_for`
-- y llevando su enlace de baja. La cola decide CUÁNDO se envía, no A QUIÉN.
-- ============================================================

-- ── El trabajo ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outreach_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id         UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  audience_label TEXT NOT NULL DEFAULT '',
  template_key   TEXT,
  subject        TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  -- El HTML ya renderizado con los merge tags LITERALES. La sustitución por
  -- miembro la hace el procesador, no el navegador: si viniera ya sustituido
  -- habría que guardar un HTML por destinatario.
  html           TEXT,
  personalize    JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Qué recompensa conceder, si la campaña lleva. El CÓDIGO no se guarda aquí:
  -- es por miembro, lo crea `grant_email_campaign_reward` al enviar, y viaja
  -- por el HTML como el token `{{reward_code}}`.
  reward         JSONB,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','done','cancelled')),
  total          INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  last_error     TEXT
);

CREATE INDEX IF NOT EXISTS outreach_jobs_gym_created_idx
  ON public.outreach_jobs (gym_id, created_at DESC);
-- El índice que usa el cron: solo lo que queda vivo.
CREATE INDEX IF NOT EXISTS outreach_jobs_open_idx
  ON public.outreach_jobs (created_at)
  WHERE status IN ('queued','running');

-- ── La lista de destinatarios ───────────────────────────────
-- Esta tabla ES la durabilidad. Cada fila sabe si ya se envió, y por eso
-- cerrar la pestaña deja de importar.
CREATE TABLE IF NOT EXISTS public.outreach_job_recipients (
  id              BIGSERIAL PRIMARY KEY,
  job_id          UUID NOT NULL REFERENCES public.outreach_jobs(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sending','sent','failed','skipped')),
  reason          TEXT,
  attempts        SMALLINT NOT NULL DEFAULT 0,
  -- Backoff del 429: la fila vuelve a estar disponible a partir de esta hora.
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  -- Un miembro no puede estar dos veces en la misma campaña. Sin esto, una
  -- audiencia con solapes (un segmento más unos ids sueltos) le mandaría el
  -- mismo correo dos veces a la misma persona.
  UNIQUE (job_id, profile_id)
);

-- El índice del reparto. `(job_id, id)` y NO `(job_id, next_attempt_at)`:
-- la RPC ordena por `id`, así que con el otro Postgres filtra y luego ORDENA —
-- un sort por lote, ochocientos sorts en un trabajo de veinte mil.
-- `next_attempt_at` se queda como filtro residual.
CREATE INDEX IF NOT EXISTS outreach_job_recipients_claim_idx
  ON public.outreach_job_recipients (job_id, id)
  WHERE status IN ('pending','sending');

-- ── Vista de progreso ───────────────────────────────────────
-- `security_invoker` para que la RLS de las tablas de abajo siga aplicando: sin
-- él la vista corre como su dueño y enseña los trabajos de todos los gimnasios.
CREATE OR REPLACE VIEW public.outreach_job_progress
WITH (security_invoker = true) AS
SELECT
  j.id, j.gym_id, j.audience_label, j.subject, j.status, j.total,
  j.created_at, j.started_at, j.finished_at, j.last_error,
  COUNT(*) FILTER (WHERE r.status = 'sent')    AS sent,
  COUNT(*) FILTER (WHERE r.status = 'failed')  AS failed,
  COUNT(*) FILTER (WHERE r.status = 'skipped') AS skipped,
  COUNT(*) FILTER (WHERE r.status IN ('pending','sending')) AS remaining
FROM public.outreach_jobs j
LEFT JOIN public.outreach_job_recipients r ON r.job_id = j.id
GROUP BY j.id;

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.outreach_jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_job_recipients  ENABLE ROW LEVEL SECURITY;

-- Un bloque DO por objeto y con `lock_timeout`: el DDL de políticas toma
-- ACCESS EXCLUSIVE sobre la tabla, y en una app viva eso puede quedarse
-- esperando detrás de cualquier lectura larga.
DO $pol_jobs$
BEGIN
  SET LOCAL lock_timeout = '5s';
  DROP POLICY IF EXISTS outreach_jobs_admin_read ON public.outreach_jobs;
  CREATE POLICY outreach_jobs_admin_read ON public.outreach_jobs
    FOR SELECT TO authenticated
    USING (
      gym_id = (SELECT gym_id FROM public.profiles WHERE id = auth.uid())
      -- `role` MÁS `additional_roles`: desde 0332 un admin puede serlo por el
      -- array y no por la columna, y mirar solo `role` deja fuera a la mitad.
      -- `additional_roles` es `user_role[]`, no TEXT[] — comparar contra
      -- ARRAY[...]::TEXT[] no compila.
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
           AND (p.role IN ('admin','super_admin')
                OR p.additional_roles && ARRAY['admin','super_admin']::user_role[])
      )
    );
END $pol_jobs$;

DO $pol_rcpt$
BEGIN
  SET LOCAL lock_timeout = '5s';
  DROP POLICY IF EXISTS outreach_job_recipients_admin_read ON public.outreach_job_recipients;
  CREATE POLICY outreach_job_recipients_admin_read ON public.outreach_job_recipients
    FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.outreach_jobs j
       WHERE j.id = job_id
         AND j.gym_id = (SELECT gym_id FROM public.profiles WHERE id = auth.uid())
    ));
END $pol_rcpt$;

-- Nadie escribe estas tablas desde el cliente. Se entra por las RPC de abajo.
GRANT SELECT ON public.outreach_jobs           TO authenticated;
GRANT SELECT ON public.outreach_job_recipients TO authenticated;
GRANT SELECT ON public.outreach_job_progress   TO authenticated;

-- ── Encolar ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_outreach_job(
  p_recipients     UUID[],
  p_subject        TEXT,
  p_body           TEXT,
  p_html           TEXT DEFAULT NULL,
  p_audience_label TEXT DEFAULT '',
  p_template_key   TEXT DEFAULT NULL,
  p_personalize    JSONB DEFAULT '{}'::JSONB,
  p_reward         JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym   UUID;
  v_admin BOOLEAN;
  v_job   UUID;
  v_n     INTEGER;
BEGIN
  SELECT gym_id,
         (role IN ('admin','super_admin')
          OR additional_roles && ARRAY['admin','super_admin']::user_role[])
    INTO v_gym, v_admin
    FROM public.profiles WHERE id = auth.uid();

  IF v_gym IS NULL OR NOT COALESCE(v_admin, FALSE) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = '42501';
  END IF;
  IF p_recipients IS NULL OR array_length(p_recipients, 1) IS NULL THEN
    RAISE EXCEPTION 'no_recipients' USING ERRCODE = '22023';
  END IF;
  -- Techo duro. No es el límite de envío —ese lo pone el proveedor— sino un
  -- tope a lo que una sola pulsación puede encolar.
  IF array_length(p_recipients, 1) > 20000 THEN
    RAISE EXCEPTION 'too_many_recipients' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.outreach_jobs (gym_id, created_by, audience_label, template_key, subject, body, html, personalize, reward)
  VALUES (v_gym, auth.uid(), COALESCE(p_audience_label, ''), p_template_key,
          COALESCE(p_subject, ''), COALESCE(p_body, ''), p_html, COALESCE(p_personalize, '{}'::JSONB), p_reward)
  RETURNING id INTO v_job;

  -- El JOIN contra profiles hace DOS cosas a la vez: rellena el nombre y
  -- confina la campaña al gimnasio del admin. Un id de otro gimnasio metido a
  -- mano en el array simplemente no entra.
  INSERT INTO public.outreach_job_recipients (job_id, profile_id, full_name)
  SELECT v_job, p.id, COALESCE(p.full_name, '')
    FROM public.profiles p
   WHERE p.id = ANY(p_recipients)
     AND p.gym_id = v_gym
  ON CONFLICT (job_id, profile_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    DELETE FROM public.outreach_jobs WHERE id = v_job;
    RAISE EXCEPTION 'no_recipients_in_gym' USING ERRCODE = '22023';
  END IF;

  UPDATE public.outreach_jobs SET total = v_n WHERE id = v_job;
  RETURN v_job;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_outreach_job(UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enqueue_outreach_job(UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) TO authenticated;

-- ── Repartir un lote ────────────────────────────────────────
-- `FOR UPDATE SKIP LOCKED` es la pieza que hace esto correcto: dos ticks del
-- cron solapados cogen filas DISTINTAS. PERO SKIP LOCKED SOLO PROTEGE MIENTRAS
-- LA TRANSACCIÓN DEL REPARTO ESTÁ ABIERTA — y esta RPC entra por PostgREST, así
-- que commitea y suelta el lock en milisegundos, mucho antes de que la función
-- termine de hablar con Resend (15-30 s por lote).
--
-- Por eso hace falta un ARRIENDO: el reparto empuja `next_attempt_at` diez
-- minutos al futuro, y así la fila en vuelo es invisible para el siguiente tick.
-- Sin él, `run_outreach_queue` dispara cada minuto sobre el mismo trabajo, el
-- predicado admite 'sending', `ORDER BY id` coge JUSTO las que se están
-- enviando, y una campaña de 300 miembros manda más de cien correos repetidos.
--
-- Quitar 'sending' del predicado NO sirve como alternativa: dejaría huérfanas
-- para siempre las filas que el 429 devuelve a medio camino. El arriendo cubre
-- las dos cosas — nadie las toca mientras vuelan, y si la función muere se
-- recuperan solas al vencer.
--
-- `attempts < 5` es la cola de descartes: sin tope, una fila que siempre da 429
-- rebota indefinidamente y el trabajo no termina nunca. Mismo patrón que
-- `dequeue_wallet_pushes` (0237:114-115), que ya lo tenía bien.
CREATE OR REPLACE FUNCTION public.claim_outreach_batch(p_job_id UUID, p_limit INTEGER DEFAULT 25)
RETURNS TABLE (recipient_id BIGINT, profile_id UUID, full_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Los parámetros OUT (`profile_id`, `full_name`) se llaman igual que las
-- columnas. Sin esto plpgsql no sabe a cuál te refieres y aborta con
-- "column reference is ambiguous" — en tiempo de EJECUCIÓN, no al crear la
-- función, así que la migración aplicaría limpia y el primer envío fallaría.
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT r.id
      FROM public.outreach_job_recipients r
     WHERE r.job_id = p_job_id
       AND r.status IN ('pending','sending')
       AND r.next_attempt_at <= NOW()
       AND r.attempts < 5
     ORDER BY r.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
       FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outreach_job_recipients r
     SET status = 'sending',
         attempts = r.attempts + 1,
         next_attempt_at = NOW() + INTERVAL '10 minutes'
    FROM picked
   WHERE r.id = picked.id
  RETURNING r.id, r.profile_id, r.full_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_outreach_batch(UUID, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_outreach_batch(UUID, INTEGER) TO service_role;

-- ── Cerrar una fila ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finish_outreach_recipient(
  p_recipient_id BIGINT,
  p_status       TEXT,
  p_reason       TEXT DEFAULT NULL,
  p_retry_after  INTEGER DEFAULT NULL   -- segundos; devuelve la fila a 'pending'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
     SET status = p_status,
         reason = p_reason,
         sent_at = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END
   WHERE id = p_recipient_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_outreach_recipient(BIGINT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.finish_outreach_recipient(BIGINT, TEXT, TEXT, INTEGER) TO service_role;

-- ── Marcar el trabajo ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_outreach_job(p_job_id UUID, p_error TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_left INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_left
    FROM public.outreach_job_recipients
   WHERE job_id = p_job_id AND status IN ('pending','sending');

  IF v_left = 0 THEN
    UPDATE public.outreach_jobs
       SET status = 'done', finished_at = NOW(), last_error = p_error
     WHERE id = p_job_id AND status <> 'cancelled';
    RETURN 'done';
  END IF;

  UPDATE public.outreach_jobs
     SET status = 'running',
         started_at = COALESCE(started_at, NOW()),
         last_error = p_error
   WHERE id = p_job_id AND status = 'queued';
  RETURN 'running';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_outreach_job(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.settle_outreach_job(UUID, TEXT) TO service_role;

-- ── Cancelar (el admin se arrepiente a mitad) ───────────────
CREATE OR REPLACE FUNCTION public.cancel_outreach_job(p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym   UUID;
  v_admin BOOLEAN;
BEGIN
  -- Reja de admin, la misma que `enqueue_outreach_job`. Se me quedó fuera:
  -- estaba concedida a `authenticated` comprobando SOLO el gimnasio, así que
  -- cualquier miembro con un job_id mataba la campaña de su gimnasio.
  SELECT gym_id,
         (role IN ('admin','super_admin')
          OR additional_roles && ARRAY['admin','super_admin']::user_role[])
    INTO v_gym, v_admin
    FROM public.profiles WHERE id = auth.uid();
  IF v_gym IS NULL OR NOT COALESCE(v_admin, FALSE) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = '42501';
  END IF;

  UPDATE public.outreach_jobs
     SET status = 'cancelled', finished_at = NOW()
   WHERE id = p_job_id AND gym_id = v_gym AND status IN ('queued','running');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found_or_finished' USING ERRCODE = '22023';
  END IF;
  -- Lo que aún no salió no sale. Lo ya enviado no se puede deshacer.
  UPDATE public.outreach_job_recipients
     SET status = 'skipped', reason = 'cancelled'
   WHERE job_id = p_job_id AND status IN ('pending','sending');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_outreach_job(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_outreach_job(UUID) TO authenticated;

-- ── El tick ─────────────────────────────────────────────────
-- Secretos por Vault, NO por current_setting('app.settings.*'): ese parámetro
-- no está configurado en este proyecto y hacía que cada tick reventara con
-- 42704 (ver 0606). Si Vault no está puesto, esto no falla — se salta.
CREATE OR REPLACE FUNCTION public.run_outreach_queue()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_job UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.outreach_jobs
     WHERE status IN ('queued','running')
     LIMIT 1
  ) THEN
    RETURN;   -- nada que hacer; ni se leen los secretos
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url'     LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE LOG 'run_outreach_queue: vault secrets not configured, skipping';
    RETURN;
  END IF;

  -- Un empujón por trabajo abierto, hasta cinco por tick. La función procesa un
  -- lote y vuelve; el minuto siguiente sigue por donde iba.
  -- La ventana de 24 h es lo que impide que un trabajo atascado mate de hambre
  -- a los nuevos. El tick coge cinco por vuelta y `ORDER BY created_at` favorece
  -- a los viejos: cinco zombis —p. ej. si falta RESEND_API_KEY y la función
  -- devuelve 500 antes de repartir— ocupaban las cinco ranuras PARA SIEMPRE y
  -- ninguna campaña nueva volvía a recibir tick. Siguen visibles como atascados
  -- en la vista de progreso; simplemente dejan de acaparar el turno.
  FOR v_job IN
    SELECT id FROM public.outreach_jobs
     WHERE status IN ('queued','running')
       AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at
     LIMIT 5
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/process-outreach-jobs',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body    := jsonb_build_object('job_id', v_job)
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'run_outreach_queue failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_outreach_queue() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_outreach_queue() TO service_role;

DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[0695] pg_cron not installed — the queue will only advance on the client nudge.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outreach-queue-1min') THEN
    PERFORM cron.unschedule('outreach-queue-1min');
  END IF;
  PERFORM cron.schedule('outreach-queue-1min', '* * * * *', $q$ SELECT public.run_outreach_queue(); $q$);
END $cron$;
