-- Stage-10: shared rate limit primitives for optional distributed limiting

create table if not exists public.rate_limit_windows (
  scope text not null,
  subject text not null,
  window_sec integer not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, subject, window_sec, window_start)
);

create index if not exists idx_rate_limit_windows_updated_at
  on public.rate_limit_windows (updated_at);

alter table public.rate_limit_windows enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'rate_limit_windows'
      and policyname = 'service_role_all_rate_limit_windows'
  ) then
    create policy service_role_all_rate_limit_windows
      on public.rate_limit_windows
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

create or replace function public.rpc_rate_limit_check(
  p_scope text,
  p_subject text,
  p_window_sec integer,
  p_max_hits integer,
  p_now_iso timestamptz default now()
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz,
  hits integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if p_scope is null or length(trim(p_scope)) = 0 then
    raise exception 'INVALID_SCOPE';
  end if;
  if p_subject is null or length(trim(p_subject)) = 0 then
    raise exception 'INVALID_SUBJECT';
  end if;
  if p_window_sec is null or p_window_sec <= 0 then
    raise exception 'INVALID_WINDOW_SEC';
  end if;
  if p_max_hits is null or p_max_hits <= 0 then
    raise exception 'INVALID_MAX_HITS';
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from p_now_iso) / p_window_sec) * p_window_sec);

  insert into public.rate_limit_windows (scope, subject, window_sec, window_start, hits, updated_at)
  values (p_scope, p_subject, p_window_sec, v_window_start, 1, now())
  on conflict (scope, subject, window_sec, window_start)
  do update
     set hits = public.rate_limit_windows.hits + 1,
         updated_at = now()
  returning public.rate_limit_windows.hits into v_hits;

  delete from public.rate_limit_windows
   where updated_at < (p_now_iso - interval '2 days');

  allowed := v_hits <= p_max_hits;
  remaining := greatest(0, p_max_hits - least(v_hits, p_max_hits));
  reset_at := v_window_start + make_interval(secs => p_window_sec);
  hits := v_hits;
  return next;
end;
$$;
