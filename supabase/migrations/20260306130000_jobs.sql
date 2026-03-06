-- Durable jobs and event timeline for Stage-1 job durability

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  status text not null,
  progress_pct integer not null default 0,
  input_path text null,
  output_path text null,
  source_lang text null,
  target_lang text null,
  package_name text null,
  mode text null,
  budget_units integer null,
  selected_tier text null,
  layout_metrics jsonb null,
  translation_cache_hit boolean not null default false,
  quality_gate_passed boolean null,
  quality_gate_reason text null,
  cost_delta_units integer not null default 0,
  ux_hint text null,
  last_error_code text null,
  request_id text null,
  billing_request_id text null,
  charged_units integer not null default 0,
  charged boolean not null default false,
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  last_transition_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_jobs_owner_id on public.jobs (owner_id);
create index if not exists ix_jobs_status on public.jobs (status);
create index if not exists ix_jobs_created_at on public.jobs (created_at desc);

create table if not exists public.job_events (
  id bigserial primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  owner_id text not null,
  ts timestamptz not null default now(),
  event_type text not null,
  meta jsonb null
);

create index if not exists ix_job_events_job_id_ts on public.job_events (job_id, ts);

alter table public.jobs enable row level security;
alter table public.job_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jobs'
      and policyname = 'service_role_all_jobs'
  ) then
    create policy service_role_all_jobs
      on public.jobs
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_events'
      and policyname = 'service_role_all_job_events'
  ) then
    create policy service_role_all_job_events
      on public.job_events
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
