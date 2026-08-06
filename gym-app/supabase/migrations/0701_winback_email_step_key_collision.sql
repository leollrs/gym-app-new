-- ============================================================
-- 0701 — Los tres momentos de win-back no apuntaban a ninguna parte
-- ============================================================
-- DOS FALLOS EN LA MISMA LÍNEA, Y LOS DOS SON INVISIBLES DESDE LA PANTALLA.
--
-- La lista de momentos que ofrece el editor (`lib/admin/emailAutoSteps.js`)
-- distingue la familia en la propia clave:
--
--   day_1 … day_60                              → ciclo de vida
--   winback_day_7 / winback_day_30 / winback_day_60 → recuperación
--
-- El servidor no. `fire_winback_email` (0687:122) pasa `NEW.step_key` tal cual,
-- y `winback_steps()` (0402:77) emite las claves DESNUDAS: 'day_7', 'day_30',
-- 'day_60'. Y `send-automated-email` busca la plantilla así:
--
--   .eq('step_key', step_key).eq('auto_enabled', true)
--
-- Por step_key A SECAS. No hay columna de ámbito ni filtro que lo distinga.
--
-- FALLO 1 — LOS TRES MOMENTOS DE WIN-BACK ESTÁN MUERTOS
--
-- Nadie emite jamás la cadena 'winback_day_7'. Una plantilla asignada a
-- «Win-back día 7» no la encuentra nunca la consulta, así que el envío se
-- resuelve con `{sent:false, reason:'no_template'}` — un 200, sin fila en
-- automated_email_log, sin error en ningún sitio. El admin ve el momento
-- encendido en su pantalla y no sale un solo correo.
--
-- Esto basta por sí solo para explicar que el win-back automático nunca haya
-- enviado nada. Es INDEPENDIENTE del consentimiento que arregla la 0699: con el
-- opt-out puesto, esto seguiría sin enviar.
--
-- FALLO 2 — Y ES PEOR: LAS TRES CLAVES CHOCAN CON EL CICLO DE VIDA
--
-- `lifecycle_steps()` (0420:47, que amplió la 0400) emite day_1, day_3, day_5,
-- day_7, day_14, day_21, day_30 y day_60. `winback_steps()` emite day_7, day_30
-- y day_60. LOS TRES PASOS DE WIN-BACK COLISIONAN, no uno.
--
-- Como el índice único es (gym_id, step_key) WHERE auto_enabled (0687:40), un
-- gimnasio solo puede tener UNA plantilla para 'day_7' — y la recibirían las dos
-- audiencias. O sea que a alguien que canceló hace siete días le llegaría el
-- correo de bienvenida del séptimo día: «vas por buen camino, sigue así».
--
-- No es un correo que no llega. Es el correo equivocado a la persona
-- equivocada, en el peor momento posible, y con la firma del gimnasio.
--
-- EL ARREGLO
--
-- Calificar la clave en el disparador. Una línea. La pantalla ya habla ese
-- idioma —`winback_day_7` es lo que guarda hoy el editor—, así que lo que se
-- corrige es el lado que se quedó a medias, y de paso desaparece la colisión:
-- 'day_7' vuelve a ser solo del ciclo de vida.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fire_winback_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- `'winback_' || NEW.step_key` y no `NEW.step_key`. La familia va DENTRO de la
  -- clave porque la búsqueda de plantilla es solo por step_key; sin el prefijo,
  -- ciclo de vida y recuperación se disputan la misma fila.
  PERFORM public.fire_automated_email(
    NEW.profile_id, 'winback', 'winback_' || NEW.step_key
  );
  RETURN NEW;
END;
$$;

-- El disparador se vuelve a colgar por si el nombre cambió; `CREATE OR REPLACE`
-- de la función sola no lo toca, pero dejarlo explícito evita depender de eso.
DROP TRIGGER IF EXISTS trg_fire_winback_email ON public.winback_message_log;
CREATE TRIGGER trg_fire_winback_email
  AFTER INSERT ON public.winback_message_log
  FOR EACH ROW EXECUTE FUNCTION public.fire_winback_email();

COMMENT ON FUNCTION public.fire_winback_email() IS
  'Antepone "winback_" a la clave del paso. winback_steps() emite day_7/30/60, '
  'las MISMAS que lifecycle_steps(), y la plantilla se busca solo por step_key: '
  'sin el prefijo las dos familias comparten fila y el que canceló recibe el '
  'correo de bienvenida.';

-- ── Red de seguridad ────────────────────────────────────────
--
-- Si alguien ya había encendido una plantilla en un 'day_7' PENSANDO que era la
-- de recuperación, este cambio la deja sirviendo solo al ciclo de vida — que es
-- lo correcto, pero conviene verlo, no descubrirlo.
DO $report$
DECLARE
  v_row RECORD;
  v_n   INTEGER := 0;
BEGIN
  IF to_regclass('public.gym_email_templates') IS NULL THEN RETURN; END IF;

  FOR v_row IN
    SELECT gym_id, id, name, step_key
      FROM public.gym_email_templates
     WHERE auto_enabled = TRUE
       AND step_key IN ('day_7', 'day_30', 'day_60')
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '[0701] Gimnasio % · plantilla "%" (%) sirve "%" — a partir de ahora SOLO ciclo de vida. Si querías recuperación, reasígnala a winback_%.',
      v_row.gym_id, v_row.name, v_row.id, v_row.step_key, v_row.step_key;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '[0701] Ninguna plantilla encendida en las claves que colisionaban. Nada que revisar.';
  END IF;
END $report$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verificar:
--
--   -- 1. La clave que ahora se busca lleva el prefijo:
--   INSERT INTO winback_message_log (profile_id, gym_id, cancellation_id, step_key, category)
--   VALUES ('<perfil>', '<gym>', '<cancelacion>', 'day_7', 'other');
--   SELECT * FROM net._http_response ORDER BY created DESC LIMIT 1;
--   -- → el cuerpo enviado debe decir "step_key":"winback_day_7"
--
--   -- 2. Ninguna plantilla de recuperación queda huérfana:
--   SELECT step_key, COUNT(*) FROM gym_email_templates
--    WHERE auto_enabled GROUP BY 1 ORDER BY 1;
--
--   -- 3. Y la de ciclo de vida sigue yendo desnuda:
--   INSERT INTO lifecycle_message_log (profile_id, gym_id, step_key)
--   VALUES ('<perfil>', '<gym>', 'day_7');
--   -- → "step_key":"day_7"
-- ============================================================
