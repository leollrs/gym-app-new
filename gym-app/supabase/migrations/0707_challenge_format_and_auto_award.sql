-- ============================================================================
-- 0707 — Retos: formato (competitivo | cumplimiento) + reparto automático
-- ============================================================================
--
-- EL PROBLEMA. `challenges.type` mezclaba dos preguntas distintas:
--   · QUÉ se mide  (entrenos, volumen, récords, un levantamiento, equipo…)
--   · CÓMO se gana (¿el podio, o una meta que puede alcanzar todo el mundo?)
--
-- Por eso «ven 12 veces este mes» no cabía en ningún sitio: con el podio, de
-- treinta personas que cumplen cobran tres. Y por eso el club (`milestone`)
-- tuvo que nacer como un TIPO cuando en realidad es un FORMATO.
--
-- SEGUNDO PROBLEMA, del mismo tamaño. Los premios NO SE REPARTÍAN SOLOS. El
-- cron `run_challenge_lifecycle` pone el reto en `completed` cada 15 minutos y
-- su propio comentario dice que eso «dispara award_challenge_prizes» — pero no
-- había ningún trigger que lo llamara.
--
-- ── SOBRE LA SEGURIDAD DE ESTE FICHERO ─────────────────────────────────────
-- Las funciones `_`-prefijadas son SECURITY DEFINER y NO comprueban rol: las
-- llama un trigger, no una persona. Eso las hace peligrosas si se pueden
-- alcanzar por PostgREST, así que llevan TRES candados y no uno:
--
--   1. `REVOKE ... FROM PUBLIC, anon, authenticated` — y las tres cosas hacen
--      falta: en Supabase el GRANT a `authenticated` es DIRECTO y un revoke a
--      PUBLIC no lo quita (lo documenta la 0670:138-141). Con `FROM PUBLIC` a
--      secas, cualquier socio podía llamarlas.
--   2. Dentro, `end_date <= now()`: no se puede repartir una carrera que aún
--      corre, aunque alguien logre invocarlas.
--   3. Un trigger sobre `challenges` que impide a quien no sea admin tocar
--      `reward_description` y `status` — o sea, montar el premio que luego se
--      cobra. La política `challenges_manage_admin` incluye `trainer`.
-- ============================================================================

-- ── 1. El formato ───────────────────────────────────────────────────────────
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'competitive';

DO $$
BEGIN
  ALTER TABLE public.challenges
    ADD CONSTRAINT challenges_format_chk CHECK (format IN ('competitive', 'completion'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un reto de cumplimiento sin meta —o con meta cero— no tiene condición de
-- victoria: TODO el mundo la cumple, y el reparto paga a la plantilla entera.
-- El `> 0` vivía solo en el cliente, o sea en ningún sitio.
DO $$
BEGIN
  ALTER TABLE public.challenges
    ADD CONSTRAINT challenges_completion_needs_target
      CHECK (format <> 'completion' OR (milestone_target IS NOT NULL AND milestone_target > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.challenges
SET format = 'completion'
WHERE type = 'milestone' AND milestone_target IS NOT NULL AND milestone_target > 0 AND format = 'competitive';

COMMENT ON COLUMN public.challenges.format IS
  'competitive = podio (3 premios) · completion = una meta, gana todo el que llegue';
COMMENT ON COLUMN public.challenges.milestone_target IS
  'La meta. Obligatoria y > 0 cuando format = completion.';

-- ── 2. Los premios dejan de ser solo un podio ───────────────────────────────
ALTER TABLE public.challenge_prizes ALTER COLUMN placement DROP NOT NULL;

DROP INDEX IF EXISTS idx_challenge_prizes_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_prizes_dedup
  ON public.challenge_prizes (challenge_id, placement)
  WHERE placement IS NOT NULL;

-- Una persona, un premio por reto. El índice viejo acotaba a tres filas por
-- reto y eso, de rebote, impedía que nadie cobrara dos veces; al partirlo en
-- dos parciales esa garantía se perdía, así que aquí va explícita.
CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_prizes_one_per_member
  ON public.challenge_prizes (challenge_id, profile_id);

COMMENT ON COLUMN public.challenge_prizes.placement IS
  '1..3 en retos competitivos. NULL = premio de cumplimiento (sin puesto).';

-- ── 3. Quién puede montar un premio ─────────────────────────────────────────
--
-- `challenges_manage_admin` da FOR ALL a admin Y TRAINER. Con el reparto
-- automático eso deja a un entrenador definir el premio y cerrar el reto, o
-- sea acuñar puntos para todo el gimnasio sin pasar por nadie. El dinero de la
-- casa lo decide el dueño.
CREATE OR REPLACE FUNCTION public.guard_challenge_money_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.reward_description IS NOT NULL THEN
      RAISE EXCEPTION 'Only an admin can attach prizes to a challenge';
    END IF;
  ELSE
    IF NEW.reward_description IS DISTINCT FROM OLD.reward_description THEN
      RAISE EXCEPTION 'Only an admin can change the prizes of a challenge';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only an admin can change the status of a challenge';
    END IF;
    IF NEW.milestone_target IS DISTINCT FROM OLD.milestone_target
       OR NEW.format IS DISTINCT FROM OLD.format THEN
      RAISE EXCEPTION 'Only an admin can change how a challenge is won';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_challenge_money ON public.challenges;
CREATE TRIGGER trg_guard_challenge_money
  BEFORE INSERT OR UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.guard_challenge_money_fields();

REVOKE EXECUTE ON FUNCTION public.guard_challenge_money_fields() FROM PUBLIC, anon, authenticated;

-- ── 4. Aviso al ganador ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_challenge_prize(
  p_profile_id UUID,
  p_gym_id     UUID,
  p_challenge_id UUID,
  p_challenge_name TEXT,
  p_points     INT,
  p_label      TEXT,
  p_placement  INT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title_en TEXT;
  v_title_es TEXT;
BEGIN
  IF p_placement IS NULL THEN
    v_title_en := 'You did it 🏆';
    v_title_es := '¡Lo lograste! 🏆';
  ELSE
    v_title_en := 'You placed #' || p_placement || ' 🏆';
    v_title_es := '¡Quedaste #' || p_placement || '! 🏆';
  END IF;

  PERFORM public._notify_push(
    p_profile_id, p_gym_id, 'member'::user_role, 'challenge_update'::notification_type,
    v_title_en,
    p_challenge_name || ' — you won ' || p_label || '. Tap to see it.',
    v_title_es,
    p_challenge_name || ' — ganaste ' || p_label || '. Toca para verlo.',
    jsonb_build_object('route', '/challenges', 'challenge_id', p_challenge_id, 'prize', true),
    'challenge_prize_' || p_challenge_id || '_' || p_profile_id
  );
EXCEPTION WHEN OTHERS THEN
  NULL;  -- que un fallo del aviso nunca deshaga un premio ya concedido
END;
$$;

-- Los tres, y no solo PUBLIC: ver la cabecera. Con `FROM PUBLIC` a secas
-- cualquier socio podía dispararle un push de premio falso a cualquiera.
REVOKE EXECUTE ON FUNCTION public._notify_challenge_prize(UUID,UUID,UUID,TEXT,INT,TEXT,INT)
  FROM PUBLIC, anon, authenticated;

-- ── 5. Reparto de cumplimiento ──────────────────────────────────────────────
--
-- Sin `LIMIT 3` y sin puesto: cobra TODO el que haya llegado a la meta.
--
-- CORTACIRCUITOS. En cumplimiento los puntos se MULTIPLICAN por el número de
-- personas, y eso no lo acotaba nadie: 100.000 (el tope por persona de la
-- 0490) × 200 socios son veinte millones de puntos, con el artículo más caro
-- del catálogo a 30.000. Aquí el reparto se planta si la emisión total pasa de
-- medio millón — y se planta LANZANDO, para que alguien lo mire, en vez de
-- pagar a medias.
CREATE OR REPLACE FUNCTION public._award_challenge_completion(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge    RECORD;
  v_rewards      JSONB;
  v_reward       JSONB;
  v_row          RECORD;
  v_points       INT;
  v_prize        TEXT;
  v_product_id   UUID;
  v_reward_type  TEXT;
  v_reward_label TEXT;
  v_qr           TEXT;
  v_prize_id     UUID;
  v_eligible     INT;
  v_result       JSONB := '[]'::JSONB;
  c_total_cap CONSTANT INT := 500000;
BEGIN
  SELECT * INTO v_challenge FROM challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN RETURN v_result; END IF;
  IF v_challenge.milestone_target IS NULL OR v_challenge.milestone_target <= 0 THEN RETURN v_result; END IF;

  -- No se reparte una carrera que todavía corre. Es el candado que sobrevive
  -- aunque alguien logre invocar esta función directamente.
  IF v_challenge.end_date > now() THEN
    RAISE EXCEPTION 'Challenge has not ended yet';
  END IF;

  BEGIN
    v_rewards := v_challenge.reward_description::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_rewards := NULL;
  END;
  IF v_rewards IS NULL OR jsonb_array_length(v_rewards) = 0 THEN RETURN v_result; END IF;

  v_reward     := v_rewards->0;
  v_points     := LEAST(GREATEST(COALESCE((v_reward->>'points')::INT, 0), 0), 100000);
  v_prize      := v_reward->>'prize';
  v_product_id := NULLIF(v_reward->>'product_id', '')::UUID;

  IF v_product_id IS NOT NULL THEN
    v_reward_type  := 'product';
    v_reward_label := COALESCE(v_prize, 'Product prize');
  ELSIF v_prize IS NOT NULL AND v_prize <> '' THEN
    v_reward_type  := 'custom';
    v_reward_label := v_prize;
  ELSE
    v_reward_type  := 'points';
    v_reward_label := v_points || ' pts';
  END IF;
  IF v_reward_type <> 'points' AND v_points > 0 THEN
    v_reward_label := v_points || ' pts + ' || v_reward_label;
  END IF;

  SELECT COUNT(*) INTO v_eligible
  FROM challenge_participants cp
  JOIN profiles p ON p.id = cp.profile_id
  WHERE cp.challenge_id = p_challenge_id
    AND cp.score >= v_challenge.milestone_target
    AND COALESCE(p.is_staff, FALSE) = FALSE;

  IF v_points > 0 AND (v_eligible::BIGINT * v_points) > c_total_cap THEN
    RAISE EXCEPTION 'Completion payout would emit % points (cap %). Lower the per-person points.',
      v_eligible::BIGINT * v_points, c_total_cap;
  END IF;

  FOR v_row IN
    SELECT cp.profile_id
    FROM challenge_participants cp
    JOIN profiles p ON p.id = cp.profile_id
    WHERE cp.challenge_id = p_challenge_id
      AND cp.score >= v_challenge.milestone_target
      -- El staff no cobra premios de socio (mismo criterio que las tablas).
      AND COALESCE(p.is_staff, FALSE) = FALSE
      -- Reentrante: una persona, un premio por reto — con o sin puesto.
      AND NOT EXISTS (
        SELECT 1 FROM challenge_prizes x
        WHERE x.challenge_id = p_challenge_id AND x.profile_id = cp.profile_id
      )
  LOOP
    v_qr := NULL;
    IF v_reward_type IN ('product', 'custom') THEN
      v_qr := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
    END IF;

    -- EL PREMIO PRIMERO, LOS PUNTOS DESPUÉS. Al revés —como estaba— dos
    -- transacciones simultáneas (el cron cerrando y el admin pulsando) pasaban
    -- las dos el NOT EXISTS, las dos sumaban puntos, y `ON CONFLICT DO NOTHING`
    -- dejaba una sola fila de premio: doble abono y contabilidad que no cuadra.
    -- Con este orden, quien pierde la carrera no acredita nada.
    INSERT INTO challenge_prizes (
      gym_id, challenge_id, profile_id, placement,
      reward_type, reward_label, points_awarded, product_id, qr_code, status
    ) VALUES (
      v_challenge.gym_id, p_challenge_id, v_row.profile_id, NULL,
      v_reward_type, v_reward_label, v_points, v_product_id, v_qr, 'pending'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_prize_id;

    IF v_prize_id IS NOT NULL THEN
      IF v_points > 0 THEN
        UPDATE reward_points
        SET total_points = total_points + v_points,
            lifetime_points = lifetime_points + v_points,
            last_updated = NOW()
        WHERE profile_id = v_row.profile_id;
        IF NOT FOUND THEN
          INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points)
          VALUES (v_row.profile_id, v_challenge.gym_id, v_points, v_points);
        END IF;

        INSERT INTO reward_points_log (profile_id, gym_id, points, action, description)
        VALUES (v_row.profile_id, v_challenge.gym_id, v_points, 'challenge_completed',
                'Challenge completed: ' || v_challenge.name);
      END IF;

      PERFORM public._notify_challenge_prize(
        v_row.profile_id, v_challenge.gym_id, p_challenge_id,
        v_challenge.name, v_points, v_reward_label, NULL);

      v_result := v_result || jsonb_build_object(
        'prize_id', v_prize_id, 'profile_id', v_row.profile_id,
        'placement', NULL, 'reward_type', v_reward_type,
        'reward_label', v_reward_label, 'points_awarded', v_points, 'qr_code', v_qr);
    END IF;
    v_prize_id := NULL;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._award_challenge_completion(UUID) FROM PUBLIC, anon, authenticated;

-- ── 6. Reparto competitivo, sin la barrera de admin ─────────────────────────
CREATE OR REPLACE FUNCTION public._award_challenge_competitive(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge    RECORD;
  v_rewards      JSONB;
  v_row          RECORD;
  v_place        INT := 0;
  v_reward       JSONB;
  v_points       INT;
  v_prize        TEXT;
  v_product_id   UUID;
  v_reward_type  TEXT;
  v_reward_label TEXT;
  v_qr           TEXT;
  v_prize_id     UUID;
  v_result       JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_challenge FROM challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN RETURN v_result; END IF;

  IF v_challenge.end_date > now() THEN
    RAISE EXCEPTION 'Challenge has not ended yet';
  END IF;

  IF EXISTS (SELECT 1 FROM challenge_prizes WHERE challenge_id = p_challenge_id) THEN
    RETURN v_result;   -- ya repartido
  END IF;

  BEGIN
    v_rewards := v_challenge.reward_description::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_rewards := NULL;
  END;
  IF v_rewards IS NULL OR jsonb_array_length(v_rewards) = 0 THEN RETURN v_result; END IF;

  FOR v_row IN
    SELECT cp.profile_id, cp.score
    FROM challenge_participants cp
    JOIN profiles p ON p.id = cp.profile_id
    WHERE cp.challenge_id = p_challenge_id
      AND COALESCE(p.is_staff, FALSE) = FALSE
      -- Una tabla de ceros no tiene ganadores. Repartir el podio sobre
      -- puntuación cero era exactamente lo que pasaba con los retos que nunca
      -- puntuaban.
      AND cp.score > 0
    ORDER BY cp.score DESC, cp.score_updated_at ASC
    LIMIT 3
  LOOP
    v_place := v_place + 1;
    IF v_place > jsonb_array_length(v_rewards) THEN CONTINUE; END IF;
    v_reward := v_rewards->(v_place - 1);

    v_points     := LEAST(GREATEST(COALESCE((v_reward->>'points')::INT, 0), 0), 100000);
    v_prize      := v_reward->>'prize';
    v_product_id := NULLIF(v_reward->>'product_id', '')::UUID;

    IF v_product_id IS NOT NULL THEN
      v_reward_type := 'product'; v_reward_label := COALESCE(v_prize, 'Product prize');
    ELSIF v_prize IS NOT NULL AND v_prize <> '' THEN
      v_reward_type := 'custom';  v_reward_label := v_prize;
    ELSE
      v_reward_type := 'points';  v_reward_label := v_points || ' pts';
    END IF;
    IF v_reward_type <> 'points' AND v_points > 0 THEN
      v_reward_label := v_points || ' pts + ' || v_reward_label;
    END IF;

    v_qr := NULL;
    IF v_reward_type IN ('product', 'custom') THEN
      v_qr := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
    END IF;

    -- Mismo orden que arriba, por la misma razón: premio primero.
    INSERT INTO challenge_prizes (
      gym_id, challenge_id, profile_id, placement,
      reward_type, reward_label, points_awarded, product_id, qr_code, status
    ) VALUES (
      v_challenge.gym_id, p_challenge_id, v_row.profile_id, v_place,
      v_reward_type, v_reward_label, v_points, v_product_id, v_qr, 'pending'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_prize_id;

    IF v_prize_id IS NOT NULL THEN
      IF v_points > 0 THEN
        UPDATE reward_points
        SET total_points = total_points + v_points,
            lifetime_points = lifetime_points + v_points,
            last_updated = NOW()
        WHERE profile_id = v_row.profile_id;
        IF NOT FOUND THEN
          INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points)
          VALUES (v_row.profile_id, v_challenge.gym_id, v_points, v_points);
        END IF;
        INSERT INTO reward_points_log (profile_id, gym_id, points, action, description)
        VALUES (v_row.profile_id, v_challenge.gym_id, v_points, 'challenge_completed',
                'Challenge prize: ' || v_challenge.name || ' (place ' || v_place || ')');
      END IF;

      PERFORM public._notify_challenge_prize(
        v_row.profile_id, v_challenge.gym_id, p_challenge_id,
        v_challenge.name, v_points, v_reward_label, v_place);

      v_result := v_result || jsonb_build_object(
        'prize_id', v_prize_id, 'profile_id', v_row.profile_id, 'placement', v_place,
        'reward_type', v_reward_type, 'reward_label', v_reward_label,
        'points_awarded', v_points, 'qr_code', v_qr);
    END IF;
    v_prize_id := NULL;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._award_challenge_competitive(UUID) FROM PUBLIC, anon, authenticated;

-- ── 7. El botón del admin: mismo nombre, ahora bifurca por formato ──────────
CREATE OR REPLACE FUNCTION public.award_challenge_prizes(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge  RECORD;
  v_caller_gym UUID;
  v_result     JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can award prizes';
  END IF;

  SELECT gym_id INTO v_caller_gym FROM profiles WHERE id = auth.uid();

  SELECT * INTO v_challenge FROM challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.gym_id <> v_caller_gym AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized for this gym';
  END IF;

  IF v_challenge.format = 'completion' THEN
    v_result := public._award_challenge_completion(p_challenge_id);
  ELSE
    IF EXISTS (SELECT 1 FROM challenge_prizes WHERE challenge_id = p_challenge_id) THEN
      RAISE EXCEPTION 'Prizes have already been awarded for this challenge';
    END IF;
    v_result := public._award_challenge_competitive(p_challenge_id);
  END IF;

  -- Lanzar y no devolver vacío en silencio. Los filtros nuevos (`score > 0`,
  -- sin staff) hacen que un reto que terminó con la tabla en ceros —o en el que
  -- solo participó personal— salga sin repartir nada. La interfaz solo mira si
  -- hubo error, así que un `'[]'` mudo le pintaba al dueño «¡Premios
  -- repartidos!» sobre cero filas.
  IF jsonb_array_length(v_result) = 0 THEN
    RAISE EXCEPTION 'Nobody qualified for a prize in this challenge';
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_challenge_prizes(UUID) TO authenticated;

-- ── 8. Reparto automático al cerrar ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_challenge_prizes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status::TEXT, '') <> 'completed' THEN
    BEGIN
      IF NEW.format = 'completion' THEN
        PERFORM public._award_challenge_completion(NEW.id);
      ELSE
        PERFORM public._award_challenge_competitive(NEW.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Nunca bloquear el cierre del reto por un fallo al repartir. Pero que
      -- quede escrito: un fallo mudo aquí es un reto cerrado sin premios que
      -- nadie va a reclamar porque nadie sabe que existió.
      RAISE WARNING '[settle_challenge_prizes] reto % no repartió: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_challenge_prizes ON public.challenges;
CREATE TRIGGER trg_settle_challenge_prizes
  AFTER UPDATE OF status ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.settle_challenge_prizes();

REVOKE EXECUTE ON FUNCTION public.settle_challenge_prizes() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
