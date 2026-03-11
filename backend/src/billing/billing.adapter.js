export class BillingError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "BillingError";
    this.code = code || "BILLING_ERROR";
  }
}

export function toSafeBillingErrorCode(err) {
  const raw = (err && (err.code || err.message)) || "";
  const text = String(raw).toUpperCase();
  if (text.includes("CHARGE_NOT_FOUND")) return "BILLING_CHARGE_NOT_FOUND";
  if (text.includes("INVALID_REQUEST_ID")) return "BILLING_INVALID_REQUEST";
  if (text.includes("INVALID_UNITS")) return "BILLING_INVALID_UNITS";
  if (text.includes("DAILY_CAP_EXCEEDED")) return "BILLING_DAILY_CAP_EXCEEDED";
  return "BILLING_ERROR";
}
