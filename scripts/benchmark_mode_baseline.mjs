import { performance } from "perf_hooks";
import { estimateStepUnits } from "../backend/src/routing/cost.guard.js";
import { createProviderAdapter } from "../backend/src/providers/provider.adapter.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runMode(adapter, { mode, iterations, inputBuffer }) {
  const latencies = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    const out = await adapter.translateDocument({
      inputBuffer,
      tier: "standard",
      mode,
      sourceLang: "en",
      targetLang: "tr",
      jobId: `${mode}_${i}`
    });
    const ended = performance.now();
    assert(out.ok === true, `${mode} translate should succeed`);
    latencies.push(ended - started);
  }

  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95 = [...latencies].sort((a, b) => a - b)[Math.max(0, Math.floor(latencies.length * 0.95) - 1)];
  return {
    avg_ms: Number(avg.toFixed(2)),
    p95_ms: Number(p95.toFixed(2))
  };
}

async function main() {
  const iterations = 20;
  const fileSizeBytes = 3 * 1024 * 1024;
  const inputBuffer = Buffer.alloc(fileSizeBytes, 0x20);
  inputBuffer[0] = 0x25;
  inputBuffer[1] = 0x50;
  inputBuffer[2] = 0x44;
  inputBuffer[3] = 0x46;

  const readableUnits = estimateStepUnits({ fileSizeBytes, mode: "readable" });
  const strictUnits = estimateStepUnits({ fileSizeBytes, mode: "strict" });

  const adapter = createProviderAdapter({
    cachePersistPath: null,
    disableTranslationCache: true
  });

  const readablePerf = await runMode(adapter, { mode: "readable", iterations, inputBuffer });
  const strictPerf = await runMode(adapter, { mode: "strict", iterations, inputBuffer });

  assert(strictUnits > readableUnits, "strict units should be greater than readable");
  assert(readablePerf.avg_ms >= 0 && strictPerf.avg_ms >= 0, "latencies should be non-negative");

  const deltaUnits = strictUnits - readableUnits;
  const ratio = Number((strictUnits / readableUnits).toFixed(2));

  console.log("PASS");
  console.log("AUDIT SUMMARY:");
  console.log(`- PASS readable units=${readableUnits}`);
  console.log(`- PASS strict units=${strictUnits}`);
  console.log(`- PASS strict-readable delta_units=${deltaUnits} ratio=${ratio}x`);
  console.log(`- PASS readable avg_ms=${readablePerf.avg_ms} p95_ms=${readablePerf.p95_ms}`);
  console.log(`- PASS strict avg_ms=${strictPerf.avg_ms} p95_ms=${strictPerf.p95_ms}`);
}

await main();
