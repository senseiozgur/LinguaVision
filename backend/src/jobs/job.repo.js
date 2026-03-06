import { createClient } from "@supabase/supabase-js";

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeEvent(row) {
  return {
    id: row.id,
    state: row.event_type,
    at: toIso(row.ts),
    meta: row.meta || null
  };
}

function normalizeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status || "PENDING",
    progress_pct: Number(row.progress_pct || 0),
    created_at: toIso(row.created_at),
    last_transition_at: toIso(row.last_transition_at) || toIso(row.updated_at) || toIso(row.created_at),
    error_code: row.last_error_code || null,
    selected_tier: row.selected_tier || null,
    layout_metrics: row.layout_metrics || null,
    translation_cache_hit: Boolean(row.translation_cache_hit),
    quality_gate_passed: row.quality_gate_passed === null ? null : Boolean(row.quality_gate_passed),
    quality_gate_reason: row.quality_gate_reason || null,
    cost_delta_units: Number(row.cost_delta_units || 0),
    ux_hint: row.ux_hint || null,
    provider_used: row.provider_used || null,
    provider_mode: row.provider_mode || "MODE_A",
    input_file_path: row.input_path || "",
    output_file_path: row.output_path || null,
    owner_id: row.owner_id || null,
    source_lang: row.source_lang || null,
    target_lang: row.target_lang || null,
    package_name: row.package_name || null,
    mode: row.mode || null,
    budget_units: row.budget_units === null || row.budget_units === undefined ? null : Number(row.budget_units),
    billing: {
      request_id: row.request_id || null,
      billing_request_id: row.billing_request_id || null,
      charged_units: Number(row.charged_units || 0),
      charged: Boolean(row.charged),
      refunded: Boolean(row.refunded),
      charge_state: row.charge_state || (row.charged ? "CHARGED" : "NOT_CHARGED"),
      refund_retry_count: Number(row.refund_retry_count || 0),
      next_refund_retry_at: toIso(row.next_refund_retry_at),
      last_refund_error_code: row.last_refund_error_code || null,
      refund_last_attempt_at: toIso(row.refund_last_attempt_at)
    }
  };
}

export class JobRepository {
  constructor({ supabase }) {
    this.supabase = supabase;
  }

  static fromEnv(env = process.env) {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("JOBS_CONFIG_ERROR: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are required");
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return new JobRepository({ supabase });
  }

  async create(input) {
    const insertPayload = {
      owner_id: input.owner_id,
      status: "PENDING",
      progress_pct: 0,
      input_path: input.input_file_path || null,
      output_path: null,
      source_lang: input.source_lang || null,
      target_lang: input.target_lang || null,
      package_name: input.package_name || null,
      mode: input.mode || null,
      budget_units: input.budget_units ?? null,
      selected_tier: null,
      layout_metrics: null,
      translation_cache_hit: false,
      quality_gate_passed: null,
      quality_gate_reason: null,
      cost_delta_units: 0,
      ux_hint: null,
      provider_used: null,
      provider_mode: input.provider_mode || "MODE_A",
      last_error_code: null,
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
    };

    const { data, error } = await this.supabase.from("jobs").insert(insertPayload).select("*").single();
    if (error) throw new Error(`JOBS_DB_ERROR: ${error.message}`);

    await this.appendJobEvent(data.id, data.owner_id, "PENDING", null);
    return normalizeJob(data);
  }

  async get(id) {
    const { data, error } = await this.supabase.from("jobs").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`JOBS_DB_ERROR: ${error.message}`);
    return normalizeJob(data);
  }

  async update(id, patch) {
    const existing = await this.get(id);
    if (!existing) return null;

    const nextBilling = patch.billing ? { ...existing.billing, ...patch.billing } : existing.billing;
    const updatePayload = {};

    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.progress_pct !== undefined) updatePayload.progress_pct = patch.progress_pct;
    if (patch.input_file_path !== undefined) updatePayload.input_path = patch.input_file_path;
    if (patch.output_file_path !== undefined) updatePayload.output_path = patch.output_file_path;
    if (patch.source_lang !== undefined) updatePayload.source_lang = patch.source_lang;
    if (patch.target_lang !== undefined) updatePayload.target_lang = patch.target_lang;
    if (patch.package_name !== undefined) updatePayload.package_name = patch.package_name;
    if (patch.mode !== undefined) updatePayload.mode = patch.mode;
    if (patch.budget_units !== undefined) updatePayload.budget_units = patch.budget_units;
    if (patch.error_code !== undefined) updatePayload.last_error_code = patch.error_code;
    if (patch.selected_tier !== undefined) updatePayload.selected_tier = patch.selected_tier;
    if (patch.layout_metrics !== undefined) updatePayload.layout_metrics = patch.layout_metrics;
    if (patch.translation_cache_hit !== undefined) updatePayload.translation_cache_hit = patch.translation_cache_hit;
    if (patch.quality_gate_passed !== undefined) updatePayload.quality_gate_passed = patch.quality_gate_passed;
    if (patch.quality_gate_reason !== undefined) updatePayload.quality_gate_reason = patch.quality_gate_reason;
    if (patch.cost_delta_units !== undefined) updatePayload.cost_delta_units = patch.cost_delta_units;
    if (patch.ux_hint !== undefined) updatePayload.ux_hint = patch.ux_hint;
    if (patch.provider_used !== undefined) updatePayload.provider_used = patch.provider_used;
    if (patch.provider_mode !== undefined) updatePayload.provider_mode = patch.provider_mode;
    if (patch.started_at !== undefined) updatePayload.started_at = patch.started_at;
    if (patch.finished_at !== undefined) updatePayload.finished_at = patch.finished_at;

    updatePayload.request_id = nextBilling.request_id || null;
    updatePayload.billing_request_id = nextBilling.billing_request_id || null;
    updatePayload.charged_units = Number(nextBilling.charged_units || 0);
    updatePayload.charged = Boolean(nextBilling.charged);
    updatePayload.refunded = Boolean(nextBilling.refunded);
    updatePayload.charge_state = nextBilling.charge_state || (nextBilling.charged ? "CHARGED" : "NOT_CHARGED");
    updatePayload.refund_retry_count = Number(nextBilling.refund_retry_count || 0);
    updatePayload.next_refund_retry_at = nextBilling.next_refund_retry_at || null;
    updatePayload.last_refund_error_code = nextBilling.last_refund_error_code || null;
    updatePayload.refund_last_attempt_at = nextBilling.refund_last_attempt_at || null;
    updatePayload.updated_at = new Date().toISOString();

    const isTransition = patch.status && patch.status !== existing.status;
    if (isTransition) {
      updatePayload.last_transition_at = new Date().toISOString();
      if (patch.status === "PROCESSING" && !existing.started_at) {
        updatePayload.started_at = updatePayload.last_transition_at;
      }
      if (patch.status === "READY" || patch.status === "FAILED") {
        updatePayload.finished_at = updatePayload.last_transition_at;
      }
    }

    const { data, error } = await this.supabase.from("jobs").update(updatePayload).eq("id", id).select("*").single();
    if (error) throw new Error(`JOBS_DB_ERROR: ${error.message}`);

    if (isTransition) {
      await this.appendJobEvent(id, existing.owner_id, patch.status, null);
    }

    return normalizeJob(data);
  }

  async appendJobEvent(jobId, ownerId, eventType, meta = null) {
    const payload = {
      job_id: jobId,
      owner_id: ownerId,
      event_type: eventType,
      meta
    };
    const { error } = await this.supabase.from("job_events").insert(payload);
    if (error) throw new Error(`JOBS_DB_ERROR: ${error.message}`);
  }

  async getEvents(id) {
    const { data, error } = await this.supabase
      .from("job_events")
      .select("*")
      .eq("job_id", id)
      .order("ts", { ascending: true });
    if (error) throw new Error(`JOBS_DB_ERROR: ${error.message}`);
    return (data || []).map(normalizeEvent);
  }

  async claimNextQueued(workerId = null) {
    const { data, error } = await this.supabase.rpc("rpc_claim_next_queued_job", {
      p_worker_id: workerId || null
    });
    if (error) throw new Error(`JOBS_DB_ERROR: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeJob(row || null);
  }

  async claimNextRefundRetry(workerId = null) {
    const { data, error } = await this.supabase.rpc("rpc_claim_next_refund_retry_job", {
      p_worker_id: workerId || null
    });
    if (error) throw new Error(`JOBS_DB_ERROR: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeJob(row || null);
  }
}
