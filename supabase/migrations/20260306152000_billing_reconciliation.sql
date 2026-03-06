-- Stage-4: billing lifecycle state + refund reconciliation claim

alter table public.jobs
  add column if not exists charge_state text not null default 'NOT_CHARGED',
  add column if not exists refund_retry_count integer not null default 0,
  add column if not exists next_refund_retry_at timestamptz null,
  add column if not exists last_refund_error_code text null,
  add column if not exists refund_last_attempt_at timestamptz null;

create index if not exists ix_jobs_refund_due
  on public.jobs (charge_state, next_refund_retry_at);

create or replace function public.rpc_claim_next_refund_retry_job(p_worker_id text default null)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  with candidate as (
    select j.id
    from public.jobs j
    where j.charge_state = 'REFUND_PENDING'
      and j.next_refund_retry_at is not null
      and j.next_refund_retry_at <= now()
    order by j.next_refund_retry_at asc
    for update skip locked
    limit 1
  )
  update public.jobs j
     set charge_state = 'REFUND_RETRYING',
         updated_at = now()
    from candidate c
   where j.id = c.id
  returning j.* into v_job;

  if not found then
    return;
  end if;

  return next v_job;
end;
$$;
