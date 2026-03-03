export function createProviderAdapter() {
  return {
    async translateDocument({
      inputBuffer,
      tier,
      mode,
      simulateFailTier = null,
      simulateFailTiers = []
    }) {
      const failSet = new Set(simulateFailTiers || []);
      const shouldFail = (simulateFailTier && simulateFailTier === tier) || failSet.has(tier);
      if (shouldFail) {
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
