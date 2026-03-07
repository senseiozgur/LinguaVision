function mapGoogleTextError(status) {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_ERROR";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  return "PROVIDER_UPSTREAM_ERROR";
}

function toLangCode(lang) {
  if (!lang) return null;
  return String(lang).trim().replace("_", "-");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

export function createGoogleTextAdapter({
  apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || "",
  baseUrl = process.env.GOOGLE_TRANSLATE_BASE_URL || "https://translation.googleapis.com/language/translate/v2",
  fetchImpl = globalThis.fetch
} = {}) {
  const enabled = Boolean(apiKey);

  return {
    provider: "google_text",
    enabled,

    async translateTextChunks({ chunks, sourceLang = null, targetLang }) {
      if (!enabled) return { ok: false, error: "PROVIDER_AUTH_ERROR", provider: "google_text" };
      try {
        const translatedChunks = [];
        for (const chunk of chunks) {
          const body = {
            q: chunk.text,
            target: toLangCode(targetLang),
            format: "text"
          };
          if (sourceLang) body.source = toLangCode(sourceLang);
          const endpoint = `${baseUrl}?key=${encodeURIComponent(apiKey)}`;
          const res = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(body)
          });
          if (!res.ok) {
            return { ok: false, error: mapGoogleTextError(res.status), provider: "google_text" };
          }
          const json = await res.json();
          const translated = json?.data?.translations?.[0]?.translatedText;
          if (!translated || typeof translated !== "string") {
            return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "google_text" };
          }
          translatedChunks.push({ index: chunk.index, text: decodeHtmlEntities(translated).trim() });
        }
        return { ok: true, provider: "google_text", translatedChunks };
      } catch {
        return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "google_text" };
      }
    }
  };
}
