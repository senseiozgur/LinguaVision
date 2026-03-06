import { TranslationCache } from "../providers/translation.cache.js";

export function createOutputCache({ maxEntries = 200, persistPath = null } = {}) {
  // Stage-9 retention note: cache is bounded by maxEntries; no time-based eviction yet.
  const cache = new TranslationCache({ maxEntries, persistPath });

  return {
    get(key) {
      return cache.get(key);
    },
    set(key, value) {
      cache.set(key, {
        outputBuffer: value.outputBuffer,
        layoutMetrics: value.layoutMetrics || null,
        meta: value.meta || null
      });
    },
    metrics() {
      return cache.metrics();
    }
  };
}
