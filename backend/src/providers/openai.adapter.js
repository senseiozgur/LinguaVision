function mapOpenAIError(status) {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_ERROR";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  return "PROVIDER_UPSTREAM_ERROR";
}

export function createOpenAIAdapter({
  apiKey = process.env.OPENAI_API_KEY || "",
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 30000),
  fetchImpl = globalThis.fetch
} = {}) {
  const enabled = Boolean(apiKey);

  return {
    provider: "openai",
    enabled,

    async translateTextChunks({ chunks, sourceLang = null, targetLang }) {
      if (!enabled) {
        return { ok: false, error: "PROVIDER_AUTH_ERROR", provider: "openai" };
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
            return { ok: false, error: mapOpenAIError(res.status), provider: "openai" };
          }

          const json = await res.json();
          const translated = json?.choices?.[0]?.message?.content;
          if (!translated || typeof translated !== "string") {
            return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "openai" };
          }

          translatedChunks.push({ index: chunk.index, text: translated.trim() });
        }

        return {
          ok: true,
          provider: "openai",
          translatedChunks
        };
      } catch {
        return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "openai" };
      }
    }
  };
}
