import { createHash } from "crypto";

export const OUTPUT_CACHE_KEY_VERSION = "lv_output_cache_v1";

function norm(value) {
  return String(value || "").trim();
}

function csvNorm(value) {
  return norm(value)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

export function hashInputBuffer(inputBuffer) {
  const h = createHash("sha256");
  h.update(inputBuffer);
  return h.digest("hex");
}

export function buildOutputCacheKey({
  inputBuffer,
  ownerId,
  sourceLang,
  targetLang,
  providerMode,
  providerFamily,
  outputStrategyVersion,
  routeMode
}) {
  const inputHash = hashInputBuffer(inputBuffer);
  const mode = norm(providerMode).toUpperCase();
  const source = norm(sourceLang).toLowerCase();
  const target = norm(targetLang).toLowerCase();
  const family = csvNorm(providerFamily);
  const strategy = norm(outputStrategyVersion);
  const scopeOwner = norm(ownerId);
  const route = norm(routeMode).toLowerCase();

  const payload = [
    `v=${OUTPUT_CACHE_KEY_VERSION}`,
    `owner=${scopeOwner}`,
    `input_sha256=${inputHash}`,
    `source=${source}`,
    `target=${target}`,
    `provider_mode=${mode}`,
    `provider_family=${family}`,
    `output_strategy=${strategy}`,
    `route_mode=${route}`
  ].join("|");

  const digest = createHash("sha256").update(payload).digest("hex");
  return {
    key: digest,
    keyVersion: OUTPUT_CACHE_KEY_VERSION,
    inputHash,
    cacheScope: scopeOwner ? "owner" : "global"
  };
}

export function shortCacheKey(value) {
  const v = norm(value);
  if (!v) return "";
  return v.slice(0, 16);
}
