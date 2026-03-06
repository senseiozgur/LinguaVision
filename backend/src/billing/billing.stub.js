export function createBillingStubAdapter() {
  const charges = new Map();
  const refunds = new Map();
  const refundFailures = new Set();

  return {
    async charge({ request_id, units }) {
      const existing = charges.get(request_id);
      if (existing) {
        return { ...existing, already_charged: true };
      }

      const result = {
        billing_request_id: `bill_${request_id}`,
        charged_units: Number(units || 0),
        already_charged: false
      };
      charges.set(request_id, result);
      return result;
    },

    async refund({ request_id }) {
      if (process.env.BILLING_STUB_FAIL_REFUND === "1") {
        throw new Error("SIMULATED_REFUND_FAILURE");
      }
      if (process.env.BILLING_STUB_FAIL_REFUND_ONCE === "1" && !refundFailures.has(request_id)) {
        refundFailures.add(request_id);
        throw new Error("SIMULATED_REFUND_FAILURE_ONCE");
      }

      const refundKey = `refund_${request_id}`;
      const existing = refunds.get(refundKey);
      if (existing) {
        return { ...existing, already_refunded: true };
      }

      const result = {
        refund_billing_request_id: refundKey,
        refunded: true,
        already_refunded: false
      };
      refunds.set(refundKey, result);
      return result;
    }
  };
}
