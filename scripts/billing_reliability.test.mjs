import { createSupabaseBillingAdapter } from "../backend/src/billing/billing.supabase.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function createMockSupabase() {
  const charges = new Map();
  const refunds = new Map();

  return {
    async rpc(fn, payload) {
      if (fn === "rpc_charge_units") {
        const req = payload.p_request_id;
        const existing = charges.get(req);
        if (existing) {
          return {
            data: [
              {
                billing_request_id: existing.billing_request_id,
                charged_units: existing.charged_units,
                already_charged: true
              }
            ],
            error: null
          };
        }
        const row = {
          billing_request_id: `bill_${req}`,
          charged_units: Number(payload.p_units || 0)
        };
        charges.set(req, row);
        return {
          data: [
            {
              billing_request_id: row.billing_request_id,
              charged_units: row.charged_units,
              already_charged: false
            }
          ],
          error: null
        };
      }

      if (fn === "rpc_refund_units") {
        const req = payload.p_request_id;
        const key = `refund_${req}`;
        const existing = refunds.get(key);
        if (existing) {
          return {
            data: [
              {
                refund_billing_request_id: key,
                refunded: true,
                already_refunded: true
              }
            ],
            error: null
          };
        }
        refunds.set(key, true);
        return {
          data: [
            {
              refund_billing_request_id: key,
              refunded: true,
              already_refunded: false
            }
          ],
          error: null
        };
      }

      return { data: null, error: { message: `unknown rpc ${fn}` } };
    }
  };
}

async function main() {
  const notes = [];
  try {
    const adapter = createSupabaseBillingAdapter({ supabase: createMockSupabase() });
    const reqId = "req-1";

    const c1 = await adapter.charge({
      user_id: null,
      job_id: "job_1",
      request_id: reqId,
      units: 7,
      meta: { mode: "readable" }
    });
    const c2 = await adapter.charge({
      user_id: null,
      job_id: "job_1",
      request_id: reqId,
      units: 7,
      meta: { mode: "readable" }
    });
    assert(c1.already_charged === false, "first charge should not be already charged");
    assert(c2.already_charged === true, "second charge should be idempotent");
    assert(c1.billing_request_id === c2.billing_request_id, "billing_request_id should be stable");
    notes.push("PASS charge once for same request_id replay");

    const r1 = await adapter.refund({
      user_id: null,
      job_id: "job_1",
      request_id: reqId,
      billing_request_id: c1.billing_request_id,
      units: 7,
      reason: "PROVIDER_TIMEOUT",
      meta: {}
    });
    const r2 = await adapter.refund({
      user_id: null,
      job_id: "job_1",
      request_id: reqId,
      billing_request_id: c1.billing_request_id,
      units: 7,
      reason: "PROVIDER_TIMEOUT",
      meta: {}
    });
    assert(r1.refunded === true, "first refund should refund");
    assert(r2.already_refunded === true, "second refund should be idempotent");
    notes.push("PASS refund once for duplicate trigger");

    const concurrencyReq = "req-concurrency";
    const [cc1, cc2] = await Promise.all([
      adapter.charge({
        user_id: null,
        job_id: "job_2",
        request_id: concurrencyReq,
        units: 3,
        meta: {}
      }),
      adapter.charge({
        user_id: null,
        job_id: "job_2",
        request_id: concurrencyReq,
        units: 3,
        meta: {}
      })
    ]);
    const alreadyChargedCount = [cc1.already_charged, cc2.already_charged].filter(Boolean).length;
    assert(alreadyChargedCount === 1, "one of concurrent charges must be already_charged");
    assert(cc1.billing_request_id === cc2.billing_request_id, "concurrency charge must share identity");
    notes.push("PASS concurrency same request_id yields single logical charge");

    console.log("PASS");
    console.log("AUDIT SUMMARY:");
    for (const n of notes) console.log(`- ${n}`);
  } catch (err) {
    console.log("FAIL");
    console.log("AUDIT SUMMARY:");
    for (const n of notes) console.log(`- ${n}`);
    console.log(`- FAIL ${err.message}`);
    process.exitCode = 1;
  }
}

await main();
