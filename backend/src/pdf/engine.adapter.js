import { createBabelDocEngine } from "./engine.babeldoc.js";

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function createEngineAdapter() {
  const babeldoc = createBabelDocEngine();
  const maxConcurrency = parsePositiveInt(process.env.LV_MODE_B_ENGINE_MAX_CONCURRENCY || 1, 1);
  let active = 0;
  const queue = [];

  async function acquireSlot() {
    if (active < maxConcurrency) {
      active += 1;
      return;
    }
    await new Promise((resolve) => queue.push(resolve));
    active += 1;
  }

  function releaseSlot() {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) next();
  }

  return {
    async validateRuntime() {
      return babeldoc.validateRuntime();
    },
    async translatePdf({ inputBuffer, sourceLang, targetLang, options = {} }) {
      await acquireSlot();
      try {
        return await babeldoc.translatePdf({
          inputBuffer,
          sourceLang,
          targetLang,
          options: {
            ...options,
            concurrency: {
              max: maxConcurrency,
              active
            }
          }
        });
      } finally {
        releaseSlot();
      }
    }
  };
}

