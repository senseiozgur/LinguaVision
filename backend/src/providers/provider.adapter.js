export function createProviderAdapter() {
  return {
    async translateDocument({ inputBuffer, tier, mode, simulateFailTier = null }) {
      if (simulateFailTier && simulateFailTier === tier) {
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
