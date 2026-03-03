import fs from "fs/promises";
import path from "path";

export class LocalStorage {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async saveInput(jobId, fileName, bytes) {
    const dir = path.join(this.rootDir, "input");
    await fs.mkdir(dir, { recursive: true });
    const safe = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = path.join(dir, `${jobId}-${safe}`);
    await fs.writeFile(filePath, bytes);
    return filePath;
  }

  async saveOutput(jobId, bytes) {
    const dir = path.join(this.rootDir, "output");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${jobId}.pdf`);
    await fs.writeFile(filePath, bytes);
    return filePath;
  }

  async readFile(filePath) {
    return fs.readFile(filePath);
  }
}
