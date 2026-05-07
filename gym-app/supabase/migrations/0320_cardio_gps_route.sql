-- 0320 — Add GPS route + derived metrics to cardio_sessions
-- Stores the polyline captured by the in-app GPS tracker plus per-session
-- summary stats so the Strava-style share card can render without re-running
-- the math client-side.

alter table if exists cardio_sessions
  add column if not exists route jsonb default '[]'::jsonb,
  add column if not exists distance_km numeric,
  add column if not exists avg_pace_sec_per_km numeric,
  add column if not exists elevation_gain_m numeric,
  add column if not exists splits jsonb default '[]'::jsonb;

create index if not exists cardio_sessions_route_gin_idx
  on cardio_sessions using gin (route);

notify pgrst, 'reload schema';
