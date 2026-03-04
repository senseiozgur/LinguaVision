-- Billing ledger and deterministic idempotent RPCs for LinguaVision

create table if not exists public.billing_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  job_id text not null,
  request_id text not null,
  billing_request_id text not null,
  kind text not null check (kind in ('charge', 'refund')),
  units integer not null check (units >= 0),
  reason text null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_billing_kind_request
  on public.billing_ledger (kind, billing_request_id);

create unique index if not exists ux_billing_charge_request_id
  on public.billing_ledger (request_id)
  where kind = 'charge';

create table if not exists public.user_balance (
  user_id uuid primary key,
  balance_units integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.billing_ledger enable row level security;
alter table public.user_balance enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_ledger'
      and policyname = 'service_role_all_billing_ledger'
  ) then
    create policy service_role_all_billing_ledger
      on public.billing_ledger
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
      and tablename = 'user_balance'
      and policyname = 'service_role_all_user_balance'
  ) then
    create policy service_role_all_user_balance
      on public.user_balance
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

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

create or replace function public.rpc_refund_units(
  p_user_id uuid,
  p_job_id text,
  p_request_id text,
  p_billing_request_id text,
  p_units integer,
  p_reason text,
  p_meta jsonb default '{}'::jsonb
)
returns table (
  refund_billing_request_id text,
  refunded boolean,
  already_refunded boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing billing_ledger%rowtype;
  v_charge billing_ledger%rowtype;
  v_refund_billing_request_id text;
  v_charge_billing_request_id text;
begin
  if p_request_id is null or length(trim(p_request_id)) = 0 then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  if p_units is null or p_units < 0 then
    raise exception 'INVALID_UNITS';
  end if;

  perform pg_advisory_xact_lock(hashtext('refund:' || p_request_id));

  v_refund_billing_request_id := 'refund_' || p_request_id;
  v_charge_billing_request_id := coalesce(p_billing_request_id, 'bill_' || p_request_id);

  select *
    into v_existing
  from billing_ledger
  where kind = 'refund'
    and (request_id = p_request_id or billing_request_id = v_refund_billing_request_id)
  limit 1;

  if found then
    return query
    select v_existing.billing_request_id, true, true;
    return;
  end if;

  select *
    into v_charge
  from billing_ledger
  where kind = 'charge'
    and billing_request_id = v_charge_billing_request_id
  limit 1;

  if not found then
    raise exception 'CHARGE_NOT_FOUND';
  end if;

  insert into billing_ledger (
    user_id, job_id, request_id, billing_request_id, kind, units, reason, meta
  ) values (
    coalesce(p_user_id, v_charge.user_id),
    coalesce(p_job_id, v_charge.job_id),
    p_request_id,
    v_refund_billing_request_id,
    'refund',
    p_units,
    p_reason,
    coalesce(p_meta, '{}'::jsonb)
  );

  if coalesce(p_user_id, v_charge.user_id) is not null then
    insert into user_balance (user_id, balance_units, updated_at)
    values (coalesce(p_user_id, v_charge.user_id), p_units, now())
    on conflict (user_id)
    do update
      set balance_units = user_balance.balance_units + p_units,
          updated_at = now();
  end if;

  return query
  select v_refund_billing_request_id, true, false;
end;
$$;
