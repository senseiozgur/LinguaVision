# Billing Contract (Supabase Ledger)

## Scope
- System of record: Supabase `public.billing_ledger` (append-only).
- Runtime integration point: backend billing adapter calls RPC only.

## Identities
- `request_id`: one logical job-run billing identity.
- `billing_request_id`:
  - charge: `bill_${request_id}`
  - refund: `refund_${request_id}`

## Invariants
1. Charge once per `request_id` (`kind='charge'` uniqueness).
2. Refund once per `request_id` (refund key uniqueness).
3. Ledger is append-only (`billing_ledger` rows are events).
4. Refund path requires an existing charge identity.
5. Job response exposes stable billing summary fields:
   `request_id`, `billing_request_id`, `charged_units`, `charged`, `refunded`.

## Failure Matrix
- Fail before charge RPC
  - Expected: no charge event.
- Fail after charge and before READY
  - Expected: refund RPC called once and `refunded=true`.
- Provider/storage fail after charge
  - Expected: deterministic refund with same `request_id`.
- Retry same run request
  - Expected: no additional charge (idempotent RPC + run-state gate).
- Duplicate refund trigger
  - Expected: one refund event (`already_refunded=true` on repeat).

## Operational Queries
```sql
-- All billing events for a job
select *
from public.billing_ledger
where job_id = :job_id
order by created_at asc;

-- All billing events for a user
select *
from public.billing_ledger
where user_id = :user_id
order by created_at asc;

-- Detect request_id cardinality violations
select request_id, kind, count(*)
from public.billing_ledger
group by request_id, kind
having count(*) > 1;

-- Current user balance (if user_balance table used)
select *
from public.user_balance
where user_id = :user_id;
```

## Source Files
- SQL migration: `supabase/migrations/20260304170000_billing_ledger.sql`
- Billing adapter: `backend/src/billing/billing.supabase.js`
- Job integration: `backend/src/routes/jobs.routes.js`
