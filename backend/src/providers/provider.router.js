export function getFallbackChain(packageName = "free") {
  const pkg = (packageName || "free").toLowerCase();
  if (pkg === "free") return ["economy", "standard"];
  if (pkg === "pro") return ["standard", "premium", "economy"];
  return ["premium", "standard", "economy"];
}

export function getTierMultiplier(tier = "economy") {
  if (tier === "premium") return 3.0;
  if (tier === "standard") return 1.8;
  return 1.0;
}

export function planRoute({ packageName = "free", mode = "readable" }) {
  const chain = getFallbackChain(packageName);
  return {
    packageName: (packageName || "free").toLowerCase(),
    mode,
    chain,
    maxEscalations: Math.max(0, chain.length - 1)
  };
}
