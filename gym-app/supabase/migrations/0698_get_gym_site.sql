-- ============================================================
-- 0698 — get_gym_site(slug): lo que la web del gimnasio puede leer
-- ============================================================
-- La web de cada gimnasio se construye a mano, pero su contenido vive aquí y lo
-- mantiene gente que lo actualiza porque lo necesita para otra cosa. Esta RPC es
-- el contrato entre las dos: UNA llamada, y la web se pinta con lo que hoy es
-- verdad.
--
-- LO QUE HACE QUE UNA WEB SE VEA SERIA ES QUE ESTÉ AL DÍA. Un horario escrito a
-- mano dentro de la web se queda viejo y nadie se entera hasta que alguien se
-- planta en la puerta cerrada. Por eso lo caro de aquí no son los datos, es
-- `status`: si está abierto AHORA, a qué hora cierra, y si hoy está cerrado por
-- feriado. Eso no se puede escribir a mano.
--
-- LA REJA ES ESTA LISTA DE CAMPOS. Está escrita a una por una, a propósito: una
-- columna que se añada mañana a `gyms` o a `gym_classes` NO se publica sola.
-- Ese descuido —`select *` sobre una tabla que crece— es como se filtra lo que
-- nadie decidió filtrar. La 0697 acaba de cerrar exactamente eso.
--
-- LO QUE NO SALE, Y POR QUÉ:
--
--   • Nada por miembro. Ni nombres, ni correos, ni reservas.
--   • Cuántos van a una clase. Parece inofensivo y no lo es: publicado a diario
--     dice qué horas están muertas, y eso es información del negocio.
--   • Los ENTRENADORES. Sería lo más vistoso de una web —caras y nombres— y no
--     va. `profiles.trainer_photo_visible` (0553) es consentimiento para que su
--     foto la vea EL GIMNASIO; nadie ha consentido salir en una web pública. El
--     día que exista ese interruptor se añaden aquí, y no antes.
--   • Nada de `gyms` que no esté en la lista: `monthly_price` y `plan_type` son
--     nuestras condiciones con el gimnasio (ver 0697).
--
-- SOBRE ENUMERAR GIMNASIOS: no lleva guardia, y es deliberado. El slug no es un
-- secreto —`gyms_public` expone `id, name, slug` a `anon` desde 0110 para que
-- funcione el registro— así que un contador de fallos aquí defendería algo que
-- ya está abierto por diseño, cobrando una escritura por cada visita fallida.
-- El freno por volumen va donde corresponde: en el CDN.
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
    -- enseñar un calendario vacío en su web.
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

-- ── Quién puede llamarla ────────────────────────────────────
--
-- EL `GRANT` A `anon` NO ES OPCIONAL NI REDUNDANTE. La 0486 revocó `EXECUTE` a
-- `anon` sobre toda función pública salvo una lista blanca, así que sin esta
-- línea la web recibe un error de permisos — y como el sitio caería a "no hay
-- datos", parecería que el gimnasio está vacío en vez de que falta un GRANT.
-- Ya nos pasó con el enlace de baja.
REVOKE ALL ON FUNCTION public.get_gym_site(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_site(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.get_gym_site(TEXT) IS
  'Todo lo que la web pública de un gimnasio puede leer, en una llamada. La lista '
  'de campos es la reja: añadir una columna a gyms/gym_classes NO la publica. Sin '
  'entrenadores hasta que exista un consentimiento explícito para salir publicado.';
