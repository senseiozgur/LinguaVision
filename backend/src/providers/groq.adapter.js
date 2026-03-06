function mapGroqError(status) {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_ERROR";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  return "PROVIDER_UPSTREAM_ERROR";
}

export function createGroqAdapter({
  apiKey = process.env.GROQ_API_KEY || "",
  model = process.env.GROQ_MODEL || "llama-3.1-8b-instant",
  baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  timeoutMs = Number(process.env.GROQ_TIMEOUT_MS || 30000),
  fetchImpl = globalThis.fetch
} = {}) {
  const enabled = Boolean(apiKey);

  return {
    provider: "groq",
    enabled,

    async translateTextChunks({ chunks, sourceLang = null, targetLang }) {
      if (!enabled) {
        return { ok: false, error: "PROVIDER_AUTH_ERROR", provider: "groq" };
      }
      try {
        const translatedChunks = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          const payload = {
            model,
            temperature: 0,
            messages: [
              {
                role: "system",
                content:
                  "You are a translation engine. Return only translated text with original structure preserved as plain text."
              },
              {
                role: "user",
                content: `source_lang=${sourceLang || "auto"}\ntarget_lang=${targetLang}\n\n${chunk.text}`
              }
            ]
          };
          const res = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "content-type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (!res.ok) {
            return { ok: false, error: mapGroqError(res.status), provider: "groq" };
          }

          const json = await res.json();
          const translated = json?.choices?.[0]?.message?.content;
          if (!translated || typeof translated !== "string") {
            return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "groq" };
          }

          translatedChunks.push({ index: chunk.index, text: translated.trim() });
        }

        return {
          ok: true,
          provider: "groq",
          translatedChunks
        };
      } catch {
        return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "groq" };
      }
    }
  };
}
