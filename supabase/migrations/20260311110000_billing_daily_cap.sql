-- Stage P1: server-side daily cap enforcement for billing charge RPC.

create table if not exists public.billing_daily_caps (
  user_id uuid primary key,
  daily_cap_units integer not null check (daily_cap_units >= 0),
  updated_at timestamptz not null default now()
);

alter table public.billing_daily_caps enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_daily_caps'
      and policyname = 'service_role_all_billing_daily_caps'
  ) then
    create policy service_role_all_billing_daily_caps
      on public.billing_daily_caps
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

create index if not exists ix_billing_ledger_user_day
  on public.billing_ledger (user_id, created_at);

create or replace function public.rpc_charge_units(
  p_user_id uuid,
  p_job_id text,
  p_request_id text,
  p_units integer,
  p_meta jsonb default '{}'::jsonb
)
returns table (
  billing_request_id text,
  charged_units integer,
  already_charged boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing billing_ledger%rowtype;
  v_billing_request_id text;
  v_daily_cap_units integer;
  v_daily_used_units integer;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  if p_request_id is null or length(trim(p_request_id)) = 0 then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  if p_units is null or p_units < 0 then
    raise exception 'INVALID_UNITS';
  end if;

  perform pg_advisory_xact_lock(hashtext('charge:' || p_request_id));

  select *
    into v_existing
  from billing_ledger
  where kind = 'charge'
    and request_id = p_request_id
  limit 1;

  if found then
    return query
    select v_existing.billing_request_id, v_existing.units, true;
    return;
  end if;

  if p_user_id is not null then
    select c.daily_cap_units
      into v_daily_cap_units
    from billing_daily_caps c
    where c.user_id = p_user_id
    limit 1;

    if v_daily_cap_units is not null then
      v_day_start := date_trunc('day', now());
      v_day_end := v_day_start + interval '1 day';

      select coalesce(sum(case when l.kind = 'charge' then l.units when l.kind = 'refund' then -l.units else 0 end), 0)
        into v_daily_used_units
      from billing_ledger l
      where l.user_id = p_user_id
        and l.created_at >= v_day_start
        and l.created_at < v_day_end;

      if coalesce(v_daily_used_units, 0) + p_units > v_daily_cap_units then
        raise exception 'DAILY_CAP_EXCEEDED';
      end if;
    end if;
  end if;

  v_billing_request_id := 'bill_' || p_request_id;

  insert into billing_ledger (
    user_id, job_id, request_id, billing_request_id, kind, units, meta
  ) values (
    p_user_id, p_job_id, p_request_id, v_billing_request_id, 'charge', p_units, coalesce(p_meta, '{}'::jsonb)
  );

  if p_user_id is not null then
    insert into user_balance (user_id, balance_units, updated_at)
    values (p_user_id, 0 - p_units, now())
    on conflict (user_id)
    do update
      set balance_units = user_balance.balance_units - p_units,
          updated_at = now();
  end if;

  return query
  select v_billing_request_id, p_units, false;
end;
$$;
