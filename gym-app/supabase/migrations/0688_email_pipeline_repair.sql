-- =============================================================
-- 0688 — Repara la cadena de correo automático (0685 + 0686 + 0687)
-- =============================================================
--
-- La auditoría del 08-03 encontró que el correo automático tiene un 0% de
-- envío desde que se aplicó, y que era invisible por diseño: la edge function
-- devuelve 200 cuando el contexto falla, así que pg_net ve éxito.
--
-- Cinco defectos, cuatro de ellos aquí:
--
--   1. member_email_context selecciona profiles.timezone — COLUMNA QUE NO
--      EXISTE. timezone vive en `gyms` (0001:51). Ninguna de las 687
--      migraciones la añade a profiles; scheduled-reminders/index.ts:879 ya lo
--      documentaba. CREATE OR REPLACE FUNCTION solo revisa la sintaxis del
--      cuerpo plpgsql, así que 0686 aplicó limpia y la función revienta con
--      42703 en CADA llamada.
--
--   2. 0685 y 0686 leen profiles.language. La migración 0538 existe
--      literalmente para documentar que esa columna está muerta y que la app
--      nunca la escribe — la real es preferred_language (0058). Efecto: cada
--      correo automático y la página de baja salen en inglés, en una
--      plataforma de Puerto Rico.
--
--   3. El fallback de generated_programs devolvía la rutina EQUIVOCADA. El
--      JOIN a routines no tenía correlación con la entrada de routine_day_map,
--      así que hacía producto cartesiano y ORDER BY r.created_at DESC LIMIT 1
--      se quedaba con la rutina creada más recientemente, sin importar el día.
--      La estructura real: routine_day_map indexa SLOTS
--      ({routine_index, day_of_week}) y routine_ids_a[slot] es la rutina de ese
--      slot (MemberProgramBuilder.jsx:417-431, :646-657).
--
--   4. El prefijo `Auto: ` se colaba al cuerpo del correo. Dashboard lo quita
--      vía localizeRoutineName (exerciseName.js:87) ANTES de quitar el sufijo
--      A/B; 0686 solo quitaba el sufijo. El correo decía "Tu plan de hoy:
--      Auto: Push".
--
--   5. lifecycle y win-back comparten step_key. day_7/day_30/day_60 existen en
--      AMBOS vocabularios (0420:48-55 y 0402:83-85) y la búsqueda de plantilla
--      filtra gym_id + step_key + auto_enabled sin noción de ámbito. Un
--      gimnasio que encienda su plantilla de "Día 7" de bienvenida se la manda
--      textual a quien canceló hace 7 días. Y el índice único
--      (gym_id, step_key) WHERE auto_enabled impide siquiera tener las dos.
--      Se arregla prefijando en el trigger de win-back — el editor YA escribe
--      la forma prefijada (EmailTemplateEditor.jsx:65-69), así que este cambio
--      alinea los dos lados de una vez.
--
-- El quinto defecto (el UPDATE de tres columnas en AdminEmailTemplates.jsx que
-- descartaba step_key y auto_enabled) es de frontend y va aparte.
--
-- No hace falta migrar datos: auto_enabled arranca en FALSE y el único camino
-- que llegaba a escribir step_key era crear-nueva, que ya escribe la forma
-- prefijada. Se verifica al final de todos modos.
-- =============================================================

-- ── 1. member_email_context — reconstruida desde la definición de 0686 ──
--
-- Reconstruida entera, no parcheada: es la única forma de no perder nada de la
-- definición vigente (misma disciplina que exige CREATE OR REPLACE VIEW).

CREATE OR REPLACE FUNCTION public.member_email_context(p_profile_id UUID)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_p            RECORD;
  v_gym          RECORD;
  v_brand        RECORD;
  v_email        TEXT;
  v_lang         TEXT;
  v_tz           TEXT;
  v_today        DATE;
  v_dow          INT;
  v_plan_name    TEXT;
  v_slot_routine TEXT;
  v_is_rest      BOOLEAN := FALSE;
  v_has_schedule BOOLEAN := FALSE;
  v_class        RECORD;
  v_instructor   TEXT;
  v_streak       INT := 0;
  v_workouts     INT := 0;
  v_days_inactive INT;
  v_last_class   TEXT;
BEGIN
  -- preferred_language, NO language: ver 0538. `language` es una columna
  -- legada que la app nunca escribe, así que COALESCE(language,'en') siempre
  -- daba 'en'.
  SELECT id, gym_id, full_name, preferred_language, language,
         last_active_at, email_unsub_token
    INTO v_p FROM profiles WHERE id = p_profile_id;
  IF v_p.id IS NULL THEN RETURN json_build_object('found', false); END IF;

  -- timezone es del GIMNASIO (0001:51), no del perfil. Este es el 42703 que
  -- mataba la función entera.
  SELECT name, address, timezone INTO v_gym FROM gyms WHERE id = v_p.gym_id;
  SELECT logo_url, primary_color, secondary_color, custom_app_name
    INTO v_brand FROM gym_branding WHERE gym_id = v_p.gym_id;

  v_lang := COALESCE(NULLIF(v_p.preferred_language, ''), NULLIF(v_p.language, ''), 'en');

  -- The real address: admin-created members carry a shadow
  -- invite-<uuid>@invite.tugympr.invalid on auth.users, with the true one in
  -- raw_user_meta_data.pending_email (0603).
  SELECT COALESCE(
           NULLIF(u.raw_user_meta_data ->> 'pending_email', ''),
           CASE WHEN u.email LIKE '%@%.invalid' THEN NULL ELSE u.email END)
    INTO v_email FROM auth.users u WHERE u.id = p_profile_id;

  -- Todo lo que tenga forma de fecha va en la zona del gimnasio, no la del
  -- servidor. Mismo COALESCE que 0433:108 y 0434:69.
  v_tz    := COALESCE(NULLIF(v_gym.timezone, ''), 'America/Puerto_Rico');
  v_today := (NOW() AT TIME ZONE v_tz)::DATE;
  v_dow   := EXTRACT(DOW FROM v_today)::INT;   -- 0 = Sunday, app-wide

  -- ── Today's plan ──
  SELECT EXISTS (SELECT 1 FROM workout_schedule WHERE profile_id = p_profile_id)
    INTO v_has_schedule;

  -- El prefijo `Auto: ` se quita ANTES del sufijo A/B, igual que
  -- localizeRoutineName (exerciseName.js:87) seguido de Dashboard.jsx:791.
  SELECT regexp_replace(regexp_replace(r.name, '^Auto:\s*', ''), ' [AB]$', '')
    INTO v_plan_name
    FROM workout_schedule ws
    JOIN routines r ON r.id = ws.routine_id
   WHERE ws.profile_id = p_profile_id AND ws.day_of_week = v_dow
   LIMIT 1;

  IF v_plan_name IS NULL AND v_has_schedule THEN
    -- They have a schedule and today isn't in it. Rest day, and we stop.
    v_is_rest := TRUE;
  ELSIF v_plan_name IS NULL THEN
    -- Sin horario personal — caer al mapa del programa generado.
    --
    -- routine_day_map indexa SLOTS: [{routine_index, day_of_week}], y la
    -- rutina de un slot vive en routine_ids_a[slot] (MemberProgramBuilder.jsx
    -- :646-657). La versión de 0686 unía `routines` sin ninguna correlación
    -- con la entrada, así que devolvía la rutina creada más recientemente sin
    -- importar el día.
    --
    -- No se resuelve la variante A/B a propósito: esta rama solo la alcanza
    -- quien NO tiene ninguna fila en workout_schedule — es decir, programas
    -- auto-generados, donde el slot i se llama "Push A" / "Push B" y el sufijo
    -- se quita igual. Un programa construido a mano SÍ escribe
    -- workout_schedule, así que resuelve por la rama de arriba.
    -- En dos pasos a propósito: resolver el id y castearlo dentro del mismo
    -- JOIN significa que un valor malformado en el JSON reventaría la función
    -- entera, que es exactamente el modo de fallo que esta migración arregla.
    -- El guard de abajo lo degrada a "no hay plan", y la línea desaparece.
    SELECT COALESCE(
             gp.schedule_map -> 'routine_ids_a' ->> (m.entry ->> 'routine_index')::INT,
             gp.schedule_map -> 'routine_ids'   ->> (m.entry ->> 'routine_index')::INT)
      INTO v_slot_routine
      FROM generated_programs gp
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(gp.schedule_map -> 'routine_day_map', '[]'::jsonb)) AS m(entry)
     WHERE gp.profile_id = p_profile_id
       AND gp.expires_at > NOW()
       AND (m.entry ->> 'day_of_week')::INT = v_dow
     ORDER BY gp.created_at DESC
     LIMIT 1;

    -- Ya no hace falta el guard de `created_at >= program_start` que traía
    -- 0686: el id sale del mapa del programa vigente, así que por construcción
    -- no puede ser una rutina huérfana de un programa regenerado. Aquel guard
    -- existía porque la consulta vieja unía TODAS las rutinas `Auto:` del
    -- miembro sin correlación con el día.
    IF v_slot_routine ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT regexp_replace(regexp_replace(r.name, '^Auto:\s*', ''), ' [AB]$', '')
        INTO v_plan_name
        FROM routines r WHERE r.id = v_slot_routine::UUID;
    END IF;
  END IF;

  -- ── Next booked class ──
  SELECT b.booking_date, s.start_time, s.id AS schedule_id, s.trainer_id AS slot_trainer,
         c.name, c.name_es, c.trainer_id AS class_trainer, c.instructor_name
    INTO v_class
    FROM gym_class_bookings b
    JOIN gym_class_schedules s ON s.id = b.schedule_id
    JOIN gym_classes c         ON c.id = s.class_id
   WHERE b.profile_id = p_profile_id
     AND b.status = 'confirmed'
     AND b.booking_date >= v_today
   ORDER BY b.booking_date ASC, s.start_time ASC
   LIMIT 1;

  IF v_class.schedule_id IS NOT NULL THEN
    -- Per-slot trainer wins, then the class's, then the free-text name.
    SELECT full_name INTO v_instructor FROM profiles
     WHERE id = COALESCE(v_class.slot_trainer, v_class.class_trainer);
    v_instructor := COALESCE(NULLIF(v_instructor, ''), NULLIF(v_class.instructor_name, ''));
  END IF;

  -- The class they used to attend — for win-back, where "next class" is empty
  -- by definition.
  SELECT COALESCE(NULLIF(c.name_es, ''), c.name) INTO v_last_class
    FROM gym_class_bookings b
    JOIN gym_class_schedules s ON s.id = b.schedule_id
    JOIN gym_classes c         ON c.id = s.class_id
   WHERE b.profile_id = p_profile_id AND b.status IN ('attended','confirmed')
   ORDER BY b.booking_date DESC LIMIT 1;

  -- ── Stats ──
  SELECT COALESCE(current_streak_days, 0) INTO v_streak
    FROM streak_cache WHERE profile_id = p_profile_id;
  SELECT COUNT(*) INTO v_workouts
    FROM workout_sessions WHERE profile_id = p_profile_id AND status = 'completed';
  -- last_active_at es timestamptz: se castea en la zona del gimnasio, no en la
  -- de la sesión (UTC en Supabase). Sin esto, quien entrenó anoche recibe
  -- "llevas 1 día sin venir".
  v_days_inactive := CASE WHEN v_p.last_active_at IS NULL THEN NULL
                          ELSE GREATEST(0, (v_today - (v_p.last_active_at AT TIME ZONE v_tz)::DATE)) END;

  RETURN json_build_object(
    'found', true,
    'profile_id', v_p.id,
    'gym_id', v_p.gym_id,
    'email', v_email,
    'language', v_lang,
    'unsub_token', v_p.email_unsub_token,
    'gym', json_build_object(
      'name', COALESCE(v_gym.name, v_brand.custom_app_name, ''),
      'address', v_gym.address,
      'logo_ref', v_brand.logo_url,          -- bucket path; the sender signs it
      'primary_color', COALESCE(v_brand.primary_color, '#D4AF37'),
      'secondary_color', COALESCE(v_brand.secondary_color, '#0F172A')
    ),
    'values', json_build_object(
      'first_name',    COALESCE(NULLIF(split_part(v_p.full_name, ' ', 1), ''), ''),
      'member_name',   COALESCE(v_p.full_name, ''),
      'full_name',     COALESCE(v_p.full_name, ''),
      'gym_name',      COALESCE(v_gym.name, ''),
      'gym_address',   COALESCE(v_gym.address, ''),
      'streak_count',  v_streak::TEXT,
      'workout_count', v_workouts::TEXT,
      'days_inactive', CASE WHEN v_days_inactive IS NULL THEN NULL ELSE v_days_inactive::TEXT END,
      -- NULL on a rest day on purpose: the sentence disappears rather than
      -- telling someone to train when they planned not to.
      'today_plan_name', CASE WHEN v_is_rest THEN NULL ELSE v_plan_name END,
      'next_class_name', CASE WHEN v_class.schedule_id IS NULL THEN NULL
                              ELSE COALESCE(NULLIF(v_class.name_es, ''), v_class.name) END,
      'next_class_date', CASE WHEN v_class.schedule_id IS NULL THEN NULL
                              ELSE to_char(v_class.booking_date, 'YYYY-MM-DD') END,
      -- substr, not to_char: to_char has no `time` overload (see 0655:150).
      'next_class_time', CASE WHEN v_class.schedule_id IS NULL THEN NULL
                              ELSE substr(v_class.start_time::TEXT, 1, 5) END,
      'next_class_instructor', v_instructor,
      'next_class_schedule_id', v_class.schedule_id,
      'last_class_name', v_last_class
    ),
    'is_rest_day', v_is_rest
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.member_email_context(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_email_context(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.member_email_context(UUID) TO service_role;

-- ── 2. get_unsubscribe_context — mismo arreglo de idioma ──
--
-- Reconstruida desde 0685. Sigue sin devolver email ni ids: es anon-callable.

CREATE OR REPLACE FUNCTION public.get_unsubscribe_context(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_p   RECORD;
  v_gym RECORD;
BEGIN
  IF p_token IS NULL THEN RETURN json_build_object('found', false); END IF;

  SELECT id, gym_id, full_name, preferred_language, language,
         notif_email_enabled, notif_email_lifecycle, notif_email_classes, notif_email_winback
    INTO v_p
    FROM profiles WHERE email_unsub_token = p_token;

  IF v_p.id IS NULL THEN RETURN json_build_object('found', false); END IF;

  SELECT name, address INTO v_gym FROM gyms WHERE id = v_p.gym_id;

  RETURN json_build_object(
    'found', true,
    'first_name', COALESCE(NULLIF(split_part(v_p.full_name, ' ', 1), ''), ''),
    'gym_name', COALESCE(v_gym.name, ''),
    'gym_address', COALESCE(v_gym.address, ''),
    -- preferred_language, no language: ver 0538.
    'language', COALESCE(NULLIF(v_p.preferred_language, ''), NULLIF(v_p.language, ''), 'en'),
    'prefs', json_build_object(
      'all',       v_p.notif_email_enabled,
      'lifecycle', v_p.notif_email_lifecycle,
      'classes',   v_p.notif_email_classes,
      'winback',   v_p.notif_email_winback
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_unsubscribe_context(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_unsubscribe_context(UUID) TO anon;
GRANT  EXECUTE ON FUNCTION public.get_unsubscribe_context(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_unsubscribe_context(UUID) TO service_role;

-- ── 3. Separar el vocabulario de win-back del de lifecycle ──
--
-- day_7 / day_30 / day_60 existen en los dos flujos. Sin prefijo, una
-- plantilla de bienvenida sirve a quien canceló. El editor ya ofrece
-- `winback_day_7` etc. (EmailTemplateEditor.jsx:65-69) — hasta ahora ninguna
-- de esas plantillas podía dispararse porque el trigger emitía `day_7` pelado.

CREATE OR REPLACE FUNCTION public.fire_winback_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- El prefijo es lo único que separa un "te extrañamos" de un "bienvenido al
  -- equipo" cuando ambos flujos usan day_7.
  PERFORM public.fire_automated_email(
    NEW.profile_id, 'winback', 'winback_' || NEW.step_key);
  RETURN NEW;
END;
$$;

-- El trigger ya apunta a esta función (0687:128-131); CREATE OR REPLACE basta.

COMMENT ON COLUMN public.gym_email_templates.step_key IS
  'Which automated moment this template serves: a lifecycle step (day_1 … '
  'day_60), a win-back step (winback_day_7 / winback_day_30 / winback_day_60 — '
  'PREFIXED, because day_7/day_30/day_60 exist in both vocabularies and the '
  'lookup has no scope column), or the literal ''classes''. NULL = manual-only.';

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verificar:
--
--   -- 1. La función ya no revienta, y el idioma sale del miembro:
--   SELECT (member_email_context(id) -> 'language')
--     FROM profiles WHERE preferred_language = 'es' LIMIT 1;
--   -- esperado: "es"  (antes: 42703 column "timezone" does not exist)
--
--   -- 2. Ningún plan de hoy arrastra el prefijo:
--   SELECT p.id, member_email_context(p.id) -> 'values' ->> 'today_plan_name'
--     FROM profiles p WHERE p.role = 'member' LIMIT 20;
--   -- esperado: "Push", nunca "Auto: Push"
--
--   -- 3. Ninguna plantilla quedó con un step_key de win-back sin prefijar
--   --    (debería devolver 0 filas — auto_enabled nunca se pudo encender):
--   SELECT gym_id, name, step_key, auto_enabled
--     FROM gym_email_templates
--    WHERE step_key IN ('day_7','day_30','day_60') AND auto_enabled;
--   -- si sale alguna, decidir a mano si era lifecycle o win-back.
-- =============================================================
