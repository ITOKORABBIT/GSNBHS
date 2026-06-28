const ACTIONS = new Set([
  "health",
  "importCases",
  "getCases",
  "getCase",
  "submitReport",
  "submitAdminReport",
  "updateReply",
  "pinCase",
  "reorderCases",
  "deleteCase",
  "batchUpdateCases",
  "getPublicCases",
  "getPublicCase",
  "getViewStats",
  "recordCardView",
  "bulkAddCardViews",
  "resetViewStats",
  "uploadCasePhoto",
  "uploadPublicPhoto",
]);

const PUBLIC_ACTIONS = new Set([
  "getPublicCases",
  "getPublicCase",
  "submitReport",
  "getViewStats",
  "recordCardView",
  "uploadPublicPhoto",
]);

// In-memory session cache: avoids repeated GAS auth calls within the same Worker isolate.
const sessionCache = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000;

// Google JWKS cache
let jwksCache = null;
let jwksCacheAt = 0;
const JWKS_TTL = 3_600_000;

let driveTokenCache = null;
let driveTokenExpiry = 0;

function nowTW() {
  const d = new Date();
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${tw.getUTCFullYear()}/${pad(tw.getUTCMonth() + 1)}/${pad(tw.getUTCDate())} ${pad(tw.getUTCHours())}:${pad(tw.getUTCMinutes())}:${pad(tw.getUTCSeconds())}`;
}

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
        return corsJson(env, { success: true, service: "cases-api" });
      }

      if (action === "importCases") {
        await requireImporter(env, data);
        return corsJson(env, await importCases(env, data));
      }

      if (PUBLIC_ACTIONS.has(action)) {
        if (action === "getPublicCases")    return corsJson(env, await getPublicCases(env));
        if (action === "getPublicCase")     return corsJson(env, await getPublicCase(env, data));
        if (action === "submitReport")      return corsJson(env, await submitReport(env, ctx, data));
        if (action === "getViewStats")      return corsJson(env, await getViewStats(env));
        if (action === "recordCardView")    return corsJson(env, await recordCardView(env, data));
        if (action === "uploadPublicPhoto") return corsJson(env, await uploadCasePhoto(env, data));
      }

      if (action === "bulkAddCardViews" || action === "resetViewStats") {
        await requireAdmin(env, data);
        if (action === "bulkAddCardViews") return corsJson(env, await bulkAddCardViews(env, data));
        return corsJson(env, await resetViewStats(env, data));
      }

      // All remaining actions require admin auth
      const [, result] = await Promise.all([
        requireAdmin(env, data),
        (async () => {
          if (action === "getCases")           return getCases(env);
          if (action === "getCase")            return getCase(env, data);
          if (action === "submitAdminReport")  return submitAdminReport(env, ctx, data);
          if (action === "updateReply")        return updateReply(env, ctx, data);
          if (action === "pinCase")            return pinCase(env, ctx, data);
          if (action === "reorderCases")       return reorderCases(env, ctx, data);
          if (action === "deleteCase")         return deleteCase(env, ctx, data);
          if (action === "batchUpdateCases")   return batchUpdateCases(env, ctx, data);
          if (action === "uploadCasePhoto")    return uploadCasePhoto(env, data);
          throw httpError(400, "Unsupported action");
        })(),
      ]);
      return corsJson(env, result);
    } catch (error) {
      const status = Number(error.status || 500);
      console.error(JSON.stringify({ action, status, error: error.message }));
      return corsJson(env, { success: false, error: status < 500 ? error.message : "伺服器錯誤", code: status }, status);
    }
  },
};

// ─── Import ───────────────────────────────────────────────

async function importCases(env, data) {
  const cases = Array.isArray(data.cases) ? data.cases : [];
  if (cases.length === 0) return { success: true, imported: 0 };

  const statements = cases.map((c) => upsertCaseStatement(env, c));
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }

  const importId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO import_runs (id, imported_at, case_count) VALUES (?, ?, ?)",
  ).bind(importId, new Date().toISOString(), cases.length).run();

  return { success: true, imported: cases.length, importId };
}

// ─── Admin reads ──────────────────────────────────────────

async function getCases(env) {
  const rows = await env.DB.prepare(
    "SELECT payload_json FROM cases ORDER BY sort_order ASC, pin_order DESC, report_time DESC",
  ).all();
  return { success: true, cases: rows.results.map((r) => parseJson(r.payload_json)) };
}

async function getCase(env, data) {
  const caseId = requireId(data.caseId, "Missing caseId");
  const row = await env.DB.prepare("SELECT payload_json FROM cases WHERE case_id = ?")
    .bind(caseId).first();
  if (!row) return { success: false, error: "找不到案件" };
  return { success: true, case: parseJson(row.payload_json) };
}

// ─── Public reads ─────────────────────────────────────────

async function getPublicCases(env) {
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM cases
     WHERE public_flag = 1
     ORDER BY sort_order ASC, pin_order DESC, report_time DESC`,
  ).all();
  return { success: true, cases: rows.results.map((r) => sanitizePublic(parseJson(r.payload_json))) };
}

async function getPublicCase(env, data) {
  const caseId = requireId(data.caseId, "Missing caseId");
  const row = await env.DB.prepare(
    "SELECT payload_json FROM cases WHERE case_id = ? AND public_flag = 1",
  ).bind(caseId).first();
  if (!row) return { success: false, error: "找不到案件" };
  return { success: true, case: sanitizePublic(parseJson(row.payload_json)) };
}

// ─── View stats (public) ─────────────────────────────────

async function getViewStats(env) {
  const rows = await env.DB.prepare(
    `SELECT case_id, view_count FROM case_views`,
  ).all();
  const cardCounts = {};
  let pageCount = 0;
  for (const r of rows.results) {
    cardCounts[r.case_id] = r.view_count;
    pageCount += r.view_count;
  }
  return { success: true, pageCount, cardCounts };
}

async function recordCardView(env, data) {
  const caseId = text(data.itemId);
  if (!caseId) return { success: false, error: "Missing itemId" };
  await env.DB.prepare(
    `INSERT INTO case_views(case_id, view_count) VALUES(?, 1)
     ON CONFLICT(case_id) DO UPDATE SET view_count = view_count + 1`,
  ).bind(caseId).run();
  return { success: true };
}

async function bulkAddCardViews(env, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return { success: false, error: "Missing items" };
  const statements = [];
  for (const item of items) {
    const caseId = text(item.itemId);
    const count = Math.max(0, Math.floor(Number(item.count || 0)));
    if (!caseId || count <= 0) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO case_views(case_id, view_count) VALUES(?, ?)
         ON CONFLICT(case_id) DO UPDATE SET view_count = view_count + ?`,
      ).bind(caseId, count, count),
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
    const caseId = requireId(card.itemId, "Missing itemId");
    const count = Math.max(0, Math.floor(Number(card.count || 0)));
    return env.DB.prepare(
      `INSERT INTO case_views(case_id, view_count) VALUES(?, ?)
       ON CONFLICT(case_id) DO UPDATE SET view_count = excluded.view_count`,
    ).bind(caseId, count);
  });
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true, updated: statements.length };
}

// ─── Submit (public) ──────────────────────────────────────

async function submitReport(env, ctx, data) {
  // Always call GAS synchronously: gets caseId and triggers LINE notification.
  const gasResult = await forwardToGas(env, data);
  const caseId = text(gasResult.caseId);
  if (!caseId) return { success: true, ...gasResult };

  const now = nowTW();
  const c = buildCaseFromSubmit(data, caseId, now);
  ctx.waitUntil(
    upsertCaseStatement(env, c).run().catch((err) => {
      console.error(JSON.stringify({ action: "submitReport", caseId, error: err.message }));
    }),
  );

  return { success: true, caseId, ...gasResult };
}

// ─── Submit (admin) ───────────────────────────────────────
// 里長/辦公處登入後送出的通報，沿用 submitReport 的 GAS+D1 寫入流程，
// 差別只在於這個 action 走 admin 驗證，且前端可一併帶上
// status / publicFlag / publicTitle / publicCate / publicLoc / publicSummary。
async function submitAdminReport(env, ctx, data) {
  return submitReport(env, ctx, data);
}

// ─── Admin writes ─────────────────────────────────────────

async function updateReply(env, ctx, data) {
  const caseId = requireId(data.caseId, "Missing caseId");
  const row = await env.DB.prepare("SELECT payload_json FROM cases WHERE case_id = ?")
    .bind(caseId).first();

  const now = nowTW();
  if (row) {
    const existing = parseJson(row.payload_json);
    const updated = applyReplyFields(existing, data, now);
    await upsertCaseStatement(env, updated).run();
    ctx.waitUntil(forwardToGas(env, data).catch(logSyncError("updateReply", caseId)));
    return { success: true, case: updated };
  }

  // Not in D1 yet → fire GAS + D1 sync in background; return optimistic success so UI doesn't hang
  ctx.waitUntil(
    forwardToGasResult(env, data)
      .then((gasResult) => {
        if (gasResult.success) return syncCaseFromGas(env, caseId);
      })
      .catch(logSyncError("updateReply/gasFirst", caseId)),
  );
  return { success: true };
}

async function pinCase(env, ctx, data) {
  const caseId = requireId(data.caseId, "Missing caseId");
  const pinOrder = Number(data.pinOrder ?? 0);

  const row = await env.DB.prepare("SELECT payload_json FROM cases WHERE case_id = ?")
    .bind(caseId).first();

  if (row) {
    const updated = { ...parseJson(row.payload_json), pinOrder };
    await upsertCaseStatement(env, updated).run();
    ctx.waitUntil(forwardToGas(env, data).catch(logSyncError("pinCase", caseId)));
    return { success: true };
  }

  const gasResult = await forwardToGas(env, data);
  ctx.waitUntil(
    syncCaseFromGas(env, caseId).catch(logSyncError("pinCase/syncFromGas", caseId)),
  );
  return gasResult;
}

async function reorderCases(env, ctx, data) {
  const order = Array.isArray(data.order) ? data.order : Array.isArray(data.orders) ? data.orders : [];
  if (order.length === 0) return { success: true };

  const statements = order.map(({ caseId, sortOrder }) =>
    env.DB.prepare(
      `UPDATE cases
       SET sort_order = ?,
           payload_json = json_set(payload_json, '$.sortOrder', ?)
       WHERE case_id = ?`,
    ).bind(Number(sortOrder ?? 0), Number(sortOrder ?? 0), text(caseId)),
  );
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  ctx.waitUntil(forwardToGas(env, data).catch(logSyncError("reorderCases", "batch")));
  return { success: true };
}

async function deleteCase(env, ctx, data) {
  const caseId = requireId(data.caseId, "Missing caseId");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM cases WHERE case_id = ?").bind(caseId),
    env.DB.prepare("DELETE FROM case_views WHERE case_id = ?").bind(caseId),
  ]);
  ctx.waitUntil(forwardToGas(env, data).catch(logSyncError("deleteCase", caseId)));
  return { success: true };
}

async function batchUpdateCases(env, ctx, data) {
  const caseIds = Array.isArray(data.caseIds)
    ? data.caseIds.map((id) => text(id)).filter(Boolean)
    : [];
  if (!caseIds.length) return { success: true, updated: 0 };
  if (caseIds.length > 100) throw httpError(400, "一次最多批量更新 100 筆");

  const placeholders = caseIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM cases WHERE case_id IN (${placeholders})`,
  ).bind(...caseIds).all();

  if (!rows.results.length) return { success: true, updated: 0 };

  const now = nowTW();
  const updatedCases = [];
  const statements = [];

  for (const row of rows.results) {
    const existing = parseJson(row.payload_json);
    const updatedCase = applyReplyFields(existing, data, now);
    updatedCases.push(updatedCase);
    statements.push(upsertCaseStatement(env, updatedCase));
  }

  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }

  ctx.waitUntil(
    Promise.allSettled(
      updatedCases.map((c) => {
        const gasPayload = { ...data, action: "updateReply", caseId: c.caseId };
        delete gasPayload.caseIds;
        return forwardToGasResult(env, gasPayload).catch(
          logSyncError("batchUpdateCases", c.caseId),
        );
      }),
    ),
  );

  return { success: true, updated: updatedCases.length, cases: updatedCases };
}

// ─── Helpers ──────────────────────────────────────────────

function buildCaseFromSubmit(data, caseId, now) {
  return {
    caseId,
    reportTime: text(data.reportTime) || now,
    status: text(data.status) || "新案件",
    category: text(data.category || data.cate),
    name: text(data.name),
    phone: text(data.phone),
    lineId: text(data.lineId),
    title: text(data.title),
    description: text(data.description || data.desc),
    addr: text(data.addr),
    mapUrl: text(data.mapUrl || data.map),
    case1999: text(data.case1999),
    photo1: normalizePublicUrl(data.photo1), photo2: normalizePublicUrl(data.photo2),
    photo3: normalizePublicUrl(data.photo3), photo4: normalizePublicUrl(data.photo4), photo5: normalizePublicUrl(data.photo5),
    replyTime: "", lastUpdate: now, replyContent: "",
    repPhoto1: "", repPhoto2: "", repPhoto3: "", repPhoto4: "", repPhoto5: "",
    repPhoto6: "", repPhoto7: "", repPhoto8: "", repPhoto9: "", repPhoto10: "",
    handler: "", note: "",
    publicFlag: parseBoolean(data.publicFlag),
    publicTitle: text(data.publicTitle), publicCate: text(data.publicCate),
    publicLoc: text(data.publicLoc), publicSummary: text(data.publicSummary),
    replyUrl: "https://gsnbhs.pages.dev/detail.html?id=" + encodeURIComponent(caseId),
    pinOrder: 0, sortOrder: 0,
  };
}

function applyReplyFields(existing, data, now) {
  // Normalize snake_case field names sent by the frontend form
  const rc    = data.replyContent   !== undefined ? data.replyContent   : data.reply_content;
  const note  = data.note           !== undefined ? data.note           : data.PS;
  const pf    = data.publicFlag     !== undefined ? data.publicFlag     : data.public;
  const pt    = data.publicTitle    !== undefined ? data.publicTitle    : data.public_title;
  const pc    = data.publicCate     !== undefined ? data.publicCate     : data.public_category;
  const pl    = data.publicLoc      !== undefined ? data.publicLoc      : data.public_location;
  const ps    = data.publicSummary  !== undefined ? data.publicSummary  : data.public_content;
  const rp = (n) => {
    const cam = data["repPhoto"   + n];
    const sna = data["reply_photo" + n];
    return cam !== undefined ? cam : sna !== undefined ? sna : existing["repPhoto" + n];
  };
  return {
    ...existing,
    status:       text(data.status) || existing.status,
    replyTime:    now,
    lastUpdate:   now,
    replyContent: rc        !== undefined ? text(rc)   : existing.replyContent,
    repPhoto1:  rp(1),  repPhoto2:  rp(2),  repPhoto3:  rp(3),
    repPhoto4:  rp(4),  repPhoto5:  rp(5),  repPhoto6:  rp(6),
    repPhoto7:  rp(7),  repPhoto8:  rp(8),  repPhoto9:  rp(9),  repPhoto10: rp(10),
    handler:      data.handler  !== undefined ? text(data.handler)  : existing.handler,
    note:         note          !== undefined ? text(note)           : existing.note,
    publicFlag:   pf            !== undefined ? parseBoolean(pf)     : existing.publicFlag,
    publicTitle:  pt            !== undefined ? text(pt)             : existing.publicTitle,
    publicCate:   pc            !== undefined ? text(pc)             : existing.publicCate,
    publicLoc:    pl            !== undefined ? text(pl)             : existing.publicLoc,
    publicSummary:ps            !== undefined ? text(ps)             : existing.publicSummary,
    replyUrl:     data.replyUrl !== undefined ? text(data.replyUrl)  : existing.replyUrl,
  };
}

function sanitizePublic(c) {
  const { name, phone, lineId, note, handler, ...rest } = c;
  return rest;
}

async function syncCaseFromGas(env, caseId) {
  const gasResult = await forwardToGasResult(env, { action: "getCase", caseId });
  const c = gasResult.caseData || gasResult.case;
  if (!gasResult.success || !c) return;
  await upsertCaseStatement(env, c).run();
}

function upsertCaseStatement(env, c) {
  const payload = JSON.stringify(c);
  return env.DB.prepare(
    `INSERT INTO cases (
       case_id, report_time, status, category, name, phone, line_id,
       title, description, addr, map_url, case1999,
       photo1, photo2, photo3, photo4, photo5,
       reply_time, last_update, reply_content,
       rep_photo1, rep_photo2, rep_photo3, rep_photo4, rep_photo5,
       rep_photo6, rep_photo7, rep_photo8, rep_photo9, rep_photo10,
       handler, note, public_flag, public_title, public_cate, public_loc,
       public_summary, reply_url, pin_order, sort_order, payload_json
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?
     )
     ON CONFLICT(case_id) DO UPDATE SET
       report_time=excluded.report_time, status=excluded.status,
       category=excluded.category, name=excluded.name,
       phone=excluded.phone, line_id=excluded.line_id,
       title=excluded.title, description=excluded.description,
       addr=excluded.addr, map_url=excluded.map_url, case1999=excluded.case1999,
       photo1=excluded.photo1, photo2=excluded.photo2,
       photo3=excluded.photo3, photo4=excluded.photo4, photo5=excluded.photo5,
       reply_time=excluded.reply_time, last_update=excluded.last_update,
       reply_content=excluded.reply_content,
       rep_photo1=excluded.rep_photo1, rep_photo2=excluded.rep_photo2,
       rep_photo3=excluded.rep_photo3, rep_photo4=excluded.rep_photo4,
       rep_photo5=excluded.rep_photo5, rep_photo6=excluded.rep_photo6,
       rep_photo7=excluded.rep_photo7, rep_photo8=excluded.rep_photo8,
       rep_photo9=excluded.rep_photo9, rep_photo10=excluded.rep_photo10,
       handler=excluded.handler, note=excluded.note,
       public_flag=excluded.public_flag, public_title=excluded.public_title,
       public_cate=excluded.public_cate, public_loc=excluded.public_loc,
       public_summary=excluded.public_summary, reply_url=excluded.reply_url,
       pin_order=excluded.pin_order, sort_order=excluded.sort_order,
       payload_json=excluded.payload_json`,
  ).bind(
    text(c.caseId),
    text(c.reportTime),
    text(c.status),
    text(c.category),
    text(c.name),
    text(c.phone),
    text(c.lineId),
    text(c.title),
    text(c.description || c.desc),
    text(c.addr),
    text(c.mapUrl),
    text(c.case1999),
    text(c.photo1), text(c.photo2), text(c.photo3), text(c.photo4), text(c.photo5),
    text(c.replyTime),
    text(c.lastUpdate),
    text(c.replyContent),
    text(c.repPhoto1), text(c.repPhoto2), text(c.repPhoto3), text(c.repPhoto4), text(c.repPhoto5),
    text(c.repPhoto6), text(c.repPhoto7), text(c.repPhoto8), text(c.repPhoto9), text(c.repPhoto10),
    text(c.handler),
    text(c.note),
    parseBoolean(c.publicFlag) ? 1 : 0,
    text(c.publicTitle),
    text(c.publicCate),
    text(c.publicLoc),
    text(c.publicSummary),
    text(c.replyUrl),
    Number(c.pinOrder || 0),
    Number(c.sortOrder || 0),
    payload,
  );
}

function logSyncError(action, id) {
  return (err) => {
    console.error(JSON.stringify({ action, id, syncTarget: "gas", error: err.message }));
  };
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

// ─── GAS proxy ────────────────────────────────────────────

async function forwardToGas(env, data) {
  const json = await forwardToGasResult(env, data);
  if (!json.success) {
    const error = httpError(Number(json.code || 502), json.error || "GAS sync failed");
    error.gasResponse = json;
    throw error;
  }
  return json;
}

async function forwardToGasResult(env, data) {
  if (!env.GAS_SCRIPT_URL) throw httpError(503, "GAS_SCRIPT_URL not configured");
  const response = await fetch(env.GAS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(data),
  });
  return response.json();
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

function normalizePublicUrl(value) {
  const url = text(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function parseBoolean(value) {
  if (value === true) return true;
  const s = String(value).toUpperCase().trim();
  return s === "TRUE" || s === "是";
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

async function uploadCasePhoto(env, data) {
  let b64 = text(data.imageBase64 || data.base64);
  if (!b64) return { success: false, error: "Missing imageBase64" };
  const comma = b64.indexOf(",");
  if (comma !== -1) b64 = b64.slice(comma + 1);
  if (b64.length * 0.75 > 2 * 1024 * 1024) return { success: false, error: "圖片過大，請壓縮至 2MB 以下" };
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_DRIVE_FOLDER_ID) return { success: false, error: "Drive 未設定" };
  const mimeType = text(data.mimeType) || "image/jpeg";
  const ext = mimeType.split("/")[1] || "jpg";
  const url = await uploadToDrive(env, b64, mimeType, `case_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
  return { success: true, url };
}
