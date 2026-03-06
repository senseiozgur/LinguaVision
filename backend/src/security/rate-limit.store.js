import { createClient } from "@supabase/supabase-js";

function nowIso() {
  return new Date().toISOString();
}

function createMemoryLimiter() {
  const buckets = new Map();
  return {
    consume({ scope, subject, windowSec, maxHits }) {
      const key = `${scope}:${subject}:${windowSec}`;
      const now = Date.now();
      const current = buckets.get(key);
      if (!current || now >= current.resetAtMs) {
        buckets.set(key, { hits: 1, resetAtMs: now + windowSec * 1000 });
        return {
          allowed: true,
          remaining: Math.max(0, maxHits - 1),
          resetAt: new Date(now + windowSec * 1000).toISOString(),
          hits: 1,
          mode: "memory"
        };
      }
      const hits = current.hits + 1;
      current.hits = hits;
      const allowed = hits <= maxHits;
      return {
        allowed,
        remaining: Math.max(0, maxHits - Math.min(hits, maxHits)),
        resetAt: new Date(current.resetAtMs).toISOString(),
        hits,
        mode: "memory"
      };
    }
  };
}

export function createRateLimitStore({
  supabaseUrl = process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  preferShared = process.env.LV_RATE_LIMIT_SHARED !== "0"
} = {}) {
  const memory = createMemoryLimiter();
  const canShared = Boolean(supabaseUrl && supabaseServiceRoleKey && preferShared);
  const stats = {
    rate_limit_mode: canShared ? "shared" : "memory",
    rate_limit_shared_errors_total: 0,
    rate_limit_memory_hits_total: 0,
    rate_limit_shared_hits_total: 0
  };
  let warnedSharedFallback = false;

  const supabase = canShared
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

  async function consumeShared({ scope, subject, windowSec, maxHits }) {
    const { data, error } = await supabase.rpc("rpc_rate_limit_check", {
      p_scope: scope,
      p_subject: subject,
      p_window_sec: windowSec,
      p_max_hits: maxHits,
      p_now_iso: nowIso()
    });
    if (error) throw new Error(error.message || "RATE_LIMIT_RPC_ERROR");
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row?.allowed),
      remaining: Number(row?.remaining ?? 0),
      resetAt: row?.reset_at || null,
      hits: Number(row?.hits ?? 0),
      mode: "shared"
    };
  }

  return {
    async consume({ scope, subject, windowSec, maxHits }) {
      if (canShared) {
        try {
          const shared = await consumeShared({ scope, subject, windowSec, maxHits });
          stats.rate_limit_shared_hits_total += 1;
          stats.rate_limit_mode = "shared";
          return shared;
        } catch (err) {
          stats.rate_limit_shared_errors_total += 1;
          stats.rate_limit_mode = "memory_fallback";
          if (!warnedSharedFallback) {
            warnedSharedFallback = true;
            console.warn(`rate_limit_shared_fallback reason=${err?.message || "unknown"}`);
          }
        }
      }
      stats.rate_limit_memory_hits_total += 1;
      return memory.consume({ scope, subject, windowSec, maxHits });
    },
    metrics() {
      return { ...stats };
    }
  };
}
