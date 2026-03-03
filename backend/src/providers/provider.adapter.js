export function createProviderAdapter() {
  const allowedProviderErrors = new Set([
    "PROVIDER_RATE_LIMIT",
    "PROVIDER_TIMEOUT",
    "PROVIDER_UPSTREAM_5XX"
  ]);

  return {
    async translateDocument({
      inputBuffer,
      tier,
      mode,
      simulateFailTier = null,
      simulateFailTiers = [],
      simulateFailCode = "PROVIDER_TIMEOUT"
    }) {
      const failSet = new Set(simulateFailTiers || []);
      const shouldFail = (simulateFailTier && simulateFailTier === tier) || failSet.has(tier);
      if (shouldFail) {
        const code = allowedProviderErrors.has(simulateFailCode)
          ? simulateFailCode
          : "PROVIDER_UPSTREAM_5XX";
        return { ok: false, error: code, tier };
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
