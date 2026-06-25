// ── Auth, session cache, GAS forwarding, CORS ────────────────────────────────
import { text, httpError } from "./utils.js";

// In-memory session cache: avoids repeated GAS auth calls within the same Worker isolate.
const sessionCache = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000;

// Google JWKS cache: public keys used to verify ID tokens directly (no GAS call).
let jwksCache = null;
let jwksCacheAt = 0;
const JWKS_TTL = 3_600_000; // 1 hour

export async function getGoogleJwks() {
  if (jwksCache && Date.now() - jwksCacheAt < JWKS_TTL) return jwksCache;
  const resp = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = await resp.json();
  jwksCache = keys;
  jwksCacheAt = Date.now();
  return keys;
}

export function b64urlToBytes(str) {
  return Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

export async function verifyGoogleIdToken(env, idToken) {
  if (!idToken || !env.GOOGLE_CLIENT_ID) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const dec = new TextDecoder();
    const header = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) return null;
    if (payload.aud !== env.GOOGLE_CLIENT_ID) return null;
    const keys = await getGoogleJwks();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const cryptoKey = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", cryptoKey,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    if (env.ADMIN_EMAILS) {
      const whitelist = env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      if (whitelist.length > 0 && !whitelist.includes((payload.email || "").toLowerCase())) return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function requireAdmin(env, data) {
  // Fast path: validate Google ID token locally — no GAS call.
  const idToken = text(data.id_token);
  if (idToken) {
    const payload = await verifyGoogleIdToken(env, idToken);
    if (payload) return;
  }

  // Fallback: validate session token via GAS (with in-memory cache).
  const token = text(data.sessionToken);
  if (!token || !env.GAS_SCRIPT_URL) throw httpError(401, "Unauthorized");

  const cached = sessionCache.get(token);
  if (cached && Date.now() < cached.expiresAt) return;

  const response = await fetch(env.GAS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "refreshSession", sessionToken: token }),
  });
  const json = await response.json();
  if (!json.success) throw httpError(401, "Unauthorized");

  sessionCache.set(token, { expiresAt: Date.now() + SESSION_CACHE_TTL });
  if (sessionCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of sessionCache) {
      if (now >= v.expiresAt) sessionCache.delete(k);
    }
  }
}

export async function forwardToGas(env, data) {
  const json = await forwardToGasResult(env, data);
  if (!json.success) {
    const error = httpError(Number(json.code || 502), json.error || "GAS sync failed");
    error.gasResponse = json;
    throw error;
  }
  return json;
}

export async function forwardToGasResult(env, data) {
  if (!env.GAS_SCRIPT_URL) throw httpError(503, "GAS_SCRIPT_URL not configured");
  const response = await fetch(env.GAS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  return json;
}

export async function requireImporter(env, data) {
  if (env.IMPORT_TOKEN && text(data.importToken) === env.IMPORT_TOKEN) return;
  throw httpError(401, "Unauthorized");
}

export function corsJson(env, body, status = 200) {
  return corsResponse(env, JSON.stringify(body), status, {
    "content-type": "application/json;charset=utf-8",
  });
}

export function corsResponse(env, body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "null",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      ...headers,
    },
  });
}
