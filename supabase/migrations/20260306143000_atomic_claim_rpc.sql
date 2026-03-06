-- Stage-3: atomic distributed claim for queued jobs

create or replace function public.rpc_claim_next_queued_job(p_worker_id text default null)
returns table (
  id uuid,
  owner_id text,
  status text,
  progress_pct integer,
  input_path text,
  output_path text,
  source_lang text,
  target_lang text,
  package_name text,
  mode text,
  budget_units integer,
  selected_tier text,
  layout_metrics jsonb,
  translation_cache_hit boolean,
  quality_gate_passed boolean,
  quality_gate_reason text,
  cost_delta_units integer,
  ux_hint text,
  last_error_code text,
  request_id text,
  billing_request_id text,
  charged_units integer,
  charged boolean,
  refunded boolean,
  created_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_transition_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
  v_worker text;
begin
  v_worker := coalesce(nullif(trim(p_worker_id), ''), 'worker-unknown');

  with candidate as (
    select j.id
    from public.jobs j
    where j.status = 'QUEUED'
    order by j.created_at asc
    for update skip locked
    limit 1
  )
  update public.jobs j
     set status = 'PROCESSING',
         progress_pct = 30,
         started_at = coalesce(j.started_at, now()),
         last_transition_at = now(),
         updated_at = now()
    from candidate c
   where j.id = c.id
  returning j.* into v_job;

  if not found then
    return;
  end if;

  insert into public.job_events (job_id, owner_id, event_type, meta)
  values
    (v_job.id, v_job.owner_id, 'PROCESSING', jsonb_build_object('worker_id', v_worker)),
    (v_job.id, v_job.owner_id, 'JOB_CLAIMED', jsonb_build_object('worker_id', v_worker));

  return query
  select
    v_job.id,
    v_job.owner_id,
    v_job.status,
    v_job.progress_pct,
    v_job.input_path,
    v_job.output_path,
    v_job.source_lang,
    v_job.target_lang,
    v_job.package_name,
    v_job.mode,
    v_job.budget_units,
    v_job.selected_tier,
    v_job.layout_metrics,
    v_job.translation_cache_hit,
    v_job.quality_gate_passed,
    v_job.quality_gate_reason,
    v_job.cost_delta_units,
    v_job.ux_hint,
    v_job.last_error_code,
    v_job.request_id,
    v_job.billing_request_id,
    v_job.charged_units,
    v_job.charged,
    v_job.refunded,
    v_job.created_at,
    v_job.started_at,
    v_job.finished_at,
    v_job.last_transition_at,
    v_job.updated_at;
end;
$$;
