import fs from "fs/promises";
import crypto from "crypto";

function mapGoogleError(status, bodyText = "") {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_ERROR";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  if (status === 400 && bodyText.toLowerCase().includes("mime")) return "PROVIDER_UNSUPPORTED_DOCUMENT";
  return "PROVIDER_UPSTREAM_ERROR";
}

function toGoogleLangCode(lang) {
  if (!lang) return null;
  const value = String(lang).trim();
  if (!value) return null;
  return value.replace("_", "-");
}

async function loadServiceAccount({ credentialsPath, credentialsJson }) {
  if (credentialsJson) {
    return JSON.parse(credentialsJson);
  }
  if (credentialsPath) {
    const raw = await fs.readFile(credentialsPath, "utf8");
    return JSON.parse(raw);
  }
  return null;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

async function getAccessToken(serviceAccount, fetchImpl = globalThis.fetch) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaim = base64url(JSON.stringify(claimSet));
  const signingInput = `${encodedHeader}.${encodedClaim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key, "base64url");
  const assertion = `${signingInput}.${signature}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);

  const tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });
  if (!tokenRes.ok) {
    return null;
  }
  const tokenJson = await tokenRes.json();
  return tokenJson.access_token || null;
}

export function createGoogleAdapter({
  projectId,
  location = "global",
  credentialsPath = null,
  credentialsJson = null,
  fetchImpl = globalThis.fetch
} = {}) {
  const enabled = Boolean(projectId && (credentialsPath || credentialsJson));

  return {
    provider: "google",
    enabled,

    async translatePdf({ inputBuffer, sourceLang = null, targetLang }) {
      if (!enabled) {
        return { ok: false, error: "PROVIDER_AUTH_ERROR", provider: "google" };
      }
      try {
        const serviceAccount = await loadServiceAccount({ credentialsPath, credentialsJson });
        if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
          return { ok: false, error: "PROVIDER_AUTH_ERROR", provider: "google" };
        }

        const token = await getAccessToken(serviceAccount, fetchImpl);
        if (!token) {
          return { ok: false, error: "PROVIDER_AUTH_ERROR", provider: "google" };
        }

        const endpoint = `https://translation.googleapis.com/v3/projects/${projectId}/locations/${location}:translateDocument`;
        const body = {
          targetLanguageCode: toGoogleLangCode(targetLang),
          documentInputConfig: {
            mimeType: "application/pdf",
            content: Buffer.from(inputBuffer).toString("base64")
          },
          documentOutputConfig: {
            mimeType: "application/pdf"
          }
        };
        if (sourceLang) {
          body.sourceLanguageCode = toGoogleLangCode(sourceLang);
        }

        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const text = await res.text();
          return {
            ok: false,
            error: mapGoogleError(res.status, text),
            provider: "google"
          };
        }

        const json = await res.json();
        const outputBase64 =
          json?.documentTranslation?.byteStreamOutputs?.[0] ||
          json?.documentTranslation?.byteStreamOutput ||
          json?.documentTranslation?.documentOutput?.content ||
          null;
        if (!outputBase64) {
          return { ok: false, error: "PROVIDER_UNSUPPORTED_DOCUMENT", provider: "google" };
        }

        return {
          ok: true,
          outputBuffer: Buffer.from(outputBase64, "base64"),
          provider: "google"
        };
      } catch {
        return { ok: false, error: "PROVIDER_UPSTREAM_ERROR", provider: "google" };
      }
    }
  };
}
