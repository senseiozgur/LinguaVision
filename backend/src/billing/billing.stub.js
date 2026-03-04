export function createBillingStubAdapter() {
  const charges = new Map();
  const refunds = new Map();

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
