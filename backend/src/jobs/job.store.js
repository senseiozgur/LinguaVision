export class JobStore {
  constructor() {
    this.jobs = new Map();
    this.nextId = 1;
  }

  create(input) {
    const id = `job_${this.nextId++}`;
    const now = new Date().toISOString();
    const record = {
      id,
      status: "PENDING",
      progress_pct: 0,
      created_at: now,
      error_code: null,
      input_file_path: input.input_file_path,
      output_file_path: null,
      source_lang: input.source_lang || null,
      target_lang: input.target_lang,
      billing: {
        request_id: null,
        billing_request_id: null,
        charged_units: 0,
        charged: false,
        refunded: false
      }
    };

    this.jobs.set(id, record);
    return record;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  update(id, patch) {
    const existing = this.jobs.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    if (patch.billing) {
      next.billing = { ...existing.billing, ...patch.billing };
    }
    this.jobs.set(id, next);
    return next;
  }
}
