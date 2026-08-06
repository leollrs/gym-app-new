-- ============================================================
-- 0699 — El win-back automático deja de nacer apagado
-- ============================================================
-- `notif_email_winback` se creó en 0685 con DEFAULT FALSE, o sea opt-in: el
-- miembro tenía que encenderlo él. Sobre el papel es la postura prudente. En la
-- práctica hacía imposible lo único que el win-back automático sirve para
-- hacer, porque para recibirlo había que ser alguien que:
--
--   1. cancela su membresía, y acto seguido
--   2. abre la app que está dejando, entra en Ajustes → Notificaciones, y
--   3. enciende «correos invitándome a volver».
--
-- Ese miembro no existe. El resultado medible es que la cadencia automática de
-- los días 7/30/60 NUNCA ha enviado un solo correo — `fire_automated_email`
-- (0687:62) consulta `email_allowed_for` antes de la llamada HTTP, así que ni
-- siquiera llegaba a la edge function ni dejaba rastro en `automated_email_log`.
-- Cero envíos y cero registro de por qué: indistinguible de «no está montado».
--
-- LA LEY DICE OPT-OUT, NO OPT-IN
--
-- El comentario de 0685 tenía razón en que un «te echamos de menos» es
-- contenido comercial y no transaccional. De ahí no se sigue que haga falta
-- permiso previo. En EE.UU. y Puerto Rico rige CAN-SPAM (15 U.S.C. §7704), que
-- es un régimen de EXCLUSIÓN: no exige consentimiento anticipado, exige
-- cabeceras y remitente honestos, asunto no engañoso, DIRECCIÓN POSTAL FÍSICA
-- en el mensaje, y una baja que funcione y se respete. Las cuatro ya están
-- montadas: `headerSafe` sanea las cabeceras, `List-Unsubscribe` +
-- `List-Unsubscribe-Post` van en cada envío, `/u/:token` es la página humana y
-- `appendComplianceFooter` imprime la dirección.
--
-- El consentimiento previo es el estándar del RGPD, que aplica a interesados en
-- la UE. Una cadena de gimnasios en Puerto Rico no los tiene.
--
-- Lo que NO cambia, y es lo que mantiene esto en el lado correcto de la ley:
-- el interruptor sigue existiendo en Ajustes → Notificaciones, la baja de un
-- clic sigue funcionando, y `email_allowed_for` sigue consultando la columna.
-- Se invierte el punto de partida, no se quita la salida.
-- ============================================================

-- ── El relleno de las filas que ya existen ──────────────────
--
-- ESTO SOLO ES SEGURO PORQUE HOY NO HAY NADIE. No se ha enlistado ningún
-- gimnasio; cada perfil de la base es de prueba. Un FALSE hoy significa «nunca
-- se tocó», no «alguien dijo que no» — y esas dos cosas son indistinguibles
-- mirando la columna, que es justo lo que hace peligroso este UPDATE el día de
-- mañana.
--
-- Por eso el guard. Si esta migración se vuelve a correr cuando ya haya
-- miembros de verdad, resucitaría el consentimiento de todo el que se hubiera
-- dado de baja del win-back — silenciosamente, y contra CAN-SPAM, que obliga a
-- respetar la baja. El centinela es el DEFAULT de la propia columna: se lee
-- ANTES de cambiarlo, así que en la segunda pasada ya vale TRUE y el relleno no
-- se ejecuta. Sin tabla de control ni marca aparte.
DO $winback_backfill$
DECLARE
  v_default TEXT;
  v_rows    INTEGER;
BEGIN
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'profiles'
     AND column_name  = 'notif_email_winback';

  IF v_default IS NOT NULL AND lower(v_default) LIKE 'true%' THEN
    RAISE NOTICE '[0699] El default ya es TRUE — la migración ya corrió. NO se toca ninguna fila.';
    RETURN;
  END IF;

  UPDATE public.profiles
     SET notif_email_winback = TRUE
   WHERE notif_email_winback = FALSE;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RAISE NOTICE '[0699] Relleno único: % perfiles pasan a recibir win-back automático.', v_rows;
END $winback_backfill$;

-- Y a partir de aquí, quien se registre nace incluido.
ALTER TABLE public.profiles ALTER COLUMN notif_email_winback SET DEFAULT TRUE;

COMMENT ON COLUMN public.profiles.notif_email_winback IS
  'Opt-OUT (default true desde 0699). El win-back automático es contenido '
  'comercial bajo CAN-SPAM, que no exige permiso previo pero sí una baja que '
  'funcione: Ajustes → Notificaciones, el enlace del pie, y List-Unsubscribe. '
  'Poner esto en false es la baja, y email_allowed_for la respeta.';

-- ── La dirección postal deja de ser opcional en silencio ────
--
-- `appendComplianceFooter` imprime la dirección SI se la pasan, y los dos
-- remitentes se la pasan como `ctx.gym.address ?? null`. Un gimnasio sin
-- dirección rellenada no rompe nada: el pie simplemente sale sin ella, y el
-- correo comercial deja de cumplir CAN-SPAM sin que nadie lo note.
--
-- Hoy da igual porque no hay gimnasio real. El día que lo haya, esta vista es
-- lo que hay que mirar antes de encender una automatización.
CREATE OR REPLACE VIEW public.gyms_missing_postal_address
WITH (security_invoker = true) AS
  SELECT g.id AS gym_id, g.name, g.slug
    FROM public.gyms g
   WHERE g.is_active
     AND COALESCE(btrim(g.address), '') = '';

COMMENT ON VIEW public.gyms_missing_postal_address IS
  'Gimnasios activos sin dirección postal. CAN-SPAM la exige en todo correo '
  'comercial; sin ella el pie sale incompleto y el envío deja de cumplir. '
  'security_invoker: solo ve lo que ya podría ver quien pregunta.';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verificar:
--
--   -- 1. Nadie se queda fuera por el default viejo:
--   SELECT notif_email_winback, COUNT(*) FROM profiles GROUP BY 1;
--
--   -- 2. El default nuevo está puesto:
--   SELECT column_default FROM information_schema.columns
--    WHERE table_name = 'profiles' AND column_name = 'notif_email_winback';
--   -- → true
--
--   -- 3. Volver a correr la migración NO debe tocar filas (mira el NOTICE).
--
--   -- 4. La baja sigue mandando:
--   UPDATE profiles SET notif_email_winback = FALSE WHERE id = '<perfil>';
--   SELECT email_allowed_for('<perfil>', 'winback');   -- → false
--
--   -- 5. Antes de encender una automatización comercial:
--   SELECT * FROM gyms_missing_postal_address;          -- → debe estar vacía
-- ============================================================
