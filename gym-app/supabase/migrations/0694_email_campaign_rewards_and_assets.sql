-- =============================================================
-- 0694_email_campaign_rewards_and_assets.sql
--
-- 1) UN CÓDIGO DE RECOMPENSA POR MIEMBRO, NO UNO POR CAMPAÑA
--
-- El bloque de recompensa de una plantilla de correo llevaba `code`: un campo
-- de texto libre, el MISMO string para los trescientos miembros que reciben
-- la campaña. Con eso no se puede saber quién canjeó, no se puede impedir que
-- uno lo reenvíe al grupo de WhatsApp y lo usen todos, y no se puede cerrar
-- una promoción porque no hay nada que cerrar.
--
-- NO se crea tabla nueva. `earned_rewards` (0370) ya es exactamente esto:
-- tiene `qr_code` único, `status` pending/redeemed/expired, `expires_at`,
-- `dedup_key`, y —lo que importa— ya está enganchada al escáner de recepción
-- (`handleEarnedRewardScan` → `redeem_earned_reward`) y a la pantalla de
-- recompensas del miembro. Reusarla significa que el canje FUNCIONA el primer
-- día en vez de ser un segundo sistema a medio hacer.
--
-- Lo único que falta es dejar entrar el origen 'email_campaign' y una función
-- que conceda la recompensa en el momento del envío.
--
-- 2) BUCKET PARA LAS IMÁGENES DE CORREO
--
-- La cabecera del correo era una caja de texto donde pegar una URL. Para
-- poder subir un archivo hace falta dónde ponerlo. Público a propósito: los
-- clientes de correo no se autentican, y una URL firmada caduca y deja el
-- correo con un hueco meses después de haberlo enviado.
-- =============================================================

-- ── 1. Nuevo origen ──────────────────────────────────────────
--
-- El CHECK se reemplaza entero: añadir uno nuevo dejaría los dos y la fila
-- tendría que cumplir ambos.
--
-- LA LISTA SALE DE 0458, NO DE 0370. Es el mismo error que ya documentamos
-- para las vistas —reconstruir desde una definición vieja— aplicado a un
-- CHECK: 0370 creó la tabla con tres orígenes y 0458 la amplió a cinco
-- ('print_card' y 'redemption_refund', que el código ya escribía). Rehacer la
-- restricción desde 0370 borra esos dos y Postgres rechaza el ALTER porque hay
-- filas vivas que los usan:
--
--   ERROR: check constraint "earned_rewards_source_check" of relation
--          "earned_rewards" is violated by some row
--
-- Antes de tocar nada, se comprueba que no haya un sexto origen que ninguna
-- migración documente. Si lo hay, el error dice CUÁL y cuántas filas — que es
-- accionable — en vez del 23514 opaco de arriba.
DO $$
DECLARE
  v_unexpected TEXT;
BEGIN
  -- Sin DISTINCT: el GROUP BY de abajo ya devuelve un origen por fila.
  SELECT string_agg(format('%s (%s filas)', source, cnt), ', ')
    INTO v_unexpected
    FROM (
      SELECT source, count(*) AS cnt
        FROM public.earned_rewards
       WHERE source NOT IN (
               'birthday', 'referral_milestone', 'manual_grant',
               'print_card', 'redemption_refund', 'email_campaign')
       GROUP BY source
    ) s;

  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION
      'earned_rewards.source tiene valores que esta migración no contempla: %. '
      'Añádelos a la lista del CHECK en 0694 antes de aplicarla.', v_unexpected;
  END IF;
END $$;

ALTER TABLE public.earned_rewards
  DROP CONSTRAINT IF EXISTS earned_rewards_source_check;

ALTER TABLE public.earned_rewards
  ADD CONSTRAINT earned_rewards_source_check
  CHECK (source IN (
    'birthday',
    'referral_milestone',
    'manual_grant',
    'print_card',         -- 0415 / 0458
    'redemption_refund',  -- 0458
    'email_campaign'      -- esta migración
  ));

-- De qué plantilla salió, para poder medir la campaña. Nullable: los tres
-- orígenes anteriores no tienen plantilla.
ALTER TABLE public.earned_rewards
  ADD COLUMN IF NOT EXISTS template_id UUID
    REFERENCES public.gym_email_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_earned_rewards_template
  ON public.earned_rewards (template_id, status)
  WHERE template_id IS NOT NULL;

-- ── 2. Conceder la recompensa de una campaña ─────────────────
--
-- SECURITY DEFINER porque la llama el enviador con service-role (correo
-- automático) y también el admin desde Outreach. El gimnasio NO se toma del
-- parámetro: se deriva del miembro, así que no hay forma de sembrar
-- recompensas en otro inquilino.
--
-- Idempotente por `dedup_key`. Reenviar la misma campaña al mismo miembro
-- devuelve el código que ya tenía en vez de darle un segundo regalo — que es
-- lo que pasaría si el cron reintentara.

CREATE OR REPLACE FUNCTION public.grant_email_campaign_reward(
  p_profile_id  UUID,
  p_template_id UUID,
  p_label       TEXT,
  p_label_es    TEXT DEFAULT NULL,
  p_reward_id   UUID DEFAULT NULL,
  p_expires_at  TIMESTAMPTZ DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym       UUID;
  v_dedup     TEXT;
  v_existing  RECORD;
  v_qr        TEXT;
  v_id        UUID;
BEGIN
  IF p_profile_id IS NULL OR p_template_id IS NULL THEN
    RETURN json_build_object('granted', false, 'reason', 'missing_args');
  END IF;

  SELECT gym_id INTO v_gym FROM profiles WHERE id = p_profile_id;
  IF v_gym IS NULL THEN
    RETURN json_build_object('granted', false, 'reason', 'no_member');
  END IF;

  -- Los DOS parámetros con clave foránea se validan contra el gimnasio que se
  -- acaba de derivar del miembro.
  --
  -- El comentario de arriba decía que "el gimnasio NO se toma del parámetro,
  -- así que no hay forma de sembrar recompensas en otro inquilino". Eso era
  -- cierto para `gym_id` y FALSO para estos dos: `p_template_id` podía apuntar
  -- a la plantilla de otro gimnasio y `p_reward_id` a su catálogo, y ambos
  -- aterrizaban tal cual en una fila sellada con el gimnasio del miembro —
  -- ensuciando las métricas de campaña del vecino.
  IF NOT EXISTS (
    SELECT 1 FROM gym_email_templates WHERE id = p_template_id AND gym_id = v_gym
  ) THEN
    RETURN json_build_object('granted', false, 'reason', 'template_wrong_gym');
  END IF;

  IF p_reward_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM gym_rewards WHERE id = p_reward_id AND gym_id = v_gym
  ) THEN
    RETURN json_build_object('granted', false, 'reason', 'reward_wrong_gym');
  END IF;

  -- Una recompensa por plantilla y por miembro, de por vida. Es la misma
  -- garantía que dan las tablas de log de lifecycle/win-back.
  v_dedup := 'email_campaign_' || p_template_id::text || '_' || p_profile_id::text;

  SELECT id, qr_code INTO v_existing
    FROM earned_rewards
   WHERE dedup_key = v_dedup
   LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object('granted', false, 'reason', 'already_granted',
                             'id', v_existing.id, 'code', v_existing.qr_code);
  END IF;

  -- gen_random_bytes() no está disponible en todos los proyectos (0463:232);
  -- gen_random_uuid() sí. 10 caracteres es corto para teclearlo a mano si el
  -- escáner falla, y sigue siendo inadivinable.
  v_qr := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO earned_rewards (
    gym_id, profile_id, reward_id, reward_label, reward_label_es,
    source, dedup_key, qr_code, status, expires_at, template_id
  ) VALUES (
    v_gym, p_profile_id, p_reward_id,
    COALESCE(NULLIF(trim(p_label), ''), 'Reward'),
    NULLIF(trim(COALESCE(p_label_es, '')), ''),
    'email_campaign', v_dedup, v_qr, 'pending', p_expires_at, p_template_id
  )
  RETURNING id INTO v_id;

  RETURN json_build_object('granted', true, 'id', v_id, 'code', v_qr);

EXCEPTION
  -- Carrera entre dos envíos simultáneos al mismo miembro: el índice único de
  -- dedup_key decide, y el perdedor devuelve el código del ganador en vez de
  -- reventar el envío entero.
  WHEN unique_violation THEN
    SELECT id, qr_code INTO v_existing FROM earned_rewards WHERE dedup_key = v_dedup LIMIT 1;
    RETURN json_build_object('granted', false, 'reason', 'already_granted',
                             'id', v_existing.id, 'code', v_existing.qr_code);
END;
$$;

-- El índice único de `dedup_key` que hace real el reintento idempotente ya
-- existe desde 0370 (`idx_earned_rewards_dedup`). Crear otro aquí sería un
-- segundo índice sobre la misma columna: mismo comportamiento, doble coste de
-- escritura.

-- SOLO service_role. NO `authenticated`.
--
-- Esta función es SECURITY DEFINER, toma `p_profile_id` y `p_label` del
-- llamante y no tiene autorización interna. Dársela a `authenticated` es
-- exactamente el agujero que 0479 documentó y cerró para su hermana
-- `award_earned_reward`:
--
--   "award_earned_reward tiene CERO autz interna y toma p_profile_id como
--    parámetro -> cualquiera con la clave anon puede fabricar recompensas
--    para cualquier miembro"
--
-- Con el GRANT abierto, cualquier entrenador —que puede leer
-- gym_email_templates (0190:28) y por tanto tiene un p_template_id válido—
-- se fabrica desde la consola del navegador una fila `pending` con un
-- qr_code que el escáner de recepción honra sin más comprobación que el
-- estado y el gimnasio (scanActionHandlers.js:557-590).
--
-- La ÚNICA llamadora legítima es la edge function send-automated-email, que
-- corre con service-role. `service_role` conserva el suyo por los ALTER DEFAULT PRIVILEGES del proyecto (0479:101) — no por ser superusuario, que no lo es,
-- así que basta con no concedérselo a nadie más — pero se deja explícito
-- para que el siguiente que lea esto no lo "arregle" abriéndolo.
REVOKE EXECUTE ON FUNCTION public.grant_email_campaign_reward(UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_email_campaign_reward(UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_email_campaign_reward(UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ) FROM authenticated;

-- ── 2b. La caducidad tiene que APLICARSE ─────────────────────
--
-- `expires_at` existe en earned_rewards desde 0370 y hasta ahora era puramente
-- decorativa: `redeem_earned_reward` nunca la miraba, `handleEarnedRewardScan`
-- tampoco, y no hay ningún cron que pase `pending` → `expired`. O sea que el
-- correo dice "válido hasta el 31 de agosto" y en enero recepción lo sigue
-- canjeando — y `expired_count` en la vista de abajo sería siempre 0.
--
-- Prometer una fecha en un correo y no aplicarla es peor que no prometerla:
-- el gimnasio cierra la promoción en su cabeza y sigue pagándola.
--
-- Verbatim de 0471:693 salvo el bloque de caducidad. OJO: reconstruir esta
-- función desde 0370 en vez de desde 0471 borraría la corrección multi-rol
-- (additional_roles) — es el error que ya cometí con el CHECK de `source`.

CREATE OR REPLACE FUNCTION public.redeem_earned_reward(p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $redeem$
DECLARE
  v_row       RECORD;
  v_admin_gym UUID;
  v_role      TEXT;
  v_extra     user_role[];
  v_is_super  BOOLEAN;
  v_is_admin  BOOLEAN;
BEGIN
  SELECT gym_id, role::text, additional_roles
    INTO v_admin_gym, v_role, v_extra
    FROM public.profiles WHERE id = auth.uid();

  v_is_super := (v_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_extra, '{}')));
  v_is_admin := v_is_super
                OR v_role = 'admin'
                OR 'admin'::user_role = ANY(COALESCE(v_extra, '{}'));

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_row FROM public.earned_rewards WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Earned reward not found';
  END IF;

  IF v_row.gym_id != v_admin_gym AND NOT v_is_super THEN
    RAISE EXCEPTION 'Wrong gym';
  END IF;

  IF v_row.status != 'pending' THEN
    RAISE EXCEPTION 'Already %', v_row.status;
  END IF;

  -- Caducada: se marca como tal y se rechaza. Marcarla además de rechazarla
  -- hace que la cuenta de la vista de campañas sea real y que el siguiente
  -- escaneo dé "ya expirada" en vez de repetir esta comprobación.
  --
  -- ACOTADO A LAS CAMPAÑAS DE CORREO, A PROPÓSITO.
  --
  -- `redeem_earned_reward` no es solo de campañas: por aquí pasan también las
  -- tarjetas impresas, los cumpleaños y los hitos de referidos. Y
  -- `attach_reward_to_print_card` (0595:76-84) sella SIEMPRE `expires_at`. Sin
  -- acotar, aplicar esta migración habría dejado de golpe sin canjear toda
  -- tarjeta impresa pendiente con la fecha ya pasada, y el primer escaneo la
  -- habría marcado 'expired' de forma irreversible. Eso es un cambio de
  -- comportamiento del mostrador entero escondido dentro de una migración que
  -- dice ser de correo — y sin aviso ni periodo de gracia.
  --
  -- Si algún día se quiere aplicar a todo, que sea su propia migración, con el
  -- recuento por `source` delante y decidido a la vista de los números.
  IF v_row.source = 'email_campaign'
     AND v_row.expires_at IS NOT NULL AND v_row.expires_at < NOW() THEN
    UPDATE public.earned_rewards SET status = 'expired' WHERE id = p_id;
    RAISE EXCEPTION 'Reward expired';
  END IF;

  UPDATE public.earned_rewards
     SET status = 'redeemed', redeemed_at = NOW()
   WHERE id = p_id;

  RETURN json_build_object('id', p_id, 'status', 'redeemed', 'redeemed_at', NOW());
END;
$redeem$;

-- ── 3. Vista de campañas ─────────────────────────────────────
-- Lo que el admin necesita ver para saber si una campaña está viva: cuántos
-- regalos salieron, cuántos se canjearon y cuándo fue el último.
--
-- security_invoker: la vista se lee con los permisos de QUIEN consulta, así
-- que las políticas RLS de earned_rewards siguen mandando y un admin no ve
-- las campañas de otro gimnasio. Sin esto una vista corre como su dueño y se
-- convierte en un agujero entre inquilinos.

CREATE OR REPLACE VIEW public.email_campaign_rewards_summary
WITH (security_invoker = true) AS
SELECT
  er.gym_id,
  er.template_id,
  t.name                                              AS template_name,
  t.step_key,
  t.auto_enabled,
  COUNT(*)                                            AS granted_count,
  COUNT(*) FILTER (WHERE er.status = 'redeemed')      AS redeemed_count,
  COUNT(*) FILTER (WHERE er.status = 'pending')       AS pending_count,
  COUNT(*) FILTER (WHERE er.status = 'expired')       AS expired_count,
  -- 0592 añadió 'cancelled' al CHECK de status. Sin contarlo,
  -- granted_count != redeemed + pending + expired y los números no cuadran.
  COUNT(*) FILTER (WHERE er.status = 'cancelled')     AS cancelled_count,
  MIN(er.created_at)                                  AS first_granted_at,
  MAX(er.created_at)                                  AS last_granted_at,
  MAX(er.redeemed_at)                                 AS last_redeemed_at
FROM public.earned_rewards er
LEFT JOIN public.gym_email_templates t ON t.id = er.template_id
WHERE er.source = 'email_campaign'
GROUP BY er.gym_id, er.template_id, t.name, t.step_key, t.auto_enabled;

GRANT SELECT ON public.email_campaign_rewards_summary TO authenticated;

-- ── 4. Bucket de imágenes de correo ──────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('email-assets', 'email-assets', TRUE, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = TRUE,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Las políticas de storage van en su PROPIO bloque con lock_timeout.
--
-- Cada DROP/CREATE POLICY toma un ACCESS EXCLUSIVE sobre `storage.objects`,
-- que es la tabla más caliente del proyecto: cada avatar, cada vídeo de
-- ejercicio, cada foto de progreso, cada imagen de clase. Sin tope de espera,
-- una sola lectura lenta en vuelo deja la migración encolada sosteniendo una
-- cola de bloqueos que congela TODAS las subidas y descargas de la plataforma.
--
-- Es la regla que este repo ya sigue en 0671, 0672, 0680 y 0683. Aquí faltaba,
-- y encima el DDL de storage compartía transacción con el ALTER TABLE de
-- earned_rewards.
DO $storage_pol$
BEGIN
  SET LOCAL lock_timeout = '5s';

  -- Lectura pública: la tiene que poder pedir el cliente de correo del miembro,
  -- que no trae sesión ninguna.
  DROP POLICY IF EXISTS "email_assets_public_read" ON storage.objects;
  CREATE POLICY "email_assets_public_read"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'email-assets');

  -- Escribe solo un admin, y solo dentro de la carpeta de SU gimnasio: la ruta
  -- es `${gym_id}/…`, así que el primer segmento tiene que ser su gym_id. Sin
  -- esa comprobación cualquier admin podría sobrescribir las imágenes de otro.
  DROP POLICY IF EXISTS "email_assets_admin_write" ON storage.objects;
  CREATE POLICY "email_assets_admin_write"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'email-assets'
      AND public.is_admin()
      AND (storage.foldername(name))[1] = (SELECT gym_id::text FROM profiles WHERE id = auth.uid())
    );

  DROP POLICY IF EXISTS "email_assets_admin_delete" ON storage.objects;
  CREATE POLICY "email_assets_admin_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (
      bucket_id = 'email-assets'
      AND public.is_admin()
      AND (storage.foldername(name))[1] = (SELECT gym_id::text FROM profiles WHERE id = auth.uid())
    );
END
$storage_pol$;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verificar:
--
--   -- Conceder dos veces al mismo miembro devuelve el MISMO codigo:
--   SELECT public.grant_email_campaign_reward('<profile>', '<template>', 'Batido gratis');
--   SELECT public.grant_email_campaign_reward('<profile>', '<template>', 'Batido gratis');
--   -- → el segundo: granted=false, reason='already_granted', mismo code.
--
--   -- El codigo escanea en recepcion por el camino que ya existia:
--   --   pega `earned-reward:<CODE>` en el escaner de /admin → debe canjear.
--
--   -- Resumen de campanas del gimnasio:
--   SELECT * FROM public.email_campaign_rewards_summary;
--
--   -- Un admin NO puede escribir en la carpeta de otro gimnasio:
--   --   subir a `email-assets/<otro-gym-id>/x.jpg` → debe fallar por RLS.
-- =============================================================
