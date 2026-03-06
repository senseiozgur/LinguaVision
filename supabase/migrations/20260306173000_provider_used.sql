-- Stage-6: provider traceability on jobs

alter table public.jobs
  add column if not exists provider_used text null;
