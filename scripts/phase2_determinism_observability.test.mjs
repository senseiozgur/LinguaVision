import { createProviderAdapter } from "../backend/src/providers/provider.adapter.js";
import { createJobExecutor } from "../backend/src/jobs/job.executor.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function createInMemoryDeps({ initialJob, providerAdapter, billingAdapter, engineAdapter }) {
  let job = {
    ...initialJob,
    billing: {
      request_id: initialJob?.billing?.request_id || "req-1",
      billing_request_id: null,
      charged_units: 0,
      charged: false,
      refunded: false,
      charge_state: "NOT_CHARGED"
    }
  };
  const events = [];
  const outputs = new Map();
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
      const p = `out/${jobId}.pdf`;
      outputs.set(p, Buffer.from(outputBuffer));
      return p;
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

async function testDeterministicRoutingSnapshot() {
  const modeBRegistry = {
    openai: {
      enabled: true,
      async translateTextChunks() {
        return { ok: false, error: "PROVIDER_TIMEOUT" };
      }
    },
    groq: {
      enabled: true,
      async translateTextChunks({ chunks }) {
        return {
          ok: true,
          translatedChunks: chunks.map((c) => ({ ...c, translatedText: `[tr] ${c.text}` }))
        };
      }
    }
  };

  const adapter = createProviderAdapter({
    disableTranslationCache: true,
    modeBProviderOrder: "openai,groq",
    modeBProviderRegistryOverride: modeBRegistry
  });

  const chunks = [
    { index: 0, text: "foo" },
    { index: 1, text: "bar" }
  ];
  const run1 = await adapter.translateTextChunks({
    chunks,
    sourceLang: "de",
    targetLang: "tr",
    executionMode: "MODE_B"
  });
  const run2 = await adapter.translateTextChunks({
    chunks,
    sourceLang: "de",
    targetLang: "tr",
    executionMode: "MODE_B"
  });

  assert(run1.ok && run2.ok, "deterministic routing test expected success");
  assert(run1.provider_used === "groq", `expected groq fallback success, got ${run1.provider_used}`);
  assert(run2.provider_used === "groq", `expected groq fallback success second run, got ${run2.provider_used}`);
  assert(
    JSON.stringify(run1.routing?.resolved_order || []) === JSON.stringify(run2.routing?.resolved_order || []),
    "resolved provider order must be deterministic"
  );
  assert(
    (run1.provider_attempts || []).some((a) => a.reason_for_attempt?.includes("fallback_after_provider_timeout")),
    "fallback reason chain should be explicit in attempts"
  );
}

async function testExecutorEmitsDeterministicAttemptEvents() {
  const providerAdapter = {
    getRoutingSnapshot() {
      return {
        mode_b: {
          configured_order: ["openai", "groq"],
          resolved_order: ["openai", "groq"],
          exclusions: [],
          selection_reason: "env_order_filtered_by_enabled_providers"
        }
      };
    },
    async translateTextChunks() {
      return {
        ok: true,
        provider_used: "groq",
        translatedChunks: [{ index: 0, translatedText: "merhaba" }],
        routing: {
          configured_order: ["openai", "groq"],
          resolved_order: ["openai", "groq"],
          exclusions: [],
          selection_reason: "env_order_filtered_by_enabled_providers"
        },
        provider_attempts: [
          {
            provider: "openai",
            attempt_index: 1,
            reason_for_attempt: "primary_provider_in_resolved_order",
            status: "failed",
            error_code: "PROVIDER_TIMEOUT"
          },
          {
            provider: "groq",
            attempt_index: 2,
            reason_for_attempt: "fallback_after_provider_timeout",
            status: "success"
          }
        ]
      };
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
      throw new Error("refund should not be called on successful run");
    }
  };

  const deps = createInMemoryDeps({
    initialJob: {
      id: "job-det-1",
      owner_id: "owner",
      provider_mode: "MODE_B",
      mode: "readable",
      package_name: "pro",
      source_lang: "de",
      target_lang: "tr",
      input_file_path: "in/doc.pdf",
      status: "PENDING",
      billing: { request_id: "req-det-1" }
    },
    providerAdapter,
    billingAdapter,
    engineAdapter: {
      async translatePdf() {
        throw new Error("external path should not be used in this test");
      }
    }
  });

  const result = await deps.executeJob({
    jobId: "job-det-1",
    workerId: "w-1",
    requestId: "req-det-1"
  });
  assert(result.ok === true, "executor deterministic attempt event test expected success");

  const events = deps.getEvents();
  assert(events.some((e) => e.state === "ENGINE_SELECTED"), "missing ENGINE_SELECTED");
  assert(events.some((e) => e.state === "PROVIDER_ATTEMPT_STARTED"), "missing PROVIDER_ATTEMPT_STARTED");
  assert(events.some((e) => e.state === "PROVIDER_ATTEMPT_FINISHED"), "missing PROVIDER_ATTEMPT_FINISHED");
  const selected = events.find((e) => e.state === "ENGINE_SELECTED");
  assert(selected?.meta?.selection_reason, "ENGINE_SELECTED should include selection reason");
  const finished = events.filter((e) => e.state === "PROVIDER_ATTEMPT_FINISHED");
  assert(finished.some((e) => e.meta?.normalized_error_class === "PROVIDER_TIMEOUT"), "missing normalized timeout class");
}

async function main() {
  const notes = [];
  try {
    await testDeterministicRoutingSnapshot();
    notes.push("PASS provider adapter routing order and fallback reason are deterministic");
    await testExecutorEmitsDeterministicAttemptEvents();
    notes.push("PASS job executor emits ENGINE_SELECTED + PROVIDER_ATTEMPT_* events with normalized classes");
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
