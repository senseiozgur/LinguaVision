export function createProviderAdapter() {
  const allowedProviderErrors = new Set([
    "PROVIDER_RATE_LIMIT",
    "PROVIDER_TIMEOUT",
    "PROVIDER_UPSTREAM_5XX"
  ]);
  const transientFailureSeen = new Set();

  return {
    async translateDocument({
      inputBuffer,
      tier,
      mode,
      simulateFailTier = null,
      simulateFailTiers = [],
      simulateFailCode = "PROVIDER_TIMEOUT",
      simulateRetryOnceTiers = [],
      jobId = null
    }) {
      const failSet = new Set(simulateFailTiers || []);
      const retryOnceSet = new Set(simulateRetryOnceTiers || []);
      const shouldFail = (simulateFailTier && simulateFailTier === tier) || failSet.has(tier);
      const transientKey = `${jobId || "global"}:${tier}`;
      const shouldFailOnce = retryOnceSet.has(tier) && !transientFailureSeen.has(transientKey);
      if (shouldFail) {
        const code = allowedProviderErrors.has(simulateFailCode)
          ? simulateFailCode
          : "PROVIDER_UPSTREAM_5XX";
        return { ok: false, error: code, tier };
      }
      if (shouldFailOnce) {
        transientFailureSeen.add(transientKey);
        return { ok: false, error: "PROVIDER_TIMEOUT", tier };
      }

      return {
        ok: true,
        tier,
        mode,
        outputBuffer: inputBuffer
      };
    }
  };
}
