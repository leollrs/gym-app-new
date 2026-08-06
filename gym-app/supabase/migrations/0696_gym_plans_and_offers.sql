-- ============================================================
-- 0696 — Precios y ofertas del gimnasio
-- ============================================================
-- La web que se le monta a cada gimnasio se construye a mano, pero se alimenta
-- de los datos que el gimnasio ya mantiene aquí. Los precios y las promociones
-- eran el hueco: no existían en la plataforma, así que iban escritos dentro de
-- cada web y se quedaban viejos sin que nadie lo notara.
--
-- DOS TABLAS, NO UNA. Un plan es permanente ("Mensualidad · $45/mes"); una
-- oferta CADUCA ("Primer mes $19, hasta el 31 de agosto"). Meterlas juntas
-- obliga a que la mitad de las columnas estén siempre vacías, y sobre todo hace
-- que la caducidad sea opcional cuando es justamente lo que distingue a una
-- oferta.
--
-- `gym_offers` YA EXISTÍA (0185) Y AQUÍ SE AMPLÍA, NO SE CREA.
--
-- La primera versión de esta migración la creaba con `CREATE TABLE IF NOT
-- EXISTS` y otros nombres de columna. Como la tabla ya estaba, el `IF NOT
-- EXISTS` no hizo nada —en silencio— y la migración reventó cien líneas más
-- abajo con «column o.headline does not exist». Ese es el peligro de
-- `IF NOT EXISTS` sobre una tabla que no comprobaste: no protege, esconde.
--
-- Y la tabla no es un resto: `MyGym.jsx` se la enseña a los miembros. Lo que
-- faltaba era el editor — las ofertas existían y nadie podía escribirlas. Así
-- que se conservan SUS nombres (`title`/`title_es`, `valid_from`/`valid_until`,
-- `offer_type`, `badge_label`) y se le añade lo que le faltaba para servir
-- también a la web.
--
-- UNA FILA = UN PRECIO. Así se lee una lista de precios en la pared de un
-- gimnasio: "Mensualidad $45", "Anual $450", "Pase del día $10". Si algún día la
-- web quiere un conmutador mensual/anual, agrupa por `period` — la tabla no
-- cambia.
--
-- CENTAVOS EN ENTEROS, no decimales: `4500`, no `45.00`. Un NUMERIC mal
-- redondeado en un precio se ve, y se ve mal.
--
-- LO QUE NO HACE ESTA MIGRACIÓN: cobrar. La plataforma no cobra por diseño —
-- esto es información que el gimnasio publica, no un catálogo de compra.
-- ============================================================

-- ── Planes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- NULL = "consultar precio". Es un caso real: el plan corporativo se cotiza,
  -- y forzar un número obligaría a inventárselo.
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  currency    TEXT NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  period      TEXT NOT NULL DEFAULT 'month'
              CHECK (period IN ('month', 'year', 'week', 'day', 'once')),
  description TEXT,
  -- Las viñetas del plan ("Acceso 24/7", "Dos clases al mes"). Array y no texto
  -- suelto para que la web las maquete como quiera en vez de recibir un párrafo.
  features    TEXT[] NOT NULL DEFAULT '{}',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  -- Publicar y estar activo son cosas DISTINTAS. Un plan puede estar vigente en
  -- recepción y no ir en la web: hay gimnasios que no publican precios a
  -- propósito, para forzar la llamada.
  is_public   BOOLEAN NOT NULL DEFAULT TRUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gym_plans_gym_idx ON public.gym_plans (gym_id, sort_order);

-- ── Ofertas: se AMPLÍA la tabla de 0185 ─────────────────────
--
-- Falla ruidosamente si no está. Una migración que asume una tabla y sigue
-- adelante cuando no existe es cómo se llega al error de columna de antes.
DO $check_offers$
BEGIN
  IF to_regclass('public.gym_offers') IS NULL THEN
    RAISE EXCEPTION '[0696] falta gym_offers: aplica 0185 antes que esta.';
  END IF;
END $check_offers$;

-- Precio de la oferta y el precio tachado. En centavos enteros, igual que los
-- planes: un NUMERIC mal redondeado en un precio se ve.
ALTER TABLE public.gym_offers ADD COLUMN IF NOT EXISTS price_cents      INTEGER;
ALTER TABLE public.gym_offers ADD COLUMN IF NOT EXISTS compare_at_cents INTEGER;
ALTER TABLE public.gym_offers ADD COLUMN IF NOT EXISTS currency         TEXT NOT NULL DEFAULT 'USD';
-- La letra pequeña, separada del cuerpo: la web la maqueta distinta, y
-- mezclarlas es como acaban las promos sin condiciones visibles.
ALTER TABLE public.gym_offers ADD COLUMN IF NOT EXISTS terms            TEXT;
ALTER TABLE public.gym_offers ADD COLUMN IF NOT EXISTS terms_es         TEXT;
ALTER TABLE public.gym_offers ADD COLUMN IF NOT EXISTS cta_kind         TEXT NOT NULL DEFAULT 'contact';
ALTER TABLE public.gym_offers ADD COLUMN IF NOT EXISTS cta_url          TEXT;
-- Publicar en la WEB es distinto de estar activa en la APP. Por defecto TRUE
-- para que las ofertas que ya existen no desaparezcan de golpe de ningún sitio.
ALTER TABLE public.gym_offers ADD COLUMN IF NOT EXISTS is_public        BOOLEAN NOT NULL DEFAULT TRUE;

-- Los CHECK van por separado y con guarda: `ADD CONSTRAINT` no admite
-- `IF NOT EXISTS`, y sin esto reaplicar la migración falla.
DO $offer_checks$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_offers_price_nonneg') THEN
    ALTER TABLE public.gym_offers ADD CONSTRAINT gym_offers_price_nonneg
      CHECK (price_cents IS NULL OR price_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_offers_compare_nonneg') THEN
    ALTER TABLE public.gym_offers ADD CONSTRAINT gym_offers_compare_nonneg
      CHECK (compare_at_cents IS NULL OR compare_at_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_offers_cta_kind_valid') THEN
    ALTER TABLE public.gym_offers ADD CONSTRAINT gym_offers_cta_kind_valid
      CHECK (cta_kind IN ('contact', 'trial', 'link'));
  END IF;
  -- Una ventana al revés no es una errata, es una oferta que no se muestra
  -- nunca y que nadie entiende por qué. NOT VALID: no se revisan las filas que
  -- ya están —podría haber alguna torcida— pero desde hoy no entra ninguna más.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_offers_window') THEN
    ALTER TABLE public.gym_offers ADD CONSTRAINT gym_offers_window
      CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from) NOT VALID;
  END IF;
END $offer_checks$;

-- ── updated_at ──────────────────────────────────────────────
-- Una función POR TABLA, que es la convención del repo
-- (`wellness_checkins_set_updated_at` 0384, `trainer_invoices_set_updated_at`
-- 0639). Una compartida y genérica se ve más limpia y es peor: el día que
-- alguien la reemplace para su tabla, se lleva por delante todas las demás.
--
-- `SET search_path = public` porque 0620 endureció eso en todas las funciones.
CREATE OR REPLACE FUNCTION public.gym_plans_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.gym_offers_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS gym_plans_touch  ON public.gym_plans;
CREATE TRIGGER gym_plans_touch  BEFORE UPDATE ON public.gym_plans
  FOR EACH ROW EXECUTE FUNCTION public.gym_plans_set_updated_at();
-- 0185 creó la tabla con `updated_at` y sin trigger que lo toque. Se añade aquí.
DROP TRIGGER IF EXISTS gym_offers_touch ON public.gym_offers;
CREATE TRIGGER gym_offers_touch BEFORE UPDATE ON public.gym_offers
  FOR EACH ROW EXECUTE FUNCTION public.gym_offers_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.gym_plans ENABLE ROW LEVEL SECURITY;

-- Un bloque DO por tabla y con `lock_timeout`: el DDL de políticas toma ACCESS
-- EXCLUSIVE, y en una app viva eso se queda esperando detrás de cualquier
-- lectura larga.
DO $pol_plans$
BEGIN
  SET LOCAL lock_timeout = '5s';

  -- Lectura: cualquiera del gimnasio ve la lista completa. Un miembro que
  -- pregunta "¿cuánto cuesta el anual?" es el caso normal.
  DROP POLICY IF EXISTS gym_plans_read ON public.gym_plans;
  CREATE POLICY gym_plans_read ON public.gym_plans
    FOR SELECT TO authenticated
    USING (gym_id = (SELECT gym_id FROM public.profiles WHERE id = auth.uid()));

  -- Escritura: solo admin, y `WITH CHECK` además de `USING`.
  --
  -- Sin `WITH CHECK` un admin podría MOVER una fila a otro gimnasio con un
  -- UPDATE: `USING` decide qué filas ve, no en qué se pueden convertir.
  DROP POLICY IF EXISTS gym_plans_admin_write ON public.gym_plans;
  CREATE POLICY gym_plans_admin_write ON public.gym_plans
    FOR ALL TO authenticated
    USING (
      gym_id = (SELECT gym_id FROM public.profiles WHERE id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
           AND (p.role IN ('admin','super_admin')
                OR p.additional_roles && ARRAY['admin','super_admin']::user_role[])
      )
    )
    WITH CHECK (
      gym_id = (SELECT gym_id FROM public.profiles WHERE id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
           AND (p.role IN ('admin','super_admin')
                OR p.additional_roles && ARRAY['admin','super_admin']::user_role[])
      )
    );
END $pol_plans$;

-- `gym_offers` NO lleva políticas nuevas: 0185:42-60 ya define admin (FOR ALL
-- con `is_admin()`, que es multi-rol desde 0465) y la lectura de los miembros.
-- Reescribirlas desde aquí sería rehacer una regla que no escribí yo, y ahí es
-- donde se pierden correcciones anteriores sin enterarse.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_plans TO authenticated;

-- ── Lo que la web puede leer ────────────────────────────────
--
-- DOS VISTAS APARTE, y no un GRANT a `anon` sobre las tablas. La diferencia
-- importa: aquí la lista de columnas está escrita a mano, así que una columna
-- nueva que se añada mañana NO se publica sola. Ese descuido —`select *` sobre
-- una tabla que crece— es como se filtran cosas que nadie decidió filtrar.
--
-- Y el filtro de vigencia va AQUÍ, en el servidor. Si lo hiciera la web, la
-- promo de agosto seguiría puesta en diciembre: exactamente la pudrición que
-- estas tablas vienen a evitar.
CREATE OR REPLACE VIEW public.gym_plans_public
WITH (security_invoker = false) AS
SELECT p.gym_id, p.id, p.name, p.price_cents, p.currency, p.period,
       p.description, p.features, p.is_featured, p.sort_order
  FROM public.gym_plans p
  JOIN public.gyms g ON g.id = p.gym_id AND g.is_active
 WHERE p.is_active AND p.is_public
 ORDER BY p.sort_order, p.name;

CREATE OR REPLACE VIEW public.gym_offers_public
WITH (security_invoker = false) AS
SELECT o.gym_id, o.id, o.title, o.title_es, o.description, o.description_es,
       o.terms, o.terms_es, o.offer_type, o.badge_label,
       o.price_cents, o.compare_at_cents, o.currency,
       o.valid_from, o.valid_until, o.cta_kind, o.cta_url, o.sort_order
  FROM public.gym_offers o
  JOIN public.gyms g ON g.id = o.gym_id AND g.is_active
 WHERE o.is_active AND o.is_public
   AND (o.valid_from  IS NULL OR o.valid_from  <= CURRENT_DATE)
   AND (o.valid_until IS NULL OR o.valid_until >= CURRENT_DATE)
 ORDER BY o.sort_order, o.valid_until NULLS LAST;

-- `security_invoker = false` a propósito, al revés que en el resto del repo:
-- estas vistas EXISTEN para saltarse la RLS de las tablas de abajo, que solo
-- deja leer a quien pertenece al gimnasio. La reja no es la RLS: es la lista de
-- columnas escrita a mano más los filtros de vigencia.
-- TODAVÍA NO SE CONCEDE A `anon`.
--
-- Estas vistas son la forma que consumirá `get_gym_site(slug)` cuando exista, y
-- ahí es donde va el guardia de enumeración —el mismo patrón de
-- `share_preview_misses` (0653)—. Abrirlas a `anon` ahora dejaría a cualquiera
-- volcar los precios de TODOS los gimnasios de la plataforma con una consulta
-- sin filtro, y sin ningún consumidor que lo justifique todavía.
--
-- Mientras tanto sirven para que la pantalla de ajustes enseñe "así lo ve la
-- web" leyendo exactamente lo que la web va a leer, en vez de una aproximación.
GRANT SELECT ON public.gym_plans_public  TO authenticated;
GRANT SELECT ON public.gym_offers_public TO authenticated;

COMMENT ON VIEW public.gym_plans_public IS
  'Planes publicables de un gimnasio activo. Columnas escritas a mano: añadir una a gym_plans NO la publica.';
COMMENT ON VIEW public.gym_offers_public IS
  'Ofertas publicables y VIGENTES HOY. La caducidad se filtra aquí, no en la web.';
