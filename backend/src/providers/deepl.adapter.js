function mapDeepLError(status, text = "") {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_ERROR";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  if (status === 413 || text.includes("Document too large")) return "PROVIDER_UNSUPPORTED_DOCUMENT";
  return "PROVIDER_UPSTREAM_ERROR";
}

function toDeepLLangCode(lang) {
  if (!lang) return null;
  const value = String(lang).trim();
  if (!value) return null;
  const parts = value.split("-");
  return parts[0].toUpperCase();
}

export function createDeepLAdapter({
  apiKey,
  baseUrl = "https://api-free.deepl.com",
  pollIntervalMs = 1500,
  maxPollAttempts = 40,
  fetchImpl = globalThis.fetch
} = {}) {
  const enabled = Boolean(apiKey);

  async function request(url, init) {
    const res = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        ...(init?.headers || {})
      }
    });
    return res;
  }

  return {
    provider: "deepl",
    enabled,

    async translatePdf({ inputBuffer, sourceLang = null, targetLang }) {
      if (!enabled) {
        return { ok: false, error: "PROVIDER_AUTH_ERROR", provider: "deepl" };
      }
      try {
        const uploadForm = new FormData();
        uploadForm.append("file", new Blob([inputBuffer], { type: "application/pdf" }), "input.pdf");
        uploadForm.append("target_lang", toDeepLLangCode(targetLang) || "");
        if (sourceLang) {
          uploadForm.append("source_lang", toDeepLLangCode(sourceLang));
        }

        const uploadRes = await request(`${baseUrl}/v2/document`, {
          method: "POST",
          body: uploadForm
        });
        if (!uploadRes.ok) {
          const body = await uploadRes.text();
          return {
            ok: false,
            error: mapDeepLError(uploadRes.status, body),
            provider: "deepl"
          };
        }

        const uploaded = await uploadRes.json();
        const documentId = uploaded.document_id;
        const documentKey = uploaded.document_key;
        if (!documentId || !documentKey) {
          return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "deepl" };
        }

        for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
          const statusForm = new FormData();
          statusForm.append("document_key", documentKey);
          const statusRes = await request(`${baseUrl}/v2/document/${documentId}`, {
            method: "POST",
            body: statusForm
          });

          if (!statusRes.ok) {
            const body = await statusRes.text();
            return {
              ok: false,
              error: mapDeepLError(statusRes.status, body),
              provider: "deepl"
            };
          }

          const statusJson = await statusRes.json();
          const status = statusJson.status;
          if (status === "done") {
            const resultForm = new FormData();
            resultForm.append("document_key", documentKey);
            const resultRes = await request(`${baseUrl}/v2/document/${documentId}/result`, {
              method: "POST",
              body: resultForm
            });
            if (!resultRes.ok) {
              const body = await resultRes.text();
              return {
                ok: false,
                error: mapDeepLError(resultRes.status, body),
                provider: "deepl"
              };
            }
            const ab = await resultRes.arrayBuffer();
            return {
              ok: true,
              outputBuffer: Buffer.from(ab),
              provider: "deepl"
            };
          }

          if (status === "error") {
            return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "deepl" };
          }

          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        return { ok: false, error: "PROVIDER_TIMEOUT", provider: "deepl" };
      } catch {
        return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "deepl" };
      }
    }
  };
}
