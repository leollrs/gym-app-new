-- ============================================================================
-- 0710 — Los retos de asistencia puntúan solos, en el servidor
-- ============================================================================
--
-- LA PRIMERA PUNTUACIÓN DEL LADO DEL SERVIDOR DE TODA LA APP.
--
-- Hasta ahora los retos se puntuaban únicamente en `SessionSummary.jsx`, o sea:
--   · solo al terminar un entreno,
--   · solo dentro de la app,
--   · y si el socio cerraba a mitad, el punto se perdía en silencio.
--
-- Un reto de asistencia no puede depender de eso: la gracia es precisamente que
-- cuente a quien viene sin registrar entrenos. Así que se cuenta donde de
-- verdad ocurre — al crear el check-in — y da igual por dónde entre: QR en la
-- puerta, GPS, manual, o el puente de escritorio. Todos pasan por INSERT.
--
-- DOS CAUTELAS QUE VIENEN DEL PRECEDENTE DE LA MISMA TABLA
-- (`trg_rollup_checkin_activity`, migración 0434):
--
--   1. TODO va envuelto en EXCEPTION WHEN OTHERS THEN NULL. Que un reto falle
--      NUNCA puede impedir que un socio entre al gimnasio. El check-in manda.
--
--   2. Se cuenta UNA VEZ POR DÍA LOCAL. Alguien puede fichar por QR en la
--      puerta y que el GPS le fiche otra vez diez minutos después; sin esto,
--      «ven 12 veces» se completaría viniendo seis.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.score_checkin_challenges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz   TEXT;
  v_day  DATE;
  v_ch   RECORD;
BEGIN
  BEGIN
    SELECT COALESCE(timezone, 'America/Puerto_Rico') INTO v_tz FROM gyms WHERE id = NEW.gym_id;
    v_day := (NEW.checked_in_at AT TIME ZONE COALESCE(v_tz, 'America/Puerto_Rico'))::date;

    -- ¿Ya había fichado hoy? Entonces este check-in no suma.
    -- La cota de rango es lo que permite usar `idx_checkins_profile`
    -- (profile_id, checked_in_at DESC). Sin ella el predicado es una expresión
    -- sobre la columna y hay que recorrer TODOS los fichajes históricos del
    -- socio — dentro de la transacción que le abre la puerta del gimnasio.
    IF EXISTS (
      SELECT 1 FROM check_ins c
      WHERE c.profile_id = NEW.profile_id
        AND c.id <> NEW.id
        AND c.checked_in_at >= NEW.checked_in_at - INTERVAL '2 days'
        AND c.checked_in_at <= NEW.checked_in_at + INTERVAL '2 days'
        AND (c.checked_in_at AT TIME ZONE COALESCE(v_tz, 'America/Puerto_Rico'))::date = v_day
    ) THEN
      RETURN NEW;
    END IF;

    -- LA GUC. `guard_challenge_score_update` (0028/0521) rechaza cualquier
    -- cambio de `score` que no venga con este permiso o de un admin. Sin esto,
    -- el UPDATE de abajo LANZA, el EXCEPTION de más abajo se lo traga, y el
    -- reto de asistencia solo puntúa cuando quien ficha es un admin — o sea,
    -- funciona por accidente porque hoy el único camino es el escáner del
    -- mostrador. El día que el socio tenga un botón de fichar, deja de contar
    -- y nadie se entera.
    PERFORM set_config('app.allow_challenge_score_write', '1', true);

    -- Un punto por día en cada reto de asistencia vivo en el que participe.
    FOR v_ch IN
      SELECT cp.id AS participant_id
      FROM challenge_participants cp
      JOIN challenges ch ON ch.id = cp.challenge_id
      WHERE cp.profile_id = NEW.profile_id
        AND ch.gym_id = NEW.gym_id
        AND ch.type = 'check_in'
        AND ch.status = 'active'
        AND NEW.checked_in_at >= ch.start_date
        AND NEW.checked_in_at <= ch.end_date
    LOOP
      UPDATE challenge_participants
      SET score = COALESCE(score, 0) + 1
      WHERE id = v_ch.participant_id;
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    -- El check-in manda: nunca se bloquea por un reto. Pero mudo NO: un fallo
    -- aquí significa que alguien vino al gimnasio y su reto no lo contó, y eso
    -- tiene que poder verse en los registros.
    RAISE WARNING '[score_checkin_challenges] socio % no puntuó: %', NEW.profile_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_checkin_challenges ON public.check_ins;
CREATE TRIGGER trg_score_checkin_challenges
  AFTER INSERT ON public.check_ins
  FOR EACH ROW EXECUTE FUNCTION public.score_checkin_challenges();

REVOKE EXECUTE ON FUNCTION public.score_checkin_challenges() FROM PUBLIC, anon, authenticated;

-- El índice que este trigger consulta en cada check-in. `idx_checkins_profile`
-- es (profile_id, checked_in_at DESC), que ya sirve — se deja constancia de que
-- la consulta del mismo-día se apoya en él y no hace falta uno nuevo.

NOTIFY pgrst, 'reload schema';
