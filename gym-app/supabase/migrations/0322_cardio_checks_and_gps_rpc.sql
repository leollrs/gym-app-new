-- 0322 — Expand cardio_sessions CHECK constraints + let RPC persist GPS fields
--
-- 1. Allow cardio_type values the app already exposes (hiking, boxing, sports,
--    yoga, etc). Previously the CHECK was a hard-coded list which blocks most
--    of the cardio picker grid.
-- 2. Allow source='gps' in addition to manual/health_kit/google_fit/watch so
--    the in-app GPS tracker can save.
-- 3. Update log_cardio_session RPC to also write route / splits /
--    avg_pace_sec_per_km / elevation_gain_m (columns added in 0320).

-- ── 1. Relax cardio_type CHECK ────────────────────────────────────────────────
alter table cardio_sessions drop constraint if exists cardio_sessions_cardio_type_check;
alter table cardio_sessions add constraint cardio_sessions_cardio_type_check
  check (cardio_type in (
    'running', 'walking', 'cycling', 'hiking',
    'rowing', 'elliptical', 'stair_climber', 'hiit', 'jump_rope',
    'swimming', 'basketball', 'soccer', 'tennis', 'boxing',
    'yoga', 'pilates', 'dance', 'climbing', 'skiing', 'other'
  ));

-- ── 2. Relax source CHECK to include 'gps' ───────────────────────────────────
alter table cardio_sessions drop constraint if exists cardio_sessions_source_check;
alter table cardio_sessions add constraint cardio_sessions_source_check
  check (source in ('manual', 'gps', 'health_kit', 'google_fit', 'watch'));

-- ── 3. Update RPC to persist GPS columns ─────────────────────────────────────
create or replace function public.log_cardio_session(p_payload json)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id          uuid;
  v_gym_id           uuid;
  v_session_id       uuid;
  v_cardio_type      text;
  v_duration_seconds int;
  v_now              timestamptz := now();
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select gym_id into v_gym_id from profiles where id = v_user_id;
  if v_gym_id is null then
    raise exception 'user has no gym';
  end if;

  v_cardio_type := p_payload->>'cardio_type';
  v_duration_seconds := (p_payload->>'duration_seconds')::int;

  if v_cardio_type is null or v_duration_seconds is null or v_duration_seconds <= 0 then
    raise exception 'cardio_type and positive duration_seconds required';
  end if;

  insert into cardio_sessions (
    profile_id, gym_id, cardio_type, duration_seconds,
    distance_km, calories_burned, avg_heart_rate, max_heart_rate,
    intensity, notes, source, started_at, completed_at,
    route, splits, avg_pace_sec_per_km, elevation_gain_m
  ) values (
    v_user_id,
    v_gym_id,
    v_cardio_type,
    v_duration_seconds,
    nullif(p_payload->>'distance_km', '')::numeric,
    nullif(p_payload->>'calories_burned', '')::int,
    nullif(p_payload->>'avg_heart_rate', '')::int,
    nullif(p_payload->>'max_heart_rate', '')::int,
    p_payload->>'intensity',
    p_payload->>'notes',
    coalesce(p_payload->>'source', 'manual'),
    coalesce(nullif(p_payload->>'started_at', '')::timestamptz, v_now - (v_duration_seconds || ' seconds')::interval),
    coalesce(nullif(p_payload->>'completed_at', '')::timestamptz, v_now),
    coalesce((p_payload->'route')::jsonb, '[]'::jsonb),
    coalesce((p_payload->'splits')::jsonb, '[]'::jsonb),
    nullif(p_payload->>'avg_pace_sec_per_km', '')::numeric,
    nullif(p_payload->>'elevation_gain_m', '')::numeric
  )
  returning id into v_session_id;

  return json_build_object('session_id', v_session_id, 'id', v_session_id);
end;
$$;

grant execute on function public.log_cardio_session(json) to authenticated;

notify pgrst, 'reload schema';
