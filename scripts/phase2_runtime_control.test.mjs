import { createEngineAdapter } from "../backend/src/pdf/engine.adapter.js";
import { createJobExecutor } from "../backend/src/jobs/job.executor.js";
import path from "path";
import { fileURLToPath } from "url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function withEnv(pairs, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(pairs)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = String(v);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const python312Path = path.resolve(repoRoot, ".venv-babeldoc312", "Scripts", "python.exe");

function createInMemoryDeps({ initialJob, providerAdapter, billingAdapter, engineAdapter }) {
  let job = {
    ...initialJob,
    billing: {
      request_id: initialJob?.billing?.request_id || "req-1",
      billing_request_id: null,
      charged_units: 0,
      charged: false,
      refunded: false,
      charge_state: "NOT_CHARGED",
      refund_retry_count: 0
    }
  };
  const events = [];
  const jobs = {
    async get(id) {
      if (id !== job.id) return null;
      return JSON.parse(JSON.stringify(job));
    },
    async update(id, patch) {
      if (id !== job.id) return null;
      job = {
        ...job,
        ...patch,
        billing: patch.billing ? { ...job.billing, ...patch.billing } : job.billing
      };
      return JSON.parse(JSON.stringify(job));
    },
    async appendJobEvent(jobId, ownerId, state, meta) {
      events.push({ job_id: jobId, owner_id: ownerId, state, meta: meta || null });
    }
  };
  const storage = {
    async readFile() {
      return Buffer.from("%PDF\nfake");
    },
    async saveOutput(jobId, outputBuffer) {
      return `out/${jobId}.pdf`;
    }
  };
  return {
    executeJob: createJobExecutor({
      jobs,
      storage,
      providerAdapter,
      billingAdapter,
      engineAdapter,
      outputCache: null,
      featureFlags: {
        disableLayoutPipeline: false,
        disableTranslationCache: false,
        disableStrictQualityGate: false
      },
      stats: {}
    }),
    getEvents() {
      return events.slice();
    },
    async getJob() {
      return jobs.get(job.id);
    }
  };
}

async function testRuntimeValidationAndVersionMismatch() {
  await withEnv(
    {
      LV_PDF_ENGINE_PYTHON: python312Path,
      LV_PDF_ENGINE_REQUIRED_PYTHON: "3.12"
    },
    async () => {
      const adapter = createEngineAdapter();
      const valid = await adapter.validateRuntime();
      assert(valid?.ok === true, "expected runtime validation ok for python 3.12");
      assert(String(valid?.python_version || "").startsWith("3.12"), "expected python version 3.12.x");
    }
  );

  await withEnv(
    {
      LV_PDF_ENGINE_PYTHON: python312Path,
      LV_PDF_ENGINE_REQUIRED_PYTHON: "3.11"
    },
    async () => {
      const adapter = createEngineAdapter();
      const invalid = await adapter.validateRuntime();
      assert(invalid?.ok === false, "expected runtime mismatch to fail");
      assert(invalid?.runtime_error_class === "ENGINE_RUNTIME_VERSION_MISMATCH", "expected version mismatch class");
    }
  );
}

async function testInvalidRuntimeEventAndRefundSemantics() {
  const deps = createInMemoryDeps({
    initialJob: {
      id: "job-rt-1",
      owner_id: "owner",
      provider_mode: "MODE_B",
      mode: "readable",
      package_name: "pro",
      source_lang: "de",
      target_lang: "tr",
      input_file_path: "in/doc.pdf",
      status: "PENDING",
      billing: { request_id: "req-rt-1" }
    },
    providerAdapter: {
      getRoutingSnapshot() {
        return { mode_b: { configured_order: ["groq"], resolved_order: ["groq"], exclusions: [], selection_reason: "test" } };
      }
    },
    billingAdapter: {
      async charge({ request_id, units }) {
        return {
          billing_request_id: `bill_${request_id}`,
          charged_units: Number(units || 0),
          already_charged: false
        };
      },
      async refund() {
        return {
          refunded: true,
          already_refunded: false
        };
      }
    },
    engineAdapter: {
      async validateRuntime() {
        return {
          ok: false,
          runtime_error_class: "ENGINE_RUNTIME_VERSION_MISMATCH",
          runtime_error_detail: "required=3.12 actual=3.14",
          python_version: "3.14.2",
          required_python: "3.12"
        };
      },
      async translatePdf() {
        throw new Error("translatePdf should not run when runtime is invalid");
      }
    }
  });

  const result = await withEnv(
    {
      LV_MODE_B_ENGINE: "external"
    },
    async () =>
      deps.executeJob({
        jobId: "job-rt-1",
        workerId: "w-1",
        requestId: "req-rt-1"
      })
  );
  assert(result.ok === false, "runtime invalid should fail job");
  const finalJob = await deps.getJob();
  assert(finalJob.status === "FAILED", "runtime invalid should terminalize as FAILED");
  assert(finalJob.billing.refunded === true, "charged + runtime invalid should trigger refund");
  const events = deps.getEvents();
  assert(events.some((e) => e.state === "ENGINE_RUNTIME_INVALID"), "missing ENGINE_RUNTIME_INVALID event");
  assert(events.some((e) => e.state === "BILLING_REFUNDED"), "missing BILLING_REFUNDED event");
}

async function main() {
  const notes = [];
  try {
    await testRuntimeValidationAndVersionMismatch();
    notes.push("PASS runtime validation reports explicit version match/mismatch");
    await testInvalidRuntimeEventAndRefundSemantics();
    notes.push("PASS invalid runtime emits ENGINE_RUNTIME_INVALID and preserves refund semantics");
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
