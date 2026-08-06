-- ============================================================
-- 0702 — La firma del gimnasio, guardada como TRAZOS
-- ============================================================
-- POR QUÉ TRAZOS Y NO UNA IMAGEN
--
-- Una firma escaneada en PNG sirve para una sola cosa: imprimirla. Los mismos
-- datos guardados como trazos sirven para dos:
--
--   • IMPRIMIR — SVG en línea, sin pixelar a ningún tamaño. Y como va dentro
--     del propio documento, no hay una imagen que cargar: una vista de
--     impresión que dispara el diálogo antes de que llegue el PNG sale con el
--     hueco en blanco, y eso no se ve hasta que ya está en papel.
--
--   • DIBUJAR CON LA CRICUT — la máquina traza con un bolígrafo de verdad, y
--     para eso necesita CAMINOS, no píxeles. Un PNG habría que vectorizarlo
--     antes, y un autotrazado de una firma sale con el contorno relleno en vez
--     de la línea del trazo: la máquina dibujaría el BORDE de cada letra, en
--     hueco.
--
-- Y hay un motivo de producto: `CardPrimitives.jsx:107` deja la línea de firma
-- en blanco A PROPÓSITO, porque una firma impresa mata la señal de trato
-- personal para la que la tarjeta existe. La Cricut resuelve esa tensión — es
-- tinta de verdad sobre el papel, solo que no la mueve tu mano. Por eso
-- `print_signature` nace en FALSE: el camino por defecto sigue siendo dibujarla,
-- e imprimirla es una decisión consciente.
--
-- UN TRAZO POR ELEMENTO, y no un camino gigante concatenado: cada trazo es un
-- bajar y subir el bolígrafo. Aplastarlos en uno solo haría que la Cricut
-- arrastrara la punta entre letras.
-- ============================================================

-- ── La reja del contenido ───────────────────────────────────
--
-- Esta cadena acaba dentro de un atributo `d` de un <path>. React escapa los
-- atributos, así que hoy no hay inyección posible — pero «hoy» es la palabra
-- peligrosa: basta que alguien pinte esto con dangerouslySetInnerHTML o lo
-- meta en un SVG generado en el servidor para que deje de ser cierto. La reja
-- va en la BASE, donde no depende de cómo se pinte.
--
-- Solo se admite gramática de camino SVG: comandos, dígitos, punto, coma,
-- signo y espacio. Ni letras sueltas, ni `<`, ni comillas.
CREATE OR REPLACE FUNCTION public.signature_strokes_ok(p JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p IS NULL OR (
    jsonb_typeof(p) = 'array'
    -- 200 trazos es una firma muy elaborada; más es un dibujo o un error.
    AND jsonb_array_length(p) <= 200
    AND NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(p) AS e
       WHERE e !~ '^[MmLlCcQqZzHhVvSsTt0-9eE.,+\- ]+$'
          OR length(e) > 8000
          OR length(btrim(e)) = 0
    )
  );
$$;

COMMENT ON FUNCTION public.signature_strokes_ok(JSONB) IS
  'Valida que cada trazo sea gramática de camino SVG y nada más. La reja vive '
  'aquí y no en el componente porque un día alguien pintará esto de otra forma.';

-- ── Las columnas ────────────────────────────────────────────
ALTER TABLE public.gym_card_settings
  -- Array de cadenas `d`. Uno por trazo = un bajar/subir de bolígrafo.
  ADD COLUMN IF NOT EXISTS signature_strokes  JSONB,
  -- El lienzo en el que se dibujó, para conservar la proporción al pintarla a
  -- cualquier tamaño. Sin esto la firma se estira.
  ADD COLUMN IF NOT EXISTS signature_width    INTEGER,
  ADD COLUMN IF NOT EXISTS signature_height   INTEGER,
  -- Lo que va DEBAJO de la línea: «Leo Llorens · Dueño». Es texto, no trazo.
  ADD COLUMN IF NOT EXISTS signature_label    TEXT,
  -- Imprimirla en la tarjeta. FALSE a propósito — ver la cabecera.
  ADD COLUMN IF NOT EXISTS print_signature    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS signature_updated_at TIMESTAMPTZ;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'gym_card_settings_signature_strokes_ck'
       AND conrelid = 'public.gym_card_settings'::regclass
  ) THEN
    ALTER TABLE public.gym_card_settings
      ADD CONSTRAINT gym_card_settings_signature_strokes_ck
      CHECK (public.signature_strokes_ok(signature_strokes));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'gym_card_settings_signature_label_ck'
       AND conrelid = 'public.gym_card_settings'::regclass
  ) THEN
    ALTER TABLE public.gym_card_settings
      ADD CONSTRAINT gym_card_settings_signature_label_ck
      CHECK (signature_label IS NULL OR length(signature_label) <= 80);
  END IF;

  -- El lienzo tiene que ser un tamaño real, o la proporción sale absurda.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'gym_card_settings_signature_box_ck'
       AND conrelid = 'public.gym_card_settings'::regclass
  ) THEN
    ALTER TABLE public.gym_card_settings
      ADD CONSTRAINT gym_card_settings_signature_box_ck
      CHECK (
        (signature_width IS NULL AND signature_height IS NULL)
        OR (signature_width BETWEEN 40 AND 4000 AND signature_height BETWEEN 20 AND 4000)
      );
  END IF;
END $constraints$;

COMMENT ON COLUMN public.gym_card_settings.signature_strokes IS
  'Trazos SVG de la firma, uno por elemento. Sirven para imprimir Y para que la '
  'Cricut los dibuje con bolígrafo — por eso NO es un PNG. Aplastarlos en un '
  'solo camino haría que la máquina arrastrase la punta entre letras.';

COMMENT ON COLUMN public.gym_card_settings.print_signature IS
  'Imprimir la firma en la tarjeta. FALSE por defecto: la línea en blanco existe '
  'a propósito (CardPrimitives.jsx) y el camino preferido es dibujarla — a mano '
  'o con la Cricut, que es tinta real igualmente.';

-- La RLS ya existe: gym_card_settings_admin_all (0415) cubre FOR ALL contra
-- admin/super_admin del propio gimnasio. No hace falta política nueva, y la
-- firma NO debe ser legible por nadie más — es la rúbrica del dueño.

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verificar:
--
--   -- 1. Un trazo legítimo entra:
--   UPDATE gym_card_settings
--      SET signature_strokes = '["M10 40 C20 10, 40 10, 50 40"]'::jsonb,
--          signature_width = 400, signature_height = 140
--    WHERE gym_id = '<gym>';
--
--   -- 2. Cualquier cosa que no sea gramática de camino REBOTA:
--   UPDATE gym_card_settings SET signature_strokes = '["<script>alert(1)</script>"]'::jsonb
--    WHERE gym_id = '<gym>';   -- → viola gym_card_settings_signature_strokes_ck
--
--   -- 3. Y un lienzo imposible también:
--   UPDATE gym_card_settings SET signature_width = 5, signature_height = 5
--    WHERE gym_id = '<gym>';   -- → viola gym_card_settings_signature_box_ck
-- ============================================================
