const ACTIONS = new Set([
  "health",
  "login",
  "getPublicBulletins",
  "getBulletins",
  "addBulletin",
  "updateBulletin",
  "deleteBulletin",
  "reorderBulletins",
  "importBulletins",
  "getViewStats",
  "recordCardView",
  "bulkAddCardViews",
  "resetViewStats",
  "uploadBulletinImage",
]);

const PUBLIC_ACTIONS = new Set([
  "getPublicBulletins",
  "getViewStats",
  "recordCardView",
]);

// In-memory session cache: avoids repeated GAS auth calls within the same Worker isolate.
const sessionCache = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000;

let driveTokenCache = null;
let driveTokenExpiry = 0;

// Google JWKS cache
let jwksCache = null;
let jwksCacheAt = 0;
const JWKS_TTL = 3_600_000;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return corsResponse(env, null, 204);
    if (request.method !== "POST") {
      return corsJson(env, { success: false, error: "POST only" }, 405);
    }

    let data;
    try {
      data = JSON.parse((await request.text()) || "{}");
    } catch {
      return corsJson(env, { success: false, error: "Invalid JSON" }, 400);
    }

    const action = text(data.action);
    if (!ACTIONS.has(action)) {
      return corsJson(env, { success: false, error: "Unsupported action" }, 400);
    }

    try {
      if (action === "health") {
        return corsJson(env, { success: true, service: "bulletins-api" });
      }

      if (action === "login") {
        return corsJson(env, await handleLogin(env, data));
      }

      if (action === "importBulletins") {
        await requireImporter(env, data);
        return corsJson(env, await importBulletins(env, data));
      }

      if (PUBLIC_ACTIONS.has(action)) {
        if (action === "getPublicBulletins") return corsJson(env, await getPublicBulletins(env));
        if (action === "getViewStats")        return corsJson(env, await getViewStats(env));
        if (action === "recordCardView")      return corsJson(env, await recordCardView(env, data));
      }

      // All remaining actions require admin auth
      await requireAdmin(env, data);
      if (action === "getBulletins")     return corsJson(env, await getBulletins(env));
      if (action === "addBulletin")      return corsJson(env, await addBulletin(env, data));
      if (action === "updateBulletin")   return corsJson(env, await updateBulletin(env, data));
      if (action === "deleteBulletin")   return corsJson(env, await deleteBulletin(env, data));
      if (action === "reorderBulletins") return corsJson(env, await reorderBulletins(env, data));
      if (action === "bulkAddCardViews")    return corsJson(env, await bulkAddCardViews(env, data));
      if (action === "resetViewStats")      return corsJson(env, await resetViewStats(env, data));
      if (action === "uploadBulletinImage") return corsJson(env, await uploadBulletinImage(env, data));

      throw httpError(400, "Unsupported action");
    } catch (error) {
      const status = Number(error.status || 500);
      console.error(JSON.stringify({ action, status, error: error.message }));
      return corsJson(env, { success: false, error: status < 500 ? error.message : "伺服器錯誤", code: status }, status);
    }
  },
};

// ─── Login ────────────────────────────────────────────────

async function handleLogin(env, data) {
  const idToken = text(data.id_token);
  const payload = await verifyGoogleIdToken(env, idToken);
  if (!payload) return { success: false, error: "未授權的帳號", code: 401 };

  // Get GAS UUID session token so admin.html and other GAS-backed pages can share it.
  if (env.GAS_SCRIPT_URL) {
    try {
      const gasRes = await fetch(env.GAS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "login", id_token: idToken }),
      });
      const gasJson = await gasRes.json();
      if (gasJson.success && gasJson.sessionToken) {
        return {
          success: true,
          email: payload.email,
          name: payload.name,
          role: gasJson.role || "admin",
          sessionToken: gasJson.sessionToken,
          id_token: idToken,
        };
      }
    } catch {}
  }

  return {
    success: true,
    email: payload.email,
    name: payload.name,
    role: "admin",
    sessionToken: idToken,
    id_token: idToken,
  };
}

// ─── Import ───────────────────────────────────────────────

async function importBulletins(env, data) {
  const bulletins = Array.isArray(data.bulletins) ? data.bulletins : [];
  if (bulletins.length === 0) return { success: true, imported: 0 };

  for (let i = 0; i < bulletins.length; i += 50) {
    await env.DB.batch(bulletins.slice(i, i + 50).map((b) => upsertStatement(env, b)));
  }
  return { success: true, imported: bulletins.length };
}

// ─── Public reads ─────────────────────────────────────────

async function getPublicBulletins(env) {
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM bulletins WHERE status = '已發布' ORDER BY sort_order ASC, created_at DESC`,
  ).all();
  return { success: true, bulletins: rows.results.map((r) => parseJson(r.payload_json)) };
}

// ─── Admin reads ──────────────────────────────────────────

async function getBulletins(env) {
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM bulletins ORDER BY sort_order ASC, created_at DESC`,
  ).all();
  return { success: true, bulletins: rows.results.map((r) => parseJson(r.payload_json)) };
}

// ─── Admin writes ─────────────────────────────────────────

async function addBulletin(env, data) {
  const title = text(data.title);
  if (!title) throw httpError(400, "標題不能空白");

  // Generate next BULL-XXX id (sequential, compatible with GAS format)
  const lastRow = await env.DB.prepare(
    `SELECT bulletin_id FROM bulletins ORDER BY bulletin_id DESC LIMIT 1`,
  ).first();
  let nextNum = 1;
  if (lastRow) {
    const m = String(lastRow.bulletin_id).match(/BULL-(\d+)/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  const bulletinId = "BULL-" + String(nextNum).padStart(3, "0");
  const now = new Date().toISOString();

  const bulletin = {
    bulletinId,
    createdAt: now,
    title,
    content:   text(data.content),
    imageUrl:  text(data.imageUrl),
    pinned:    parseBoolean(data.pinned),
    status:    normalizeStatus(data.status),
    author:    text(data.author),
    category:  text(data.category) || "里民活動",
    sortOrder: 0,
  };

  await upsertStatement(env, bulletin).run();
  return { success: true, bulletinId };
}

async function updateBulletin(env, data) {
  const bulletinId = requireId(data.bulletinId, "缺少 bulletinId");
  const row = await env.DB.prepare(
    `SELECT payload_json FROM bulletins WHERE bulletin_id = ?`,
  ).bind(bulletinId).first();
  if (!row) throw httpError(404, "找不到公告: " + bulletinId);

  const existing = parseJson(row.payload_json);
  const updated = {
    ...existing,
    ...(data.title    !== undefined && { title:    text(data.title) }),
    ...(data.content  !== undefined && { content:  text(data.content) }),
    ...(data.imageUrl !== undefined && { imageUrl: text(data.imageUrl) }),
    ...(data.pinned   !== undefined && { pinned:   parseBoolean(data.pinned) }),
    ...(data.status   !== undefined && { status:   normalizeStatus(data.status) }),
    ...(data.category !== undefined && { category: text(data.category) || "里民活動" }),
  };

  await upsertStatement(env, updated).run();
  return { success: true };
}

async function deleteBulletin(env, data) {
  const bulletinId = requireId(data.bulletinId, "缺少 bulletinId");
  await env.DB.prepare(`DELETE FROM bulletins WHERE bulletin_id = ?`).bind(bulletinId).run();
  return { success: true };
}

async function reorderBulletins(env, data) {
  const orders = Array.isArray(data.orders) ? data.orders : [];
  if (!orders.length) return { success: true };

  const statements = orders.map(({ bulletinId, sortOrder }) =>
    env.DB.prepare(
      `UPDATE bulletins
       SET sort_order = ?,
           payload_json = json_set(payload_json, '$.sortOrder', ?)
       WHERE bulletin_id = ?`,
    ).bind(Number(sortOrder || 0), Number(sortOrder || 0), text(bulletinId)),
  );

  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true };
}

// ─── View stats ───────────────────────────────────────────

async function getViewStats(env) {
  const rows = await env.DB.prepare(
    `SELECT bulletin_id, view_count FROM bulletin_views`,
  ).all();
  const cardCounts = {};
  let pageCount = 0;
  for (const r of rows.results) {
    cardCounts[r.bulletin_id] = r.view_count;
    pageCount += r.view_count;
  }
  return { success: true, pageCount, cardCounts };
}

async function recordCardView(env, data) {
  const bulletinId = text(data.itemId);
  if (!bulletinId) return { success: false, error: "Missing itemId" };
  await env.DB.prepare(
    `INSERT INTO bulletin_views(bulletin_id, view_count) VALUES(?, 1)
     ON CONFLICT(bulletin_id) DO UPDATE SET view_count = view_count + 1`,
  ).bind(bulletinId).run();
  return { success: true };
}

async function bulkAddCardViews(env, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return { success: false, error: "Missing items" };
  const statements = [];
  for (const item of items) {
    const bulletinId = text(item.itemId);
    const count = Math.max(0, Math.floor(Number(item.count || 0)));
    if (!bulletinId || count <= 0) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO bulletin_views(bulletin_id, view_count) VALUES(?, ?)
         ON CONFLICT(bulletin_id) DO UPDATE SET view_count = view_count + ?`,
      ).bind(bulletinId, count, count),
    );
  }
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true, updated: statements.length };
}

async function resetViewStats(env, data) {
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const statements = cards.map((card) => {
    const bulletinId = requireId(card.itemId, "Missing itemId");
    const count = Math.max(0, Math.floor(Number(card.count || 0)));
    return env.DB.prepare(
      `INSERT INTO bulletin_views(bulletin_id, view_count) VALUES(?, ?)
       ON CONFLICT(bulletin_id) DO UPDATE SET view_count = excluded.view_count`,
    ).bind(bulletinId, count);
  });
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true, updated: statements.length };
}

// ─── DB helper ────────────────────────────────────────────

function upsertStatement(env, b) {
  const payload = JSON.stringify(b);
  return env.DB.prepare(
    `INSERT INTO bulletins (
       bulletin_id, created_at, title, content, image_url,
       pinned, status, author, category, sort_order, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(bulletin_id) DO UPDATE SET
       title=excluded.title, content=excluded.content, image_url=excluded.image_url,
       pinned=excluded.pinned, status=excluded.status, author=excluded.author,
       category=excluded.category, sort_order=excluded.sort_order,
       payload_json=excluded.payload_json`,
  ).bind(
    text(b.bulletinId),
    text(b.createdAt),
    text(b.title),
    text(b.content),
    text(b.imageUrl),
    parseBoolean(b.pinned) ? 1 : 0,
    normalizeStatus(b.status),
    text(b.author),
    text(b.category) || "里民活動",
    Number(b.sortOrder || 0),
    payload,
  );
}

// ─── Auth ─────────────────────────────────────────────────

async function requireAdmin(env, data) {
  const idToken = text(data.id_token);
  if (idToken) {
    const payload = await verifyGoogleIdToken(env, idToken);
    if (payload) return;
  }

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

async function requireImporter(env, data) {
  if (env.IMPORT_TOKEN && text(data.importToken) === env.IMPORT_TOKEN) return;
  throw httpError(401, "Unauthorized");
}

async function getGoogleJwks() {
  if (jwksCache && Date.now() - jwksCacheAt < JWKS_TTL) return jwksCache;
  const resp = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = await resp.json();
  jwksCache = keys;
  jwksCacheAt = Date.now();
  return keys;
}

function b64urlToBytes(str) {
  return Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

async function verifyGoogleIdToken(env, idToken) {
  if (!idToken || !env.GOOGLE_CLIENT_ID) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const dec = new TextDecoder();
    const header  = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
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

// ─── CORS / response helpers ──────────────────────────────

function corsJson(env, body, status = 200) {
  return corsResponse(env, JSON.stringify(body), status, {
    "content-type": "application/json;charset=utf-8",
  });
}

function corsResponse(env, body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      ...headers,
    },
  });
}

// ─── Utilities ────────────────────────────────────────────

function requireId(value, message) {
  const id = text(value);
  if (!id) throw httpError(400, message);
  return id;
}

function parseJson(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseBoolean(value) {
  if (value === true) return true;
  const s = String(value).toUpperCase().trim();
  return s === "TRUE" || s === "是";
}

function normalizeStatus(value) {
  return String(value || "").trim() === "已發布" ? "已發布" : "未發布";
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ─── Google Drive upload helpers ──────────────────────────────────────────────

async function getGoogleAccessToken(env) {
  if (driveTokenCache && Date.now() < driveTokenExpiry) return driveTokenCache;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("無法取得 Drive access token");
  driveTokenCache = json.access_token;
  driveTokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return driveTokenCache;
}

async function uploadToDrive(env, b64, mimeType, fileName) {
  const accessToken = await getGoogleAccessToken(env);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const boundary = `----Boundary${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: fileName, parents: [env.GOOGLE_DRIVE_FOLDER_ID] });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const file = await uploadRes.json();
  if (!file.id) throw new Error("Drive 上傳失敗: " + JSON.stringify(file));
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return `https://lh3.googleusercontent.com/d/${file.id}`;
}

async function uploadBulletinImage(env, data) {
  let b64 = text(data.imageBase64 || data.base64);
  if (!b64) return { success: false, error: "Missing imageBase64" };
  const comma = b64.indexOf(",");
  if (comma !== -1) b64 = b64.slice(comma + 1);
  if (b64.length * 0.75 > 2 * 1024 * 1024) return { success: false, error: "圖片過大，請壓縮至 2MB 以下" };
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_DRIVE_FOLDER_ID) return { success: false, error: "Drive 未設定" };
  const mimeType = text(data.mimeType) || "image/jpeg";
  const ext = mimeType.split("/")[1] || "jpg";
  const url = await uploadToDrive(env, b64, mimeType, `bulletin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
  return { success: true, url };
}
