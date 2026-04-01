-- Rate limiting table for broadcast push notifications (max 10 per hour per gym)
create table if not exists public.admin_push_log (
  id         bigint generated always as identity primary key,
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  sent_by    uuid not null references auth.users(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  total_sent int not null default 0
);

-- Index for the rate-limit query: recent pushes per gym
create index idx_admin_push_log_gym_sent_at on public.admin_push_log (gym_id, sent_at desc);

-- RLS: only service_role writes to this table (via edge function)
alter table public.admin_push_log enable row level security;

-- Allow admins to read their own gym's push log
create policy "Admins can view own gym push log"
  on public.admin_push_log for select
  using (
    gym_id = (select gym_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('admin', 'super_admin')
  );

-- Auto-cleanup: remove entries older than 24 hours (generous buffer beyond the 1-hour window)
-- This can be scheduled via pg_cron or a periodic edge function.
comment on table public.admin_push_log is 'Rate limiting log for broadcast push notifications. Entries older than 24h can be safely purged.';
