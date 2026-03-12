import { createJobExecutor } from "../backend/src/jobs/job.executor.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
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

function createInMemoryDeps({ initialJob, engineMetrics, disableGate = false }) {
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
  let outputSaveCount = 0;

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
      outputSaveCount += 1;
      return `out/${jobId}.pdf`;
    }
  };

  const billingAdapter = {
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
  };

  const deps = {
    executeJob: createJobExecutor({
      jobs,
      storage,
      providerAdapter: {
        getRoutingSnapshot() {
          return {
            mode_b: {
              configured_order: ["groq"],
              resolved_order: ["groq"],
              exclusions: [],
              selection_reason: "test_snapshot"
            }
          };
        }
      },
      billingAdapter,
      engineAdapter: {
        async validateRuntime() {
          return {
            ok: true,
            python_executable: "py312",
            python_version: "3.12.6",
            required_python: "3.12"
          };
        },
        async translatePdf() {
          return {
            ok: true,
            engine_used: "babeldoc",
            outputBuffer: Buffer.from("%PDF\ntranslated"),
            metrics: {
              page_count: 2,
              overflow_flag: false,
              ...engineMetrics
            }
          };
        }
      },
      outputCache: null,
      featureFlags: {
        disableLayoutPipeline: false,
        disableTranslationCache: false,
        disableStrictQualityGate: false
      },
      stats: {}
    }),
    async run() {
      return withEnv(
        {
          LV_MODE_B_ENGINE: "external",
          LV_MODE_B_ENFORCE_TRANSLATION_REALITY: disableGate ? "0" : "1"
        },
        async () =>
          deps.executeJob({
            jobId: initialJob.id,
            workerId: "w-1",
            requestId: initialJob.billing?.request_id || "req-1"
          })
      );
    },
    getEvents() {
      return events.slice();
    },
    getOutputSaveCount() {
      return outputSaveCount;
    },
    async getJob() {
      return jobs.get(initialJob.id);
    }
  };
  return deps;
}

async function testGateFailsOnHeavySourceResidue() {
  const deps = createInMemoryDeps({
    initialJob: {
      id: "job-trg-1",
      owner_id: "owner",
      provider_mode: "MODE_B",
      mode: "readable",
      package_name: "pro",
      source_lang: "de",
      target_lang: "tr",
      input_file_path: "in/doc.pdf",
      status: "PENDING",
      billing: { request_id: "req-trg-1" }
    },
    engineMetrics: {
      copied_source_segments_total: 6,
      source_output_token_overlap_ratio: 0.49,
      source_output_trigram_jaccard: 0.4
    }
  });

  const result = await deps.run();
  assert(result.ok === false, "expected gate to fail job on high copied source segments");
  assert(result.error === "MODE_B_TRANSLATION_REALITY_FAILED", `unexpected error: ${result.error}`);
  const job = await deps.getJob();
  assert(job.status === "FAILED", "job should be FAILED");
  assert(job.billing.refunded === true, "charged job failed by gate should be refunded");
  assert(deps.getOutputSaveCount() === 0, "no output artifact should be saved on gate failure");
  const events = deps.getEvents();
  assert(events.some((e) => e.state === "ENGINE_RUN_FAILED"), "missing ENGINE_RUN_FAILED event");
  assert(events.some((e) => e.state === "BILLING_REFUNDED"), "missing BILLING_REFUNDED event");
}

async function testGateToggleAllowsDebugBypass() {
  const deps = createInMemoryDeps({
    initialJob: {
      id: "job-trg-2",
      owner_id: "owner",
      provider_mode: "MODE_B",
      mode: "readable",
      package_name: "pro",
      source_lang: "de",
      target_lang: "tr",
      input_file_path: "in/doc.pdf",
      status: "PENDING",
      billing: { request_id: "req-trg-2" }
    },
    engineMetrics: {
      copied_source_segments_total: 6,
      source_output_token_overlap_ratio: 0.49,
      source_output_trigram_jaccard: 0.4
    },
    disableGate: true
  });

  const result = await deps.run();
  assert(result.ok === true, "gate bypass should allow READY");
  const job = await deps.getJob();
  assert(job.status === "READY", "job should be READY when gate is disabled");
  assert(deps.getOutputSaveCount() === 1, "output artifact should be saved when gate disabled");
}

async function main() {
  const notes = [];
  try {
    await testGateFailsOnHeavySourceResidue();
    notes.push("PASS heavy copied-source residue fails external READY and triggers refund semantics");
    await testGateToggleAllowsDebugBypass();
    notes.push("PASS gate can be explicitly disabled for controlled debugging");
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
