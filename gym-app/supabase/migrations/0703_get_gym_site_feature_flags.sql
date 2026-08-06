-- ============================================================
-- 0703 — Qué OFRECE un gimnasio, separado de qué TIENE CARGADO
-- ============================================================
-- EL PROBLEMA
--
-- La 0698 devuelve el mismo valor para dos situaciones opuestas:
--
--   'classes', CASE WHEN NOT COALESCE(v_gym.classes_enabled, FALSE)
--                THEN '[]'::JSON
--                ELSE COALESCE((SELECT ...), '[]'::JSON) END
--
-- Las dos ramas producen `[]`. Una web que consume esto NO PUEDE SABER si el
-- gimnasio no da clases —y entonces la sección, el menú y el horario semanal
-- sobran— o si sí las da pero aún no las ha cargado, y entonces hay que dejar
-- lo que el diseñador escribió a mano.
--
-- Es el mismo defecto que tenía el panel de Actividad: un cero que significaba
-- «no salió nada» y «no puedo leerlo» a la vez. Un valor con dos significados no
-- es un dato; quien lo consume acaba adivinando.
--
-- LA TRAMPA SIMÉTRICA, QUE ES LA QUE CASI SE COME ESTA MIGRACIÓN
--
-- La reacción natural es «pues escondo la sección cuando no haya filas». Eso
-- BORRA CONTENIDO CIERTO. Un gimnasio puede tener un smoothie bar de verdad en
-- el local y cero productos cargados en la app: la tienda de la app y la tienda
-- física no son la misma cosa. Esconder la sección por «no hay filas» le quita
-- de la web algo que existe.
--
-- Así que hay DOS señales distintas y esta migración se niega a mezclarlas:
--
--   offered — lo que el gimnasio DECLARÓ. Solo existe donde hay un interruptor
--             de verdad. Hoy únicamente `classes` (gyms.classes_enabled). En el
--             resto vale NULL, que significa «no lo sabemos» — y NULL no es
--             false. Fingir un false donde no hay interruptor es exactamente el
--             error que esta migración viene a arreglar, cometido otra vez.
--
--   any     — si hay algo PUBLICADO ahora mismo. Sirve para decidir si pintar
--             un bloque con datos vivos, NO para borrar lo escrito a mano.
--
-- LA REGLA PARA QUIEN CONSUME ESTO:
--
--   offered === false            → esconder. El dueño lo dijo.
--   offered === null && !any     → NO esconder nada escrito a mano; solo saltar
--                                  los bloques que necesitan datos vivos.
--   any === true                 → hay algo de la app que pintar.
--
-- SON BOOLEANOS, NO CUENTAS, y a propósito. La web solo necesita saber «¿hay
-- algo?». Un número invita a poner «23 clases» o «12 entrenadores» en la
-- página, y eso ya es información del negocio — la misma línea que la 0698
-- trazó al publicar el aforo de una clase pero no cuánta gente va.
--
-- SOBRE `trainers`: es un booleano, nunca nombres ni fotos. La 0698 excluye a
-- los entrenadores porque `trainer_photo_visible` (0553) es consentimiento para
-- que su foto la vea EL GIMNASIO, no internet. Saber que existe al menos uno no
-- identifica a nadie y deja a la web decidir si enseña su sección de
-- entrenamiento personal. Publicar quiénes son sigue necesitando su permiso.
--
-- QUÉ SIGUE SIN SALIR: `multi_admin_enabled` y `max_admin_seats` son condiciones
-- NUESTRAS con el gimnasio — de la lista que cerró la 0697. `qr_enabled`,
-- `digest_enabled` y `health_sync_enabled` son mecánicas internas que a un
-- visitante no le dicen nada. La reja sigue siendo esta lista escrita a mano.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_gym_site(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym     RECORD;
  v_brand   RECORD;
  v_local   TIMESTAMP;
  v_today   DATE;
  v_dow     INTEGER;
  v_time    TIME;
  v_hours   RECORD;
  v_closure RECORD;
  v_open    BOOLEAN := FALSE;
BEGIN
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RETURN json_build_object('found', false);
  END IF;

  SELECT id, name, slug, address, website_url, timezone, classes_enabled
    INTO v_gym
    FROM public.gyms
   WHERE lower(slug) = lower(btrim(p_slug))
     AND is_active
   LIMIT 1;

  -- Un gimnasio que no existe y uno inactivo dan la MISMA respuesta: no hay
  -- nada que ganar diciéndole a un desconocido cuál de las dos cosas es.
  IF v_gym.id IS NULL THEN
    RETURN json_build_object('found', false);
  END IF;

  SELECT logo_url, primary_color, secondary_color, custom_app_name
    INTO v_brand
    FROM public.gym_branding
   WHERE gym_id = v_gym.id;

  -- ── La hora, EN LA ZONA DEL GIMNASIO ──
  --
  -- `NOW()` en el servidor es UTC. Un gimnasio en Puerto Rico (UTC-4) que cierra
  -- a las 22:00 aparecería cerrado desde las 18:00 hora local — y "Cerrado"
  -- cuando estás abierto es peor que no decir nada.
  v_local := NOW() AT TIME ZONE COALESCE(NULLIF(v_gym.timezone, ''), 'UTC');
  v_today := v_local::DATE;
  -- 0 = domingo, que es como guarda `gym_hours` y como cuenta la app entera.
  v_dow   := EXTRACT(DOW FROM v_local)::INTEGER;
  v_time  := v_local::TIME;

  SELECT closure_date, name, reason INTO v_closure
    FROM public.gym_closures
   WHERE gym_id = v_gym.id AND closure_date = v_today
   LIMIT 1;

  SELECT open_time, close_time, is_closed INTO v_hours
    FROM public.gym_hours
   WHERE gym_id = v_gym.id AND day_of_week = v_dow
   LIMIT 1;

  IF v_closure.closure_date IS NULL AND v_hours.open_time IS NOT NULL AND NOT v_hours.is_closed THEN
    -- El cierre después de medianoche no es un caso raro: un gimnasio que abre
    -- a las 05:00 y cierra a la 01:00 tiene `close < open`, y comparar entre
    -- los dos sin más lo daría cerrado las veinticuatro horas.
    IF v_hours.close_time::TIME <= v_hours.open_time::TIME THEN
      v_open := v_time >= v_hours.open_time::TIME OR v_time < v_hours.close_time::TIME;
    ELSE
      v_open := v_time >= v_hours.open_time::TIME AND v_time < v_hours.close_time::TIME;
    END IF;
  END IF;

  RETURN json_build_object(
    'found', true,
    'gym', json_build_object(
      'name',        COALESCE(NULLIF(v_gym.name, ''), v_brand.custom_app_name, ''),
      'slug',        v_gym.slug,
      'address',     v_gym.address,
      'website_url', v_gym.website_url,
      'timezone',    v_gym.timezone
    ),
    -- ── LO NUEVO DE LA 0703 ──
    -- Ver la cabecera para la regla completa. En corto: `offered` es lo que el
    -- dueño declaró (NULL = no hay interruptor, o sea «no lo sabemos»), y `any`
    -- es si hay algo cargado. Nunca se deduce lo primero de lo segundo.
    'modules', json_build_object(
      'classes', json_build_object(
        'offered', COALESCE(v_gym.classes_enabled, FALSE),
        'any', EXISTS (
          SELECT 1 FROM public.gym_classes c
           WHERE c.gym_id = v_gym.id AND COALESCE(c.is_active, TRUE)
        )
      ),
      'store', json_build_object(
        'offered', NULL,
        'any', EXISTS (
          SELECT 1 FROM public.gym_products p
           WHERE p.gym_id = v_gym.id AND COALESCE(p.is_active, TRUE)
        )
      ),
      'rewards', json_build_object(
        'offered', NULL,
        'any', EXISTS (
          SELECT 1 FROM public.gym_rewards r
           WHERE r.gym_id = v_gym.id AND COALESCE(r.is_active, TRUE)
        )
      ),
      'challenges', json_build_object(
        'offered', NULL,
        -- `status = 'active'` Y sin terminar. Un reto en borrador no existe para
        -- nadie, y uno acabado en la web es peor que ninguno: dice que el
        -- gimnasio dejó de hacerlos.
        'any', EXISTS (
          SELECT 1 FROM public.challenges ch
           WHERE ch.gym_id = v_gym.id
             AND ch.status = 'active'::challenge_status
             AND ch.end_date >= NOW()
        )
      ),
      'trainers', json_build_object(
        'offered', NULL,
        -- Booleano y nada más. `additional_roles` cuenta igual que `role`: desde
        -- el refactor multi-rol un entrenador puede llevarlo ahí, y mirar solo
        -- `role` daría "no hay entrenadores" en un gimnasio que sí los tiene.
        'any', EXISTS (
          SELECT 1 FROM public.profiles p
           WHERE p.gym_id = v_gym.id
             AND (p.role = 'trainer'::user_role
                  OR 'trainer'::user_role = ANY(p.additional_roles))
        )
      )
    ),
    'brand', json_build_object(
      'logo_url',        v_brand.logo_url,
      'primary_color',   COALESCE(v_brand.primary_color, '#D4AF37'),
      'secondary_color', COALESCE(v_brand.secondary_color, '#0F172A')
    ),
    -- Lo que hace que la web se vea al día.
    'status', json_build_object(
      'today',         to_char(v_today, 'YYYY-MM-DD'),
      'day_of_week',   v_dow,
      'local_time',    to_char(v_local, 'HH24:MI'),
      'open_now',      v_open,
      'opens_at',      CASE WHEN v_hours.is_closed THEN NULL ELSE v_hours.open_time END,
      'closes_at',     CASE WHEN v_hours.is_closed THEN NULL ELSE v_hours.close_time END,
      -- El motivo del cierre de HOY. Sin esto, un feriado se ve como un horario
      -- normal y la gente se planta en la puerta.
      'closed_today',  (v_closure.closure_date IS NOT NULL OR COALESCE(v_hours.is_closed, FALSE)),
      'closed_reason', COALESCE(NULLIF(v_closure.name, ''), NULLIF(v_closure.reason, ''))
    ),
    'hours', COALESCE((
      SELECT json_agg(json_build_object(
               'day_of_week', h.day_of_week,
               'open_time',   h.open_time,
               'close_time',  h.close_time,
               'is_closed',   h.is_closed
             ) ORDER BY h.day_of_week)
        FROM public.gym_hours h WHERE h.gym_id = v_gym.id
    ), '[]'::JSON),
    -- Solo lo que viene: los cierres pasados no le sirven a nadie y alargan la
    -- respuesta.
    'closures', COALESCE((
      SELECT json_agg(json_build_object(
               'date',   to_char(c.closure_date, 'YYYY-MM-DD'),
               'name',   c.name,
               'reason', c.reason
             ) ORDER BY c.closure_date)
        FROM public.gym_closures c
       WHERE c.gym_id = v_gym.id
         AND c.closure_date BETWEEN v_today AND v_today + 90
    ), '[]'::JSON),
    -- `classes_enabled` manda: un gimnasio que no usa clases en la app no debe
    -- enseñar un calendario vacío. Y ahora `modules.classes.offered` dice POR QUÉ
    -- está vacío, que era lo indecidible hasta esta migración.
    'classes', CASE WHEN NOT COALESCE(v_gym.classes_enabled, FALSE) THEN '[]'::JSON ELSE COALESCE((
      SELECT json_agg(cls ORDER BY cls->>'name')
        FROM (
          SELECT json_build_object(
                   'name',        COALESCE(NULLIF(c.name_es, ''), c.name),
                   'name_en',     c.name,
                   'description', COALESCE(NULLIF(c.description_es, ''), c.description),
                   'image_url',   c.image_url,
                   'duration_minutes', c.duration_minutes,
                   -- El AFORO TOTAL sí; cuántos van hoy, NO. Ver la cabecera.
                   'capacity',    c.max_capacity,
                   'schedule',    COALESCE((
                     SELECT json_agg(json_build_object(
                              'day_of_week', s.day_of_week,
                              'start_time',  to_char(s.start_time, 'HH24:MI'),
                              'end_time',    to_char(s.end_time, 'HH24:MI')
                            ) ORDER BY s.day_of_week, s.start_time)
                       FROM public.gym_class_schedules s
                      WHERE s.class_id = c.id AND COALESCE(s.is_active, TRUE)
                   ), '[]'::JSON)
                 ) AS cls
            FROM public.gym_classes c
           WHERE c.gym_id = v_gym.id AND COALESCE(c.is_active, TRUE)
        ) q
    ), '[]'::JSON) END,
    -- Planes y ofertas salen por las vistas de 0696, que ya llevan dentro el
    -- «solo lo publicable» y —en las ofertas— el filtro de vigencia. Repetir
    -- aquí esas condiciones sería tener la regla escrita dos veces.
    'plans', COALESCE((
      SELECT json_agg(json_build_object(
               'name', p.name, 'price_cents', p.price_cents, 'currency', p.currency,
               'period', p.period, 'description', p.description, 'features', p.features,
               'is_featured', p.is_featured
             ) ORDER BY p.sort_order, p.name)
        FROM public.gym_plans_public p WHERE p.gym_id = v_gym.id
    ), '[]'::JSON),
    -- Bilingüe porque la tabla lo es desde 0185 y los miembros ya lo ven así en
    -- MyGym. La web escoge; el endpoint no decide por ella.
    'offers', COALESCE((
      SELECT json_agg(json_build_object(
               'title',       COALESCE(NULLIF(o.title_es, ''), o.title),
               'title_en',    o.title,
               'description', COALESCE(NULLIF(o.description_es, ''), o.description),
               'terms',       COALESCE(NULLIF(o.terms_es, ''), o.terms),
               'offer_type',  o.offer_type,
               'badge',       o.badge_label,
               'price_cents', o.price_cents, 'compare_at_cents', o.compare_at_cents,
               'currency',    o.currency,
               'valid_until', to_char(o.valid_until, 'YYYY-MM-DD'),
               'cta_kind',    o.cta_kind, 'cta_url', o.cta_url
             ) ORDER BY o.sort_order)
        FROM public.gym_offers_public o WHERE o.gym_id = v_gym.id
    ), '[]'::JSON)
  );
END;
$$;

-- Un `CREATE OR REPLACE` conserva los GRANT, pero repetirlos cuesta nada y evita
-- que un despliegue en limpio deje la web con un error de permisos — que se
-- vería como «gimnasio vacío» en vez de como un fallo. Ya nos pasó con el
-- enlace de baja.
REVOKE ALL ON FUNCTION public.get_gym_site(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_site(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.get_gym_site(TEXT) IS
  'Todo lo que la web pública de un gimnasio puede leer, en una llamada. '
  '`modules.X.offered` es lo que el gimnasio DECLARÓ (NULL = no hay interruptor, '
  'o sea desconocido — NULL NO es false); `modules.X.any` es si hay algo '
  'cargado. Nunca deducir lo primero de lo segundo: un gimnasio con smoothie bar '
  'y cero productos en la app sigue teniendo smoothie bar. Sin entrenadores '
  'nominales hasta que exista un consentimiento explícito para salir publicado.';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verificar:
--
--   SELECT jsonb_pretty((get_gym_site('demo') -> 'modules')::jsonb);
--   -- classes.offered = true|false; el resto offered = null
--
--   -- Apagar clases y ver que ahora SÍ se distingue:
--   UPDATE gyms SET classes_enabled = FALSE WHERE slug = 'demo';
--   SELECT get_gym_site('demo') -> 'modules' -> 'classes';
--   -- → {"offered": false, "any": true}  ← "las tiene cargadas pero las apagó"
--
--   -- Y que NULL sigue siendo NULL, no false:
--   SELECT (get_gym_site('demo') -> 'modules' -> 'store' -> 'offered') = 'null'::jsonb;
--   -- → true
-- ============================================================
