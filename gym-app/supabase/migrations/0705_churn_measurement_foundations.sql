-- =============================================================
-- 0705 — Cimientos para poder MEDIR el modelo de churn
-- =============================================================
--
-- POR QUÉ ESTO VA ANTES QUE EL MODELO NUEVO
--
-- El modelo v3 no se puede evaluar, y la razón es que se etiqueta a sí mismo.
-- `compute-churn-scores` decide quién «se fue» así:
--
--     daysSinceActivity >= 30  ->  churned = true
--     daysSinceActivity >= 60  ->  churned = true
--     membership_status = 'frozen' -> churned = true
--     tenure >= 6m AND daysSinceActivity < 14 -> churned = false
--
-- Cuatro de las cinco reglas derivan la «verdad» de la MISMA variable que el
-- modelo usa de entrada. Entrenar con eso le enseña al modelo a predecirse a sí
-- mismo: sale con una precisión preciosa y cero información, y refuerza justo el
-- sesgo de recencia que el rediseño quiere quitarle. (La quinta, `frozen`, es
-- directamente falsa: el propio scorer trata `frozen` como `paused` — una pausa
-- de vacaciones, explícitamente NO una baja.)
--
-- Y no se arregla pidiéndole la verdad al gimnasio. La tesis del producto es que
-- el dueño NO conoce sus números; montar la calibración sobre una lista que él
-- tiene que rellenar se contradice sola. Lo que dé es un extra, nunca un
-- requisito.
--
-- Así que esta migración monta tres cosas, todas observables sin cooperación:
--
--   1. Un objetivo NO circular: «¿vino este socio entre el día 31 y el 90?»,
--      evaluado SOLO sobre socios que estaban vivos el día de la puntuación.
--   2. Trazabilidad del ORIGEN de cada etiqueta, para que el día que entre
--      billing o una llamada del founder caiga por el mismo sitio.
--   3. Un grupo de control (holdout) en el seguimiento automático, que es lo
--      único de todo esto que NO se puede reconstruir hacia atrás.
--
-- El etiquetador vive en SQL + pg_cron a propósito, no en la edge function:
-- así empieza a trabajar en cuanto se aplica esta migración, sin esperar a
-- ningún despliegue.
--
-- =============================================================

-- ── 1. churn_outcomes: de dónde salió cada etiqueta ──────────
--
-- `reason` se queda como la nota legible; lo que la máquina lee es `source`.
-- Las filas viejas se marcan `legacy_circular` para que nadie entrene con ellas
-- por accidente — borrarlas sería tirar historia, y filtrarlas cuesta lo mismo.

ALTER TABLE public.churn_outcomes
  ADD COLUMN IF NOT EXISTS source       TEXT,
  ADD COLUMN IF NOT EXISTS scored_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS observed_at  DATE,
  ADD COLUMN IF NOT EXISTS horizon_days SMALLINT;

COMMENT ON COLUMN public.churn_outcomes.source IS
  'Cómo se supo: observed_lapse (nuestros propios check-ins) · founder_call · gym_report · billing · legacy_circular (basura pre-0705, NO entrenar)';
COMMENT ON COLUMN public.churn_outcomes.scored_at IS
  'Cuándo se calculó la puntuación que esta etiqueta juzga. Es el JOIN con churn_risk_scores.';
COMMENT ON COLUMN public.churn_outcomes.observed_at IS
  'Cuándo se pudo observar el desenlace (no cuándo se escribió la fila).';

UPDATE public.churn_outcomes SET source = 'legacy_circular' WHERE source IS NULL;

-- Ensanchar el CHECK de `reason`: los valores viejos siguen valiendo (las filas
-- existentes tienen que sobrevivir) y se añaden los nuevos.
DO $ck$
BEGIN
  SET LOCAL lock_timeout = '5s';
  ALTER TABLE public.churn_outcomes DROP CONSTRAINT IF EXISTS churn_outcomes_reason_check;
  ALTER TABLE public.churn_outcomes ADD CONSTRAINT churn_outcomes_reason_check
    CHECK (reason IN (
      -- nuevos
      'lapse_observed',      -- objetivo real: ¿vino entre el día 31 y el 90?
      'call_confirmed',      -- el founder llamó y le dijo qué pasó
      'gym_reported',        -- el gimnasio pasó una lista de bajas
      'billing_cancelled',   -- el día que exista billing
      -- históricos (0031) — se conservan para no invalidar filas viejas
      'cancelled', 'frozen', 'inactive_30d', 'inactive_60d',
      'retained_6m', 'win_back_returned', 'manual'
    )) NOT VALID;
END $ck$;

ALTER TABLE public.churn_outcomes VALIDATE CONSTRAINT churn_outcomes_reason_check;

CREATE INDEX IF NOT EXISTS idx_churn_outcomes_source
  ON public.churn_outcomes(gym_id, source, observed_at DESC);

-- ── 2. churn_risk_scores: versión del modelo ─────────────────
--
-- Hoy «¿esta fila es v3?» se deduce de si `primary_driver` viene relleno. Eso
-- es un proxy, y con v4 en camino hace falta el dato de verdad: el lector cae
-- al motor en vivo cuando la fila persistida es de una versión anterior, así
-- que el cliente da números correctos desde que se sube, sin esperar al
-- despliegue de la edge function.
ALTER TABLE public.churn_risk_scores
  ADD COLUMN IF NOT EXISTS model_version SMALLINT NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.churn_risk_scores.model_version IS
  'Versión del modelo que escribió la fila. El lector recalcula en vivo si es menor que la del cliente.';

-- El etiquetador busca por DÍA DE CÁLCULO, cruzando todos los gimnasios de una
-- vez. Los dos índices que hay (0001) van por gym_id y por profile_id, así que
-- sin este sería un scan completo cada noche sobre una tabla que crece con
-- socios × días. Va solo por `computed_at`: anteponer gym_id lo dejaría
-- inservible para esta consulta, que no filtra por gimnasio.
CREATE INDEX IF NOT EXISTS idx_churn_scores_computed_at
  ON public.churn_risk_scores(computed_at);

-- ── 3. Holdout: el grupo al que NO se le escribe ─────────────
--
-- Hoy hay A/B ENTRE MENSAJES (`win_back_attempts.variant` = A|B), o sea que se
-- puede saber qué mensaje funciona mejor. Lo que NO se puede saber es si
-- escribir sirve de algo, porque no hay nadie con quien comparar el silencio.
--
-- Arranca en 0 (apagado) a propósito: retener una intervención a los socios de
-- un gimnasio que paga es una decisión suya, no nuestra. La pantalla de
-- seguimiento lo explica y lo enciende.
ALTER TABLE public.churn_followup_settings
  ADD COLUMN IF NOT EXISTS holdout_pct SMALLINT NOT NULL DEFAULT 0
    CHECK (holdout_pct >= 0 AND holdout_pct <= 40);

COMMENT ON COLUMN public.churn_followup_settings.holdout_pct IS
  '% de socios en riesgo a los que NO se les manda seguimiento, para medir si mandarlo sirve. 0 = apagado.';

-- ── 4. El etiquetador ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.label_churn_lapses(p_horizon_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t     DATE;
  v_count INT;
BEGIN
  IF p_horizon_days < 45 OR p_horizon_days > 365 THEN
    RAISE EXCEPTION 'p_horizon_days fuera de rango: %', p_horizon_days;
  END IF;

  -- El día cuyas puntuaciones toca juzgar hoy.
  v_t := (now() - make_interval(days => p_horizon_days))::date;

  INSERT INTO churn_outcomes (
    profile_id, gym_id, churned, reason, source,
    signal_snapshot, score_at_label, scored_at, observed_at, horizon_days
  )
  SELECT
    s.profile_id,
    s.gym_id,
    -- LA ETIQUETA: ninguna visita entre el día 31 y el día `p_horizon_days`
    -- después de puntuar. Empieza en 31 y no en 1 porque «volvió al día
    -- siguiente» le pasa a todo el mundo; lo que se pregunta es si seguía ahí
    -- dos meses después.
    NOT EXISTS (
      SELECT 1 FROM check_ins ci
      WHERE ci.profile_id = s.profile_id
        AND ci.checked_in_at >= s.computed_at + INTERVAL '31 days'
        AND ci.checked_in_at <  s.computed_at + make_interval(days => p_horizon_days)
      UNION ALL
      SELECT 1 FROM workout_sessions ws
      WHERE ws.profile_id = s.profile_id
        AND ws.started_at >= s.computed_at + INTERVAL '31 days'
        AND ws.started_at <  s.computed_at + make_interval(days => p_horizon_days)
    ),
    'lapse_observed',
    'observed_lapse',
    COALESCE(s.metrics, '{}'::jsonb),
    s.score,
    s.computed_at,
    CURRENT_DATE,
    p_horizon_days
  FROM churn_risk_scores s
  WHERE s.computed_at >= v_t::timestamptz
    AND s.computed_at <  (v_t + 1)::timestamptz
    -- SOLO se etiqueta a quien ESTABA VIVO el día de la puntuación: alguna
    -- visita en los 30 días previos. Sin esta condición, un socio que ya
    -- llevaba 45 días desaparecido saldría etiquetado «baja» por pura
    -- definición, y estaríamos volviendo a entrenar el modelo con su propia
    -- entrada — que es el fallo que esta migración existe para arreglar.
    AND (
      EXISTS (
        SELECT 1 FROM check_ins ci
        WHERE ci.profile_id = s.profile_id
          AND ci.checked_in_at >= s.computed_at - INTERVAL '30 days'
          AND ci.checked_in_at <  s.computed_at
      )
      OR EXISTS (
        SELECT 1 FROM workout_sessions ws
        WHERE ws.profile_id = s.profile_id
          AND ws.started_at >= s.computed_at - INTERVAL '30 days'
          AND ws.started_at <  s.computed_at
      )
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.label_churn_lapses(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.label_churn_lapses(INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.label_churn_lapses(INT) TO service_role;

COMMENT ON FUNCTION public.label_churn_lapses(INT) IS
  'Etiqueta el desenlace real de las puntuaciones de hace p_horizon_days: ¿vino el socio entre el día 31 y el 90? Solo juzga a quien estaba activo al puntuar, para que la etiqueta no sea la propia entrada del modelo.';

-- 05:30 UTC — después de compute-churn-scores, para que el día etiquetado ya
-- tenga sus filas escritas.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('label-churn-lapses')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'label-churn-lapses');
    PERFORM cron.schedule(
      'label-churn-lapses',
      '30 5 * * *',
      $cron_body$ SELECT public.label_churn_lapses(90); $cron_body$
    );
  END IF;
END $cron$;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verificar:
--   SELECT holdout_pct FROM churn_followup_settings LIMIT 1;                -- 0
--   SELECT model_version FROM churn_risk_scores LIMIT 1;                    -- 3
--   SELECT source, count(*) FROM churn_outcomes GROUP BY 1;                 -- legacy_circular: N
--   SELECT public.label_churn_lapses(90);                                   -- 0 hasta tener 90 días de historial
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'label-churn-lapses';
-- =============================================================
