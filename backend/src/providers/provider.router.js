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

export function getModeAProviderOrder(raw = "deepl,google") {
  const allowed = new Set(["deepl", "google"]);
  const list = String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((name) => allowed.has(name));
  if (list.length === 0) return ["deepl", "google"];
  return [...new Set(list)];
}

export function getModeBProviderOrder(raw = "openai,groq") {
  const allowed = new Set(["deepl_text", "google_text", "openai", "groq"]);
  const list = String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((name) => allowed.has(name));
  if (list.length === 0) return ["openai", "groq"];
  return [...new Set(list)];
}
