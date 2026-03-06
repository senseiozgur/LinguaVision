import fs from "fs";
import path from "path";

export class TranslationCache {
  constructor({ maxEntries = 200, persistPath = null } = {}) {
    this.maxEntries = Number.isFinite(Number(maxEntries)) ? Math.max(1, Number(maxEntries)) : 200;
    this.persistPath = persistPath || null;
    this.map = new Map();
    this.stats = {
      cache_hits_total: 0,
      cache_misses_total: 0,
      cache_evictions_total: 0,
      cache_persist_load_total: 0,
      cache_persist_save_total: 0
    };

    this.loadFromDisk();
  }

  loadFromDisk() {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

    try {
      const raw = fs.readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      for (const e of entries.slice(0, this.maxEntries)) {
        if (!e?.key || typeof e?.output_b64 !== "string") continue;
        this.map.set(e.key, {
          outputBuffer: Buffer.from(e.output_b64, "base64"),
          layoutMetrics: e.layout_metrics || null,
          meta: e.meta || null
        });
      }
      this.stats.cache_persist_load_total += 1;
    } catch {
      // Corrupt cache file should not block service start.
    }
  }

  saveToDisk() {
    if (!this.persistPath) return;

    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const entries = [];
      for (const [key, value] of this.map.entries()) {
        entries.push({
          key,
          output_b64: value.outputBuffer.toString("base64"),
          layout_metrics: value.layoutMetrics || null,
          meta: value.meta || null
        });
      }
      fs.writeFileSync(this.persistPath, JSON.stringify({ entries }), "utf8");
      this.stats.cache_persist_save_total += 1;
    } catch {
      // Persist write errors are tolerated to keep runtime serving.
    }
  }

  get(key) {
    if (!this.map.has(key)) {
      this.stats.cache_misses_total += 1;
      return null;
    }

    const value = this.map.get(key);
    // LRU refresh
    this.map.delete(key);
    this.map.set(key, value);
    this.stats.cache_hits_total += 1;
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, value);

    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
      this.stats.cache_evictions_total += 1;
    }

    this.saveToDisk();
  }

  metrics() {
    return {
      ...this.stats,
      cache_entries: this.map.size,
      cache_max_entries: this.maxEntries,
      cache_persist_enabled: Boolean(this.persistPath)
    };
  }
}
