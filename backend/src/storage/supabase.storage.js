import { createClient } from "@supabase/supabase-js";

const INPUT_BUCKET = "pdf-input";
const OUTPUT_BUCKET = "pdf-output";

function normalizeBuffer(bytes) {
  if (!bytes) return Buffer.alloc(0);
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  return Buffer.from(bytes);
}

function toStoragePath(bucket, key) {
  return `sb://${bucket}/${key}`;
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isValidPrivilegedKey(key) {
  if (!key) return false;
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("sb_publishable_")) return false;
  const payload = decodeJwtPayload(key);
  return payload?.role === "service_role";
}

function parseStoragePath(filePath) {
  const prefix = "sb://";
  if (!filePath || !filePath.startsWith(prefix)) {
    throw new Error("STORAGE_INVALID_PATH");
  }
  const raw = filePath.slice(prefix.length);
  const slash = raw.indexOf("/");
  if (slash <= 0) {
    throw new Error("STORAGE_INVALID_PATH");
  }
  return {
    bucket: raw.slice(0, slash),
    key: raw.slice(slash + 1)
  };
}

export class SupabaseStorage {
  constructor({ supabase, inputBucket = INPUT_BUCKET, outputBucket = OUTPUT_BUCKET }) {
    this.supabase = supabase;
    this.inputBucket = inputBucket;
    this.outputBucket = outputBucket;
  }

  static fromEnv(env = process.env) {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("STORAGE_CONFIG_ERROR: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are required");
    }
    if (!isValidPrivilegedKey(key)) {
      throw new Error("STORAGE_CONFIG_ERROR: SUPABASE_SERVICE_ROLE_KEY must be sb_secret_* or legacy service_role JWT");
    }
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return new SupabaseStorage({ supabase });
  }

  async saveInput(jobId, fileName, bytes) {
    const safe = (fileName || "input.pdf").replace(/[^a-zA-Z0-9_.-]/g, "_");
    const key = `${jobId}/${Date.now()}-${safe}`;
    const payload = normalizeBuffer(bytes);
    const { error } = await this.supabase.storage.from(this.inputBucket).upload(key, payload, {
      contentType: "application/pdf",
      upsert: false
    });
    if (error) throw new Error(`STORAGE_UPLOAD_ERROR: ${error.message}`);
    return toStoragePath(this.inputBucket, key);
  }

  async saveOutput(jobId, bytes) {
    const key = `${jobId}/output.pdf`;
    const payload = normalizeBuffer(bytes);
    const { error } = await this.supabase.storage.from(this.outputBucket).upload(key, payload, {
      contentType: "application/pdf",
      upsert: true
    });
    if (error) throw new Error(`STORAGE_UPLOAD_ERROR: ${error.message}`);
    return toStoragePath(this.outputBucket, key);
  }

  async readFile(filePath) {
    const { bucket, key } = parseStoragePath(filePath);
    const { data, error } = await this.supabase.storage.from(bucket).download(key);
    if (error) throw new Error(`STORAGE_DOWNLOAD_ERROR: ${error.message}`);
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  }
}
