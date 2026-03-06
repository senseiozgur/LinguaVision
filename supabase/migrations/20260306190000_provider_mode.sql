-- Stage-6 revision: explicit execution mode per job

alter table public.jobs
  add column if not exists provider_mode text not null default 'MODE_A';
