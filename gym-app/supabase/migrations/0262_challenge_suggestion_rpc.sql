-- Auto-suggest weekly challenges based on gym engagement data.
-- Analyzes 7 signals in priority order and returns one suggestion.

CREATE OR REPLACE FUNCTION public.get_challenge_suggestion(p_gym_id UUID)
RETURNS TABLE (
  challenge_type    TEXT,
  suggested_name_en TEXT,
  suggested_name_es TEXT,
  description_en    TEXT,
  description_es    TEXT,
  exercise_id       TEXT,
  exercise_name     TEXT,
  exercise_name_es  TEXT,
  suggested_days    INT,
  reasoning_en      TEXT,
  reasoning_es      TEXT,
  confidence        NUMERIC(3,2),
  rule_matched      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_members   INT;
  v_active_members  INT;
  -- Rule 1: churn
  v_at_risk_count   INT;
  v_at_risk_pct     NUMERIC;
  -- Rule 2: volume
  v_vol_this_week   NUMERIC;
  v_vol_last_week   NUMERIC;
  v_vol_change_pct  NUMERIC;
  -- Rule 3: popular exercise
  v_top_ex_id       TEXT;
  v_top_ex_name     TEXT;
  v_top_ex_name_es  TEXT;
  v_top_ex_users    INT;
  v_top_ex_pct      NUMERIC;
  -- Rule 4: social
  v_isolated_count  INT;
  v_isolated_pct    NUMERIC;
  -- Rule 5: PRs
  v_pr_members      INT;
  v_pr_pct          NUMERIC;
  -- Rule 6: veterans
  v_veteran_count   INT;
  v_veteran_pct     NUMERIC;
  -- Rule 7: fallback
  v_fallback_type   TEXT;
BEGIN
  -- Auth check: caller must be admin for this gym
  IF NOT EXISTS (
    SELECT 1 FROM profile_lookup
    WHERE id = auth.uid() AND gym_id = p_gym_id
      AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Total members
  SELECT COUNT(*) INTO v_total_members
  FROM profiles
  WHERE gym_id = p_gym_id AND role = 'member' AND membership_status = 'active';

  IF v_total_members < 10 THEN
    RETURN; -- no rows = no suggestion
  END IF;

  -- Active members (at least 1 workout in last 30 days)
  SELECT COUNT(DISTINCT ws.profile_id) INTO v_active_members
  FROM workout_sessions ws
  WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
    AND ws.started_at >= now() - interval '30 days';

  IF v_active_members < 5 THEN
    v_active_members := v_total_members; -- fallback to total if few workouts
  END IF;

  -- ── Rule 1: Churn risk spike ──────────────────────────────────────────────
  SELECT COUNT(*) INTO v_at_risk_count
  FROM (
    SELECT DISTINCT ON (crs.profile_id) crs.score
    FROM churn_risk_scores crs
    WHERE crs.gym_id = p_gym_id
      AND crs.computed_at >= now() - interval '7 days'
    ORDER BY crs.profile_id, crs.computed_at DESC
  ) latest
  WHERE latest.score >= 55;

  v_at_risk_pct := (v_at_risk_count::NUMERIC / v_total_members) * 100;

  IF v_at_risk_pct > 30 THEN
    RETURN QUERY SELECT
      'consistency'::TEXT,
      'Comeback Week'::TEXT,
      'Semana de Regreso'::TEXT,
      'Show up 5 times this week to prove you''re still in the game'::TEXT,
      'Asiste 5 veces esta semana para demostrar que sigues en el juego'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      7::INT,
      (v_at_risk_count || ' of your ' || v_total_members || ' members are at high churn risk — a consistency challenge rebuilds the habit')::TEXT,
      (v_at_risk_count || ' de tus ' || v_total_members || ' miembros tienen alto riesgo de abandono — un reto de consistencia reconstruye el hábito')::TEXT,
      0.90::NUMERIC(3,2),
      'churn_spike'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 2: Volume trending down ──────────────────────────────────────────
  SELECT COALESCE(AVG(ws.total_volume_lbs), 0) INTO v_vol_this_week
  FROM workout_sessions ws
  WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
    AND ws.started_at >= now() - interval '7 days';

  SELECT COALESCE(AVG(ws.total_volume_lbs), 0) INTO v_vol_last_week
  FROM workout_sessions ws
  WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
    AND ws.started_at >= now() - interval '14 days'
    AND ws.started_at < now() - interval '7 days';

  IF v_vol_last_week > 0 THEN
    v_vol_change_pct := ((v_vol_this_week - v_vol_last_week) / v_vol_last_week) * 100;
  ELSE
    v_vol_change_pct := 0;
  END IF;

  IF v_vol_change_pct < -15 THEN
    RETURN QUERY SELECT
      'volume'::TEXT,
      'Volume Wars'::TEXT,
      'Guerra de Volumen'::TEXT,
      'Who can move the most weight this week? Every pound counts.'::TEXT,
      '¿Quién puede mover más peso esta semana? Cada libra cuenta.'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      7::INT,
      ('Gym volume dropped ' || ABS(ROUND(v_vol_change_pct)) || '% this week — a volume challenge fires things back up')::TEXT,
      ('El volumen del gym bajó ' || ABS(ROUND(v_vol_change_pct)) || '% esta semana — un reto de volumen reactiva la intensidad')::TEXT,
      0.85::NUMERIC(3,2),
      'volume_drop'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 3: Popular exercise emerging ─────────────────────────────────────
  SELECT se.exercise_id, e.name, e.name_es, COUNT(DISTINCT ws.profile_id)
  INTO v_top_ex_id, v_top_ex_name, v_top_ex_name_es, v_top_ex_users
  FROM session_exercises se
  JOIN workout_sessions ws ON ws.id = se.session_id
  JOIN exercises e ON e.id = se.exercise_id
  WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
    AND ws.started_at >= now() - interval '7 days'
  GROUP BY se.exercise_id, e.name, e.name_es
  ORDER BY COUNT(DISTINCT ws.profile_id) DESC
  LIMIT 1;

  IF v_top_ex_users IS NOT NULL AND v_active_members > 0 THEN
    v_top_ex_pct := (v_top_ex_users::NUMERIC / v_active_members) * 100;
  ELSE
    v_top_ex_pct := 0;
  END IF;

  IF v_top_ex_pct > 40 THEN
    RETURN QUERY SELECT
      'specific_lift'::TEXT,
      (v_top_ex_name || ' Challenge')::TEXT,
      ('Reto de ' || COALESCE(v_top_ex_name_es, v_top_ex_name))::TEXT,
      ('Compete for the highest ' || v_top_ex_name || ' volume this week')::TEXT,
      ('Compite por el mayor volumen de ' || COALESCE(v_top_ex_name_es, v_top_ex_name) || ' esta semana')::TEXT,
      v_top_ex_id::TEXT,
      v_top_ex_name::TEXT,
      v_top_ex_name_es::TEXT,
      7::INT,
      (v_top_ex_name || ' was logged by ' || v_top_ex_users || ' of ' || v_active_members || ' active members (' || ROUND(v_top_ex_pct) || '%) — capitalize with a dedicated challenge')::TEXT,
      (COALESCE(v_top_ex_name_es, v_top_ex_name) || ' fue registrado por ' || v_top_ex_users || ' de ' || v_active_members || ' miembros activos (' || ROUND(v_top_ex_pct) || '%) — aprovecha con un reto dedicado')::TEXT,
      0.80::NUMERIC(3,2),
      'popular_exercise'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 4: Low social engagement ─────────────────────────────────────────
  SELECT COUNT(*) INTO v_isolated_count
  FROM profiles p
  WHERE p.gym_id = p_gym_id AND p.role = 'member' AND p.membership_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM friendships f
      WHERE (f.requester_id = p.id OR f.addressee_id = p.id) AND f.status = 'accepted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM challenge_participants cp WHERE cp.profile_id = p.id
    );

  v_isolated_pct := (v_isolated_count::NUMERIC / v_total_members) * 100;

  IF v_isolated_pct > 50 THEN
    RETURN QUERY SELECT
      'team'::TEXT,
      'Stronger Together'::TEXT,
      'Más Fuertes Juntos'::TEXT,
      'Form a team with your gym buddies and compete together'::TEXT,
      'Forma un equipo con tus compañeros y compitan juntos'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      14::INT,
      (v_isolated_count || ' of your ' || v_total_members || ' members have no friends or challenge history — team challenges build community')::TEXT,
      (v_isolated_count || ' de tus ' || v_total_members || ' miembros no tienen amigos ni historial de retos — los retos en equipo construyen comunidad')::TEXT,
      0.75::NUMERIC(3,2),
      'low_social'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 5: PR momentum ──────────────────────────────────────────────────
  SELECT COUNT(DISTINCT ph.profile_id) INTO v_pr_members
  FROM pr_history ph
  WHERE ph.gym_id = p_gym_id
    AND ph.achieved_at >= now() - interval '7 days';

  v_pr_pct := (v_pr_members::NUMERIC / v_active_members) * 100;

  IF v_pr_pct > 20 THEN
    RETURN QUERY SELECT
      'pr_count'::TEXT,
      'PR Season'::TEXT,
      'Temporada de PRs'::TEXT,
      'The gym is on fire — who can set the most PRs this week?'::TEXT,
      'El gym está en llamas — ¿quién puede romper más récords esta semana?'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      7::INT,
      (v_pr_members || ' members hit PRs this week (' || ROUND(v_pr_pct) || '% of active) — ride the momentum')::TEXT,
      (v_pr_members || ' miembros rompieron récords esta semana (' || ROUND(v_pr_pct) || '% de activos) — aprovecha el impulso')::TEXT,
      0.75::NUMERIC(3,2),
      'pr_momentum'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 6: Veteran cluster ───────────────────────────────────────────────
  SELECT COUNT(*) INTO v_veteran_count
  FROM profiles p
  WHERE p.gym_id = p_gym_id AND p.role = 'member' AND p.membership_status = 'active'
    AND p.created_at < now() - interval '90 days'
    AND (
      SELECT COUNT(*) FROM check_ins ci
      WHERE ci.profile_id = p.id AND ci.checked_in_at >= now() - interval '14 days'
    ) >= 2;

  v_veteran_pct := (v_veteran_count::NUMERIC / v_total_members) * 100;

  IF v_veteran_pct > 30 THEN
    RETURN QUERY SELECT
      'milestone'::TEXT,
      '500lb Club'::TEXT,
      'Club de las 500lb'::TEXT,
      'Combine your squat, bench, and deadlift 1RM to reach the 500lb club'::TEXT,
      'Combina tu 1RM de sentadilla, press de banca y peso muerto para alcanzar el club de las 500lb'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT,
      14::INT,
      (v_veteran_count || ' of your ' || v_total_members || ' members are experienced lifters (90+ days, active) — they''re ready for a milestone challenge')::TEXT,
      (v_veteran_count || ' de tus ' || v_total_members || ' miembros son levantadores experimentados (90+ días, activos) — están listos para un reto de club')::TEXT,
      0.70::NUMERIC(3,2),
      'veteran_cluster'::TEXT;
    RETURN;
  END IF;

  -- ── Rule 7: Fallback — best historical challenge type ─────────────────────
  SELECT c.type INTO v_fallback_type
  FROM challenges c
  LEFT JOIN challenge_participants cp ON cp.challenge_id = c.id
  WHERE c.gym_id = p_gym_id
  GROUP BY c.type
  ORDER BY COUNT(DISTINCT cp.profile_id) DESC
  LIMIT 1;

  v_fallback_type := COALESCE(v_fallback_type, 'consistency');

  RETURN QUERY SELECT
    v_fallback_type::TEXT,
    CASE v_fallback_type
      WHEN 'consistency' THEN 'Weekly Grind'
      WHEN 'volume' THEN 'Volume Wars'
      WHEN 'pr_count' THEN 'PR Season'
      ELSE 'Weekly Challenge'
    END::TEXT,
    CASE v_fallback_type
      WHEN 'consistency' THEN 'Entreno Semanal'
      WHEN 'volume' THEN 'Guerra de Volumen'
      WHEN 'pr_count' THEN 'Temporada de PRs'
      ELSE 'Reto Semanal'
    END::TEXT,
    'A new challenge to keep the gym competitive'::TEXT,
    'Un nuevo reto para mantener la competencia en el gym'::TEXT,
    NULL::TEXT, NULL::TEXT, NULL::TEXT,
    7::INT,
    (v_fallback_type || ' challenges get the most engagement in your gym — run another one')::TEXT,
    ('Los retos de ' || v_fallback_type || ' generan más participación en tu gym — lanza otro')::TEXT,
    0.50::NUMERIC(3,2),
    'fallback'::TEXT;
  RETURN;
END;
$$;

NOTIFY pgrst, 'reload schema';
