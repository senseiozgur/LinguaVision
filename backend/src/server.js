import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createJobsRouter } from "./routes/jobs.routes.js";
import { JobStore } from "./jobs/job.store.js";
import { LocalStorage } from "./storage/local.storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const jobs = new JobStore();
const storage = new LocalStorage(path.resolve(__dirname, "../storage-data"));

app.use("/jobs", createJobsRouter({ jobs, storage }));

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`LinguaVision backend listening on :${port}`);
});
