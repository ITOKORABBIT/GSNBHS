// ── Auth, session cache, GAS forwarding, CORS ────────────────────────────────
import { text, httpError } from "./utils.js";

// In-memory session cache: avoids repeated GAS auth calls within the same Worker isolate.
const sessionCache = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000;

export async function loginAdmin(env, idToken) {
  if (!idToken) throw httpError(401, "未授權的帳號");
  if (!env.GAS_SCRIPT_URL) throw httpError(503, "登入服務未設定");

  const response = await fetch(env.GAS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "login", id_token: idToken }),
  });
  const json = await response.json();
  if (!json.success || !json.sessionToken) {
    throw httpError(Number(json.code || 401), "未授權的帳號");
  }
  return {
    success: true,
    sessionToken: text(json.sessionToken),
    email: text(json.email),
    name: text(json.name),
    role: text(json.role) || "管理員",
  };
}

// GAS 偶爾不回 JSON 而是回一頁 HTML（冷啟動、配額、Google 錯誤頁）。
// 直接 .json() 會丟出解析錯誤 → 500「伺服器錯誤」，里長只看到系統壞掉。
// 這裡改判成 401，前端會直接跳「登入已失效，請重新登入」。
async function parseGasAuthJson(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw httpError(401, "登入已失效，請重新登入");
  }
}

export async function requireAdmin(env, data) {
  const token = text(data.sessionToken);
  if (!token || !env.GAS_SCRIPT_URL) throw httpError(401, "Unauthorized");

  const cached = sessionCache.get(token);
  if (cached && Date.now() < cached.expiresAt) return;

  const response = await fetch(env.GAS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "refreshSession", sessionToken: token }),
  });
  const json = await parseGasAuthJson(response);
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
