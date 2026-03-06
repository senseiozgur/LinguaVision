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
      last_transition_at: now,
      error_code: null,
      selected_tier: null,
      layout_metrics: null,
      translation_cache_hit: false,
      quality_gate_passed: null,
      quality_gate_reason: null,
      cost_delta_units: 0,
      ux_hint: null,
      provider_used: null,
      provider_mode: input.provider_mode || "MODE_A",
      input_file_path: input.input_file_path,
      output_file_path: null,
      owner_id: input.owner_id || null,
      source_lang: input.source_lang || null,
      target_lang: input.target_lang,
      events: [{ state: "PENDING", at: now }],
      billing: {
        request_id: null,
        billing_request_id: null,
        charged_units: 0,
        charged: false,
        refunded: false,
        charge_state: "NOT_CHARGED",
        refund_retry_count: 0,
        next_refund_retry_at: null,
        last_refund_error_code: null,
        refund_last_attempt_at: null
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
    if (patch.status && patch.status !== existing.status) {
      const now = new Date().toISOString();
      next.events = [...(existing.events || []), { state: patch.status, at: now }];
      next.last_transition_at = now;
    } else if (!next.events) {
      next.events = existing.events || [];
    }
    this.jobs.set(id, next);
    return next;
  }

  getEvents(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    return job.events || [];
  }

  appendJobEvent(id, _ownerId, eventType, meta = null) {
    const existing = this.jobs.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const next = {
      ...existing,
      events: [...(existing.events || []), { state: eventType, at: now, meta }]
    };
    this.jobs.set(id, next);
    return next.events;
  }

  async claimNextQueued(workerId = null) {
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === "QUEUED") {
        const next = this.update(id, { status: "PROCESSING", progress_pct: 30 });
        this.appendJobEvent(id, job.owner_id, "JOB_CLAIMED", { worker_id: workerId || "inmem-worker" });
        return next;
      }
    }
    return null;
  }

  async claimNextRefundRetry(workerId = null) {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      const billing = job.billing || {};
      const dueAt = billing.next_refund_retry_at ? Date.parse(billing.next_refund_retry_at) : NaN;
      if (billing.charge_state === "REFUND_PENDING" && Number.isFinite(dueAt) && dueAt <= now) {
        const next = this.update(id, {
          billing: {
            ...billing,
            charge_state: "REFUND_RETRYING"
          }
        });
        this.appendJobEvent(id, job.owner_id, "BILLING_REFUND_RETRY_CLAIMED", {
          worker_id: workerId || "inmem-worker"
        });
        return next;
      }
    }
    return null;
  }
}
