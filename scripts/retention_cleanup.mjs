import fs from "fs/promises";
import path from "path";

const root = process.cwd();
const storageDir = path.resolve(root, "backend/storage-data");
const now = Date.now();
const inputMaxAgeDays = Number(process.env.RETENTION_INPUT_DAYS || 7);
const outputMaxAgeDays = Number(process.env.RETENTION_OUTPUT_DAYS || 30);
const cacheMaxAgeDays = Number(process.env.RETENTION_CACHE_DAYS || 30);

function cutoff(days) {
  return now - Math.max(1, days) * 24 * 60 * 60 * 1000;
}

async function cleanupDir(dir, maxAgeMs) {
  let removed = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        removed += await cleanupDir(full, maxAgeMs);
        continue;
      }
      const st = await fs.stat(full);
      if (st.mtimeMs < maxAgeMs) {
        await fs.unlink(full);
        removed += 1;
      }
    }
  } catch {
    return 0;
  }
  return removed;
}

async function cleanupFile(file, maxAgeMs) {
  try {
    const st = await fs.stat(file);
    if (st.mtimeMs < maxAgeMs) {
      await fs.unlink(file);
      return 1;
    }
  } catch {
    return 0;
  }
  return 0;
}

const removedInput = await cleanupDir(path.join(storageDir, "input"), cutoff(inputMaxAgeDays));
const removedOutput = await cleanupDir(path.join(storageDir, "output"), cutoff(outputMaxAgeDays));
const removedTranslationCache = await cleanupFile(path.join(storageDir, "translation-cache.json"), cutoff(cacheMaxAgeDays));
const removedOutputCache = await cleanupFile(path.join(storageDir, "output-cache.json"), cutoff(cacheMaxAgeDays));

console.log("RETENTION CLEANUP SUMMARY");
console.log(`input_removed=${removedInput}`);
console.log(`output_removed=${removedOutput}`);
console.log(`translation_cache_removed=${removedTranslationCache}`);
console.log(`output_cache_removed=${removedOutputCache}`);
