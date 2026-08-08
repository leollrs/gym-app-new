-- ============================================================
-- 0715 — La TV distingue una CARRERA de una META
-- ============================================================
-- LO QUE PASABA. `tv_get_dashboard_data` devuelve los retos activos con su
-- top-10, y la pantalla los pinta siempre igual: 🥇🥈🥉 arriba y el resto
-- numerado. Para un reto competitivo eso es exactamente lo que es. Para uno de
-- CUMPLIMIENTO —«ven 12 veces este mes», donde gana todo el que llegue— es la
-- lectura contraria: la pantalla del gimnasio le dice a quien pasa por delante
-- que hay un ganador y que va tercero, cuando en realidad o llega o no llega, y
-- si llega cobra igual que el primero. Desanima justo a quien más falta le hace
-- seguir: al que va por la mitad.
--
-- Las columnas `format` y `milestone_target` existen desde la 0707, pero esta
-- función se escribió antes y nunca las devolvió, así que la TV no tenía forma
-- de saberlo. Se añaden aquí, junto con las dos cifras que un reto de
-- cumplimiento necesita para contarse: cuánta gente hay dentro y cuánta YA
-- llegó.
--
-- QUÉ MÁS CAMBIA: nada. El cuerpo es el de la 0651 palabra por palabra, con el
-- único añadido del bloque de retos. Se reproduce entero porque plpgsql no
-- admite parches parciales.
--
-- CREATE OR REPLACE, no DROP: la firma `(text, text)` y el tipo de retorno
-- `jsonb` son idénticos, así que reemplaza de verdad Y conserva los GRANT a
-- `anon` — que son imprescindibles, porque un televisor colgado en la pared no
-- tiene sesión. Si se hiciera DROP habría que volver a concederlos a mano y un
-- olvido deja todas las pantallas de todos los gimnasios en la de introducir
-- código. Aun así se re-conceden al final por si la función no existiera.
--
-- CÓMO COMPROBAR QUE SE APLICÓ: preguntándole a la FUNCIÓN, no al catálogo —
--   SELECT (public.tv_get_dashboard_data('<CODIGO>', 'probe') -> 'challenges' -> 0) ? 'format';
-- Debe devolver `true`. Mirar `pg_proc` solo dice que hay una función con ese
-- nombre, no cuál de las dos versiones está dentro.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tv_get_dashboard_data(p_code text, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings    RECORD;
  v_gym_id      UUID;
  v_revoked     TIMESTAMPTZ;
  v_exists      BOOLEAN;
  v_period      TEXT;
  v_since       TIMESTAMPTZ;
  v_volume      JSONB;
  v_workouts    JSONB;
  v_prs         JSONB;
  v_improved    JSONB;
  v_consistency JSONB;
  v_checkins    JSONB;
  v_challenges  JSONB;
BEGIN
  -- ── 0651 rate limit ──────────────────────────────────────────────────────
  -- RAISES rather than returning success:false. That is deliberate: TVDisplay
  -- treats `!data.success` as "revoked / expired", clears its stored credentials
  -- and drops to the code-entry screen — so a soft rate-limit reply would
  -- de-authenticate a legitimate wall screen and require someone to physically
  -- walk over and retype the code. Its catch block, by contrast, explicitly
  -- keeps the last-known data on screen and retries next tick. So a throw is the
  -- graceful path here and success:false is the destructive one.
  PERFORM public.tv_rate_limit_check(p_session_id);

  SELECT * INTO v_settings FROM gym_tv_settings WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;
  v_gym_id := v_settings.gym_id;

  -- Chosen window for the count-based boards.
  v_period := COALESCE(v_settings.tv_period, 'month');
  v_since := CASE v_period
    WHEN 'today' THEN date_trunc('day', now())
    WHEN 'week'  THEN now() - interval '7 days'
    WHEN 'month' THEN now() - interval '30 days'
    WHEN '90d'   THEN now() - interval '90 days'
    WHEN 'all'   THEN 'epoch'::timestamptz
    ELSE now() - interval '30 days'
  END;

  -- ── Per-session revoke gate ──
  SELECT revoked_at INTO v_revoked
  FROM gym_tv_sessions
  WHERE gym_id = v_gym_id AND session_id = p_session_id;
  v_exists := FOUND;
  IF v_exists AND v_revoked IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'revoked');
  END IF;

  -- Heartbeat (only for non-revoked sessions).
  IF v_exists THEN
    UPDATE gym_tv_sessions
    SET last_heartbeat_at = now()
    WHERE gym_id = v_gym_id AND session_id = p_session_id;
  ELSE
    INSERT INTO gym_tv_sessions (gym_id, session_id)
    VALUES (v_gym_id, p_session_id)
    ON CONFLICT (gym_id, session_id) DO UPDATE SET last_heartbeat_at = now();
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_volume FROM (
    SELECT ws.profile_id AS id, p.full_name AS name,
           ROUND(SUM(ws.total_volume_lbs)::NUMERIC) AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    HAVING SUM(ws.total_volume_lbs) > 0
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_workouts FROM (
    SELECT ws.profile_id AS id, p.full_name AS name, COUNT(*)::INT AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_prs FROM (
    SELECT pr.profile_id AS id, p.full_name AS name,
           ROUND(MAX(pr.estimated_1rm)::NUMERIC) AS score
    FROM personal_records pr JOIN profiles p ON p.id = pr.profile_id
    WHERE p.gym_id = v_gym_id
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY pr.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_improved FROM (
    WITH this_month AS (
      SELECT ws.profile_id, SUM(ws.total_volume_lbs) AS vol
      FROM workout_sessions ws
      WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
        AND ws.started_at >= date_trunc('month', now())
      GROUP BY ws.profile_id
    ), last_month AS (
      SELECT ws.profile_id, SUM(ws.total_volume_lbs) AS vol
      FROM workout_sessions ws
      WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
        AND ws.started_at >= date_trunc('month', now() - interval '1 month')
        AND ws.started_at <  date_trunc('month', now())
      GROUP BY ws.profile_id
    )
    SELECT tm.profile_id AS id, p.full_name AS name,
           ROUND(((tm.vol - lm.vol) / NULLIF(lm.vol, 0) * 100)::NUMERIC) AS score
    FROM this_month tm JOIN last_month lm ON lm.profile_id = tm.profile_id
    JOIN profiles p ON p.id = tm.profile_id
    WHERE lm.vol > 0 AND tm.vol > lm.vol
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_consistency FROM (
    SELECT ws.profile_id AS id, p.full_name AS name,
           ROUND((COUNT(DISTINCT date_trunc('day', ws.started_at))::NUMERIC
             / GREATEST(EXTRACT(DAY FROM now())::NUMERIC, 1) * 100))::INT AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= date_trunc('month', now())
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_checkins FROM (
    SELECT ci.profile_id AS id, p.full_name AS name, COUNT(*)::INT AS score
    FROM check_ins ci JOIN profiles p ON p.id = ci.profile_id
    WHERE ci.gym_id = v_gym_id AND ci.checked_in_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ci.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(c ORDER BY c.start_date ASC), '[]'::JSONB)
  INTO v_challenges FROM (
    SELECT ch.id, ch.name, ch.description, ch.type,
           ch.start_date, ch.end_date, ch.reward_description,
           -- 0715: sin estos dos, la TV no puede distinguir una CARRERA de una
           -- META y pinta las dos con podio de oro, plata y bronce.
           ch.format, ch.milestone_target,
      (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.score DESC NULLS LAST), '[]'::JSONB)
        FROM (
          SELECT cp.profile_id, cp.score, pr.full_name AS name, pr.avatar_url
          FROM challenge_participants cp JOIN profiles pr ON pr.id = cp.profile_id
          WHERE cp.challenge_id = ch.id AND cp.gym_id = v_gym_id
            AND pr.imported_archived = false
            AND pr.leaderboard_visible = TRUE
          ORDER BY cp.score DESC NULLS LAST LIMIT 10
        ) p
      ) AS participants,
      -- Las dos cifras que dan sentido a un reto de cumplimiento: cuántos van y
      -- cuántos YA llegaron. Cuentan a TODO el mundo, no solo a los diez de
      -- arriba ni solo a quien deja ver su nombre — son totales, no nombres, así
      -- que no filtran nada de nadie.
      (SELECT COUNT(*)::INT
         FROM challenge_participants cp2 JOIN profiles pr2 ON pr2.id = cp2.profile_id
        WHERE cp2.challenge_id = ch.id AND cp2.gym_id = v_gym_id
          AND pr2.imported_archived = false) AS participant_count,
      (SELECT COUNT(*)::INT
         FROM challenge_participants cp3 JOIN profiles pr3 ON pr3.id = cp3.profile_id
        WHERE cp3.challenge_id = ch.id AND cp3.gym_id = v_gym_id
          AND pr3.imported_archived = false
          AND ch.milestone_target IS NOT NULL
          AND coalesce(cp3.score, 0) >= ch.milestone_target) AS completed_count
    FROM challenges ch
    WHERE ch.gym_id = v_gym_id
      AND ch.status IN ('active', 'completed')  -- 0551: hide draft/archived challenges from the TV board
      AND (ch.end_date IS NULL OR ch.end_date >= now()::DATE)
      AND (ch.start_date IS NULL OR ch.start_date <= (now() + interval '60 days')::DATE)
    LIMIT 6
  ) c;

  RETURN jsonb_build_object(
    'success', true,
    'tv_style', v_settings.tv_style,
    'tv_period', v_period,
    'leaderboards', jsonb_build_object(
      'volume', v_volume, 'workouts', v_workouts, 'prs', v_prs,
      'improved', v_improved, 'consistency', v_consistency, 'checkins', v_checkins
    ),
    'challenges', v_challenges
  );
END;
$function$;

-- Los GRANT de siempre. CREATE OR REPLACE los conserva; se repiten por si esta
-- migración corre sobre una base donde la función no existía todavía.
-- `anon` NO es opcional: la TV se autentica con un código, no con una sesión.
GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO anon;
