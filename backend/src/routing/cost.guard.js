const PACKAGE_RULES = {
  free: { maxSizeMb: 25, budgetUnits: 120 },
  pro: { maxSizeMb: 80, budgetUnits: 800 },
  premium: { maxSizeMb: 250, budgetUnits: 4000 }
};

function getRules(packageName) {
  const pkg = (packageName || "free").toLowerCase();
  const rules = PACKAGE_RULES[pkg];
  if (!rules) return null;
  return { pkg, rules };
}

export function estimateStepUnits({ fileSizeBytes, mode = "readable" }) {
  const sizeMb = fileSizeBytes / (1024 * 1024);
  const base = Math.max(1, Math.ceil(sizeMb * 10));
  if (mode === "strict") return Math.ceil(base * 1.5);
  return base;
}

export function validateAdmission({ packageName, fileSizeBytes, worstCaseUnits = 0, remainingUnits = null }) {
  const resolved = getRules(packageName);
  if (!resolved) {
    return { ok: false, error: "invalid_input" };
  }
  const { pkg, rules } = resolved;

  const sizeMb = fileSizeBytes / (1024 * 1024);
  if (sizeMb > rules.maxSizeMb) {
    return { ok: false, error: "INPUT_LIMIT_EXCEEDED" };
  }

  if (remainingUnits !== null && Number.isFinite(remainingUnits) && worstCaseUnits > remainingUnits) {
    return { ok: false, error: "COST_GUARD_BLOCK" };
  }

  return { ok: true, packageName: pkg, budgetUnits: rules.budgetUnits };
}

export function validateRuntimeStep({ packageName, spentUnits = 0, stepUnits = 0 }) {
  const resolved = getRules(packageName);
  if (!resolved) {
    return { ok: false, error: "invalid_input" };
  }
  const { rules } = resolved;
  if (spentUnits + stepUnits > rules.budgetUnits) {
    return { ok: false, error: "COST_LIMIT_STOP" };
  }
  return { ok: true };
}
