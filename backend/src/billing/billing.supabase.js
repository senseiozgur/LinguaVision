import { createClient } from "@supabase/supabase-js";
import { BillingError, toSafeBillingErrorCode } from "./billing.adapter.js";

export function createSupabaseBillingAdapter({ supabase, defaultUserId = null } = {}) {
  if (!supabase) {
    throw new BillingError("BILLING_CONFIG_ERROR", "Supabase client is required");
  }

  return {
    async charge({ user_id = null, job_id, request_id, units, meta = {} }) {
      const payload = {
        p_user_id: user_id || defaultUserId,
        p_job_id: job_id,
        p_request_id: request_id,
        p_units: units,
        p_meta: meta || {}
      };

      const { data, error } = await supabase.rpc("rpc_charge_units", payload);
      if (error) {
        throw new BillingError(toSafeBillingErrorCode(error), error.message);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.billing_request_id) {
        throw new BillingError("BILLING_INVALID_RESPONSE", "Charge RPC returned invalid payload");
      }

      return {
        billing_request_id: row.billing_request_id,
        charged_units: Number(row.charged_units || 0),
        already_charged: Boolean(row.already_charged)
      };
    },

    async refund({
      user_id = null,
      job_id,
      request_id,
      billing_request_id,
      units,
      reason,
      meta = {}
    }) {
      const payload = {
        p_user_id: user_id || defaultUserId,
        p_job_id: job_id,
        p_request_id: request_id,
        p_billing_request_id: billing_request_id,
        p_units: units,
        p_reason: reason || null,
        p_meta: meta || {}
      };

      const { data, error } = await supabase.rpc("rpc_refund_units", payload);
      if (error) {
        throw new BillingError(toSafeBillingErrorCode(error), error.message);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.refund_billing_request_id) {
        throw new BillingError("BILLING_INVALID_RESPONSE", "Refund RPC returned invalid payload");
      }

      return {
        refund_billing_request_id: row.refund_billing_request_id,
        refunded: Boolean(row.refunded),
        already_refunded: Boolean(row.already_refunded)
      };
    }
  };
}

export function createSupabaseBillingAdapterFromEnv(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new BillingError("BILLING_CONFIG_ERROR", "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  return createSupabaseBillingAdapter({
    supabase,
    defaultUserId: env.DEFAULT_BILLING_USER_ID || null
  });
}
