const PACKAGE_LIMITS = {
  free: { maxSizeMb: 25 },
  pro: { maxSizeMb: 80 },
  premium: { maxSizeMb: 250 }
};

export function validateAdmission({ packageName, fileSizeBytes }) {
  const pkg = (packageName || "free").toLowerCase();
  const limits = PACKAGE_LIMITS[pkg];
  if (!limits) {
    return { ok: false, error: "invalid_input" };
  }

  const sizeMb = fileSizeBytes / (1024 * 1024);
  if (sizeMb > limits.maxSizeMb) {
    return { ok: false, error: "INPUT_LIMIT_EXCEEDED" };
  }

  return { ok: true };
}
