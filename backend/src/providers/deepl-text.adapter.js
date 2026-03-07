function mapDeepLTextError(status) {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_ERROR";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  return "PROVIDER_UPSTREAM_ERROR";
}

function toDeepLLangCode(lang) {
  if (!lang) return null;
  const v = String(lang).trim();
  if (!v) return null;
  return v.split("-")[0].toUpperCase();
}

export function createDeepLTextAdapter({
  apiKey = process.env.DEEPL_API_KEY || "",
  baseUrl = process.env.DEEPL_API_BASE_URL || "https://api-free.deepl.com",
  fetchImpl = globalThis.fetch
} = {}) {
  const enabled = Boolean(apiKey);

  return {
    provider: "deepl_text",
    enabled,

    async translateTextChunks({ chunks, sourceLang = null, targetLang }) {
      if (!enabled) return { ok: false, error: "PROVIDER_AUTH_ERROR", provider: "deepl_text" };
      try {
        const translatedChunks = [];
        for (const chunk of chunks) {
          const form = new URLSearchParams();
          form.append("text", chunk.text);
          form.append("target_lang", toDeepLLangCode(targetLang) || "");
          const source = toDeepLLangCode(sourceLang);
          if (source) form.append("source_lang", source);

          const res = await fetchImpl(`${baseUrl}/v2/translate`, {
            method: "POST",
            headers: {
              Authorization: `DeepL-Auth-Key ${apiKey}`,
              "content-type": "application/x-www-form-urlencoded"
            },
            body: form
          });
          if (!res.ok) {
            return { ok: false, error: mapDeepLTextError(res.status), provider: "deepl_text" };
          }
          const json = await res.json();
          const translated = json?.translations?.[0]?.text;
          if (!translated || typeof translated !== "string") {
            return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "deepl_text" };
          }
          translatedChunks.push({ index: chunk.index, text: translated.trim() });
        }
        return { ok: true, provider: "deepl_text", translatedChunks };
      } catch {
        return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "deepl_text" };
      }
    }
  };
}
