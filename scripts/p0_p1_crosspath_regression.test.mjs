import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createJobExecutor } from "../backend/src/jobs/job.executor.js";
import { createSupabaseBillingAdapter } from "../backend/src/billing/billing.supabase.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function createInMemoryDeps({ initialJob, billingAdapter, providerAdapter, engineAdapter }) {
  const events = [];
  const outputFiles = new Map();
  let job = {
    ...initialJob,
    billing: {
      request_id: initialJob?.billing?.request_id || "req-1",
      billing_request_id: initialJob?.billing?.billing_request_id || null,
      charged_units: Number(initialJob?.billing?.charged_units || 0),
      charged: Boolean(initialJob?.billing?.charged),
      refunded: Boolean(initialJob?.billing?.refunded),
      charge_state: initialJob?.billing?.charge_state || "NOT_CHARGED",
      refund_retry_count: Number(initialJob?.billing?.refund_retry_count || 0),
      next_refund_retry_at: initialJob?.billing?.next_refund_retry_at || null,
      last_refund_error_code: initialJob?.billing?.last_refund_error_code || null,
      refund_last_attempt_at: initialJob?.billing?.refund_last_attempt_at || null
    }
  };

  const jobs = {
    async get(id) {
      if (id !== job.id) return null;
      return JSON.parse(JSON.stringify(job));
    },
    async update(id, patch) {
      if (id !== job.id) return null;
      const mergedBilling = patch.billing ? { ...job.billing, ...patch.billing } : job.billing;
      job = {
        ...job,
        ...patch,
        billing: mergedBilling
      };
      return JSON.parse(JSON.stringify(job));
    },
    async appendJobEvent(jobId, ownerId, state, meta) {
      events.push({ job_id: jobId, owner_id: ownerId, state, meta: meta || null });
    }
  };

  const storage = {
    async readFile(inputPath) {
      if (inputPath !== job.input_file_path) throw new Error("missing_input");
      return Buffer.from("%PDF\n%fake");
    },
    async saveOutput(jobId, outputBuffer) {
      const outPath = `out/${jobId}.pdf`;
      outputFiles.set(outPath, Buffer.from(outputBuffer));
      return outPath;
    },
    async readOutput(pathKey) {
      return outputFiles.get(pathKey) || null;
    }
  };

  const stats = {};

  const deps = {
    jobs,
    storage,
    providerAdapter,
    outputCache: null,
    cacheKeyOptions: {
      modeAProviderOrder: "deepl,google",
      modeBProviderOrder: "deepl_text,google_text,openai,groq",
      modeAOutputVersion: "mode_a_pdf_direct_v1",
      modeBOutputVersion: "mode_b_layout_v2"
    },
    featureFlags: {
      disableLayoutPipeline: false,
      disableTranslationCache: false,
      disableStrictQualityGate: false
    },
    billingAdapter,
    stats,
    engineAdapter
  };

  return {
    executeJob: createJobExecutor(deps),
    getJob: async () => jobs.get(job.id),
    events,
    storage
  };
}

async function testDailyCapRpcPath() {
  const migrationPath = path.resolve(repoRoot, "supabase/migrations/20260311110000_billing_daily_cap.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  assert(migrationSql.includes("rpc_charge_units"), "daily cap migration must patch rpc_charge_units");
  assert(migrationSql.includes("DAILY_CAP_EXCEEDED"), "daily cap migration must raise DAILY_CAP_EXCEEDED");

  const mockSupabase = {
    async rpc(fn, _payload) {
      if (fn === "rpc_charge_units") {
        return { data: null, error: { message: "DAILY_CAP_EXCEEDED" } };
      }
      return { data: null, error: { message: "unexpected rpc" } };
    }
  };
  const billingAdapter = createSupabaseBillingAdapter({ supabase: mockSupabase });

  const initialJob = {
    id: "job-daily-cap",
    owner_id: "owner",
    user_id: null,
    package_name: "free",
    mode: "readable",
    provider_mode: "MODE_A",
    source_lang: "en",
    target_lang: "tr",
    input_file_path: "in/job-daily-cap.pdf",
    status: "PENDING",
    billing: { request_id: "req-daily-cap" }
  };

  const providerAdapter = {
    async translateDocument() {
      throw new Error("provider should not be called after charge denial");
    }
  };

  const { executeJob, getJob } = createInMemoryDeps({
    initialJob,
    billingAdapter,
    providerAdapter,
    engineAdapter: { async translatePdf() { throw new Error("external should not run"); } }
  });

  const result = await executeJob({
    jobId: initialJob.id,
    workerId: "w-1",
    requestId: "req-daily-cap"
  });

  const finalJob = await getJob();
  assert(result.ok === false, "daily cap run should fail");
  assert(result.error === "BILLING_DAILY_CAP_EXCEEDED", `expected mapped error got ${result.error}`);
  assert(finalJob.status === "FAILED", `daily cap final status expected FAILED got ${finalJob.status}`);
  assert(finalJob.error_code === "BILLING_DAILY_CAP_EXCEEDED", "final error code should be propagated");
}

async function testRefundAfterDownstreamFailure() {
  let charged = false;
  let refunded = false;
  const billingAdapter = {
    async charge({ request_id, units }) {
      charged = true;
      return {
        billing_request_id: `bill_${request_id}`,
        charged_units: Number(units || 0),
        already_charged: false
      };
    },
    async refund({ request_id }) {
      refunded = true;
      return {
        refund_billing_request_id: `refund_${request_id}`,
        refunded: true,
        already_refunded: false
      };
    }
  };

  const initialJob = {
    id: "job-refund",
    owner_id: "owner",
    user_id: null,
    package_name: "pro",
    mode: "readable",
    provider_mode: "MODE_A",
    source_lang: "en",
    target_lang: "tr",
    input_file_path: "in/job-refund.pdf",
    status: "PENDING",
    billing: { request_id: "req-refund" }
  };

  const providerAdapter = {
    async translateDocument() {
      return {
        ok: false,
        error: "PROVIDER_TIMEOUT",
        provider_used: "deepl"
      };
    }
  };

  const { executeJob, getJob, events } = createInMemoryDeps({
    initialJob,
    billingAdapter,
    providerAdapter,
    engineAdapter: { async translatePdf() { throw new Error("external should not run"); } }
  });

  const result = await executeJob({
    jobId: initialJob.id,
    workerId: "w-1",
    requestId: "req-refund"
  });

  const finalJob = await getJob();
  assert(result.ok === false, "downstream failure should fail the job");
  assert(charged === true, "charge should succeed before downstream failure");
  assert(refunded === true, "refund should be attempted after downstream failure");
  assert(finalJob.status === "FAILED", `expected FAILED got ${finalJob.status}`);
  assert(finalJob.billing.refunded === true, "billing.refunded should be true");
  assert(
    ["REFUNDED", "REFUND_PENDING", "REFUND_RETRYING", "REFUND_FAILED_FINAL"].includes(finalJob.billing.charge_state),
    `refund state must be explicit, got ${finalJob.billing.charge_state}`
  );
  assert(!finalJob.output_file_path, "failed job should not leave success artifact path");
  assert(events.some((e) => e.state === "BILLING_CHARGED"), "missing BILLING_CHARGED event");
  assert(events.some((e) => e.state === "BILLING_REFUNDED"), "missing BILLING_REFUNDED event");
  assert(events.some((e) => e.state === "JOB_FAILED"), "missing JOB_FAILED event");
}

async function testModeBExternalStillWorks() {
  const prev = process.env.LV_MODE_B_ENGINE;
  process.env.LV_MODE_B_ENGINE = "external";

  try {
    const billingAdapter = {
      async charge({ request_id, units }) {
        return {
          billing_request_id: `bill_${request_id}`,
          charged_units: Number(units || 0),
          already_charged: false
        };
      },
      async refund() {
        throw new Error("refund should not be called on successful external flow");
      }
    };

    const initialJob = {
      id: "job-external",
      owner_id: "owner",
      user_id: null,
      package_name: "pro",
      mode: "readable",
      provider_mode: "MODE_B",
      source_lang: "en",
      target_lang: "tr",
      input_file_path: "in/job-external.pdf",
      status: "PENDING",
      billing: { request_id: "req-external" }
    };

    const providerAdapter = {
      async translateTextChunks() {
        throw new Error("custom MODE_B path should not be used when LV_MODE_B_ENGINE=external");
      }
    };

    const engineAdapter = {
      async translatePdf() {
        return {
          ok: true,
          engine_used: "babeldoc",
          outputBuffer: Buffer.from("%PDF\n%external"),
          metrics: { page_count: 1, overflow_flag: false }
        };
      }
    };

    const { executeJob, getJob, events, storage } = createInMemoryDeps({
      initialJob,
      billingAdapter,
      providerAdapter,
      engineAdapter
    });

    const result = await executeJob({
      jobId: initialJob.id,
      workerId: "w-1",
      requestId: "req-external"
    });

    const finalJob = await getJob();
    assert(result.ok === true, "external mode-b run should succeed");
    assert(finalJob.status === "READY", `expected READY got ${finalJob.status}`);
    assert(finalJob.provider_used === "babeldoc", `expected provider_used babeldoc got ${finalJob.provider_used}`);
    assert(finalJob.output_file_path, "READY job should have output path");
    const out = await storage.readOutput(finalJob.output_file_path);
    assert(Buffer.isBuffer(out) && out.length > 0, "output artifact must be readable from storage");
    assert(events.some((e) => e.state === "ENGINE_RUN_STARTED"), "missing ENGINE_RUN_STARTED event");
    assert(events.some((e) => e.state === "ENGINE_RUN_SUCCEEDED"), "missing ENGINE_RUN_SUCCEEDED event");
  } finally {
    if (prev === undefined) delete process.env.LV_MODE_B_ENGINE;
    else process.env.LV_MODE_B_ENGINE = prev;
  }
}

async function main() {
  const notes = [];
  try {
    await testDailyCapRpcPath();
    notes.push("PASS daily-cap SQL+RPC adapter mapping+error propagation path validated");

    await testRefundAfterDownstreamFailure();
    notes.push("PASS charge-success downstream-fail triggers explicit refund state + FAILED terminal");

    await testModeBExternalStillWorks();
    notes.push("PASS MODE_B external path remains operational after P0/P1 changes");

    console.log("PASS");
    for (const n of notes) console.log(`- ${n}`);
    process.exitCode = 0;
  } catch (err) {
    console.log("FAIL");
    console.log(`- ${err.message}`);
    process.exitCode = 1;
  }
}

await main();
