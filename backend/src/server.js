import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createJobsRouter } from "./routes/jobs.routes.js";
import { JobStore } from "./jobs/job.store.js";
import { JobQueue } from "./jobs/job.queue.js";
import { LocalStorage } from "./storage/local.storage.js";
import { createProviderAdapter } from "./providers/provider.adapter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const jobs = new JobStore();
const storage = new LocalStorage(path.resolve(__dirname, "../storage-data"));
const cacheMaxEntries = Number(process.env.TRANSLATION_CACHE_MAX || 200);
const cachePersistPath =
  process.env.TRANSLATION_CACHE_PERSIST === "0"
    ? null
    : path.resolve(__dirname, "../storage-data/translation-cache.json");
const providerAdapter = createProviderAdapter({ cacheMaxEntries, cachePersistPath });

const shared = { jobs, storage, providerAdapter };
const queue = new JobQueue({
  processFn: async (payload) => {
    if (!shared.processJob) return;
    await shared.processJob(payload);
  }
});
queue.start();

shared.queue = queue;
app.use("/jobs", createJobsRouter(shared));

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`LinguaVision backend listening on :${port}`);
});
