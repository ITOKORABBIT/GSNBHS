var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/utils.js
var CHECKIN_RADIUS_METERS = 100;
function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
__name(parseJson, "parseJson");
function text(value) {
  return value === void 0 || value === null ? "" : String(value).trim();
}
__name(text, "text");
function parseBoolean(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}
__name(parseBoolean, "parseBoolean");
function requireId(value, message) {
  const id = text(value);
  if (!id) throw httpError(400, message);
  return id;
}
__name(requireId, "requireId");
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
__name(httpError, "httpError");
function compactDate() {
  const ms = Date.now() + 8 * 60 * 60 * 1e3;
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}
__name(compactDate, "compactDate");
function parseTaiwanIsoToMs(value) {
  if (!value) return NaN;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]);
  const d = new Date(value);
  return isNaN(d) ? NaN : d.getTime();
}
__name(parseTaiwanIsoToMs, "parseTaiwanIsoToMs");
function taiwanIsoNow() {
  const ms = Date.now() + 8 * 60 * 60 * 1e3;
  return new Date(ms).toISOString().slice(0, 16);
}
__name(taiwanIsoNow, "taiwanIsoNow");
function taiwanIsoMinutesAgo(minutes) {
  const ms = Date.now() + 8 * 60 * 60 * 1e3 - minutes * 60 * 1e3;
  return new Date(ms).toISOString().slice(0, 16);
}
__name(taiwanIsoMinutesAgo, "taiwanIsoMinutesAgo");
function isWithinRegWindow(event) {
  const now = Date.now();
  const regStart = event.registrationStart ? parseTaiwanIsoToMs(event.registrationStart) : 0;
  const regEnd = event.registrationEnd ? parseTaiwanIsoToMs(event.registrationEnd) : Infinity;
  return now >= regStart && now <= regEnd;
}
__name(isWithinRegWindow, "isWithinRegWindow");

// src/auth.js
var sessionCache = /* @__PURE__ */ new Map();
var SESSION_CACHE_TTL = 5 * 60 * 1e3;
var jwksCache = null;
var jwksCacheAt = 0;
var JWKS_TTL = 36e5;
async function getGoogleJwks() {
  if (jwksCache && Date.now() - jwksCacheAt < JWKS_TTL) return jwksCache;
  const resp = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = await resp.json();
  jwksCache = keys;
  jwksCacheAt = Date.now();
  return keys;
}
__name(getGoogleJwks, "getGoogleJwks");
function b64urlToBytes(str) {
  return Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
__name(b64urlToBytes, "b64urlToBytes");
async function verifyGoogleIdToken(env, idToken) {
  if (!idToken || !env.GOOGLE_CLIENT_ID) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const dec = new TextDecoder();
    const header = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
    const now = Math.floor(Date.now() / 1e3);
    if (payload.exp < now) return null;
    if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) return null;
    if (payload.aud !== env.GOOGLE_CLIENT_ID) return null;
    const keys = await getGoogleJwks();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
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
__name(verifyGoogleIdToken, "verifyGoogleIdToken");
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
    body: JSON.stringify({ action: "refreshSession", sessionToken: token })
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
__name(requireAdmin, "requireAdmin");
async function forwardToGas(env, data) {
  const json = await forwardToGasResult(env, data);
  if (!json.success) {
    const error = httpError(Number(json.code || 502), json.error || "GAS sync failed");
    error.gasResponse = json;
    throw error;
  }
  return json;
}
__name(forwardToGas, "forwardToGas");
async function forwardToGasResult(env, data) {
  if (!env.GAS_SCRIPT_URL) throw httpError(503, "GAS_SCRIPT_URL not configured");
  const response = await fetch(env.GAS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(data)
  });
  const json = await response.json();
  return json;
}
__name(forwardToGasResult, "forwardToGasResult");
async function requireImporter(env, data) {
  if (env.IMPORT_TOKEN && text(data.importToken) === env.IMPORT_TOKEN) return;
  throw httpError(401, "Unauthorized");
}
__name(requireImporter, "requireImporter");
function corsJson(env, body, status = 200) {
  return corsResponse(env, JSON.stringify(body), status, {
    "content-type": "application/json;charset=utf-8"
  });
}
__name(corsJson, "corsJson");
function corsResponse(env, body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "null",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      ...headers
    }
  });
}
__name(corsResponse, "corsResponse");

// src/db.js
async function getEventPayload(env, eventId) {
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first();
  return row ? parseJson(row.payload_json) : null;
}
__name(getEventPayload, "getEventPayload");
function upsertEventStatement(env, event) {
  return env.DB.prepare(
    `INSERT INTO events (
      event_id, event_name, status, event_start, event_end, registration_start,
      registration_end, survey_id, registered_count, updated_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      event_name = excluded.event_name,
      status = excluded.status,
      event_start = excluded.event_start,
      event_end = excluded.event_end,
      registration_start = excluded.registration_start,
      registration_end = excluded.registration_end,
      survey_id = excluded.survey_id,
      registered_count = excluded.registered_count,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json`
  ).bind(
    event.eventId,
    text(event.eventName),
    text(event.status),
    text(event.eventStart),
    text(event.eventEnd),
    text(event.registrationStart),
    text(event.registrationEnd),
    text(event.surveyId),
    Number(event.registeredCount || 0),
    text(event.updatedAt || event.createdAt || ""),
    JSON.stringify(event)
  );
}
__name(upsertEventStatement, "upsertEventStatement");
function normalizeEvent(event) {
  return {
    ...event,
    eventId: text(event.eventId),
    eventName: text(event.eventName),
    status: text(event.status),
    registeredCount: Number(event.registeredCount || 0)
  };
}
__name(normalizeEvent, "normalizeEvent");
function eventUpdatePayload(data) {
  const blocked = /* @__PURE__ */ new Set([
    "action",
    "sessionToken",
    "id_token",
    "importToken",
    "eventId",
    "registeredCount",
    "registrationSheet",
    "createdAt",
    "surveySentAt"
  ]);
  const payload = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (blocked.has(key)) continue;
    payload[key] = value;
  }
  return payload;
}
__name(eventUpdatePayload, "eventUpdatePayload");
async function countRegistrations(env, eventId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM event_registrations WHERE event_id = ?"
  ).bind(eventId).first();
  return Number(row?.count || 0);
}
__name(countRegistrations, "countRegistrations");
async function syncEventRegisteredCount(env, eventId) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `UPDATE events
        SET registered_count = (SELECT COALESCE(SUM(headcount),0) FROM event_registrations WHERE event_id = ?),
            payload_json = json_set(payload_json,
              '$.registeredCount', (SELECT COALESCE(SUM(headcount),0) FROM event_registrations WHERE event_id = ?),
              '$.updatedAt', ?)
      WHERE event_id = ?`
  ).bind(eventId, eventId, now, eventId).run();
  const row = await env.DB.prepare(
    "SELECT registered_count FROM events WHERE event_id = ?"
  ).bind(eventId).first();
  return Number(row?.registered_count || 0);
}
__name(syncEventRegisteredCount, "syncEventRegisteredCount");
function upsertRegistrationStatement(env, eventId, registration) {
  const regId = text(registration.regId) || crypto.randomUUID();
  const normalized = { ...registration, regId, eventId };
  return env.DB.prepare(
    `INSERT INTO event_registrations (
      event_id, reg_id, line_user_id, display_name, checked_in, submitted_at, headcount, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, reg_id) DO UPDATE SET
      line_user_id = excluded.line_user_id,
      display_name = excluded.display_name,
      checked_in = excluded.checked_in,
      submitted_at = excluded.submitted_at,
      headcount = excluded.headcount,
      payload_json = excluded.payload_json`
  ).bind(
    eventId,
    regId,
    text(registration.lineUserId),
    text(registration.displayName),
    text(registration.checkedIn || "FALSE").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
    text(registration.submittedAt),
    Number(registration.headcount || 0) || 1,
    JSON.stringify(normalized)
  );
}
__name(upsertRegistrationStatement, "upsertRegistrationStatement");
function isSystemRegistrationColumn(key) {
  return (/* @__PURE__ */ new Set(["regId", "eventId", "lineUserId", "submittedAt", "headcount"])).has(key);
}
__name(isSystemRegistrationColumn, "isSystemRegistrationColumn");
function upsertSurveyStatement(env, survey) {
  return env.DB.prepare(
    `INSERT INTO surveys (survey_id, survey_name, updated_at, payload_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(survey_id) DO UPDATE SET
       survey_name = excluded.survey_name,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`
  ).bind(
    text(survey.surveyId),
    text(survey.surveyName),
    text(survey.updatedAt || survey.createdAt || ""),
    JSON.stringify(survey)
  );
}
__name(upsertSurveyStatement, "upsertSurveyStatement");
function normalizeSurvey(survey) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...survey,
    surveyId: text(survey.surveyId),
    surveyName: text(survey.surveyName),
    surveyFileName: text(survey.surveyFileName),
    questions: normalizeSurveyQuestions(survey.questions || []),
    createdAt: text(survey.createdAt || now),
    updatedAt: text(survey.updatedAt || now),
    createdBy: text(survey.createdBy),
    introTitle: text(survey.introTitle || survey.surveyName),
    introDescription: text(survey.introDescription),
    outroTitle: text(survey.outroTitle),
    outroDescription: text(survey.outroDescription)
  };
}
__name(normalizeSurvey, "normalizeSurvey");
function normalizeSurveyQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).map((question, index) => {
    const q = question || {};
    let type = text(q.type || "text");
    if (type === "radio") type = "single";
    if (type === "checkbox") type = "multi";
    if (!["text", "single", "multi", "scale"].includes(type)) type = "text";
    let options = Array.isArray(q.options) ? q.options.map((option) => text(option)).filter(Boolean) : [];
    if (type === "scale") options = ["1", "2", "3", "4", "5"];
    return {
      id: text(q.id) || `srv_q_${index}`,
      type,
      label: text(q.label) || `\u554F\u984C ${index + 1}`,
      required: q.required === true || text(q.required).toUpperCase() === "TRUE",
      options,
      allowOther: q.allowOther === true || text(q.allowOther).toUpperCase() === "TRUE",
      maxLength: Math.min(500, Math.max(1, Number.parseInt(q.maxLength, 10) || 200))
    };
  });
}
__name(normalizeSurveyQuestions, "normalizeSurveyQuestions");
function surveyUpdatePayload(data) {
  const blocked = /* @__PURE__ */ new Set(["action", "sessionToken", "id_token", "importToken", "surveyId", "createdAt"]);
  const payload = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (blocked.has(key)) continue;
    payload[key] = value;
  }
  return payload;
}
__name(surveyUpdatePayload, "surveyUpdatePayload");
function upsertSurveyResponseStatement(env, response) {
  const normalized = normalizeSurveyResponse(response);
  return env.DB.prepare(
    `INSERT INTO survey_responses (
      survey_id, response_id, event_id, event_name, line_user_id, display_name,
      resident_note, submitted_at, source, answers_json, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(survey_id, response_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_name = excluded.event_name,
      line_user_id = excluded.line_user_id,
      display_name = excluded.display_name,
      resident_note = excluded.resident_note,
      submitted_at = excluded.submitted_at,
      source = excluded.source,
      answers_json = excluded.answers_json,
      payload_json = excluded.payload_json`
  ).bind(
    normalized.surveyId,
    normalized.responseId,
    normalized.eventId,
    normalized.eventName,
    normalized.lineUserId,
    normalized.displayName,
    normalized.residentNote,
    normalized.submittedAt,
    normalized.source,
    JSON.stringify(normalized.answers || {}),
    JSON.stringify(normalized)
  );
}
__name(upsertSurveyResponseStatement, "upsertSurveyResponseStatement");
function normalizeSurveyResponse(response) {
  return {
    ...response,
    surveyId: text(response.surveyId),
    responseId: text(response.responseId || response.srvRespId) || crypto.randomUUID(),
    eventId: text(response.eventId),
    eventName: text(response.eventName),
    lineUserId: text(response.lineUserId),
    displayName: text(response.displayName),
    residentNote: text(response.residentNote),
    submittedAt: text(response.submittedAt),
    source: text(response.source || "web"),
    answers: response.answers && typeof response.answers === "object" ? response.answers : {}
  };
}
__name(normalizeSurveyResponse, "normalizeSurveyResponse");
function normalizeSurveyResponseStatus(registered, attended, filled) {
  if (registered && attended && filled) return "registered_attended_filled";
  if (registered && attended && !filled) return "registered_attended_missing";
  if (registered && !attended && filled) return "registered_absent_filled";
  if (registered && !attended && !filled) return "registered_absent_missing";
  if (!registered && attended && filled) return "walkin_filled";
  if (!registered && attended && !filled) return "walkin_missing";
  return "missing";
}
__name(normalizeSurveyResponseStatus, "normalizeSurveyResponseStatus");
function answersToMap(answers) {
  const out = {};
  for (const answer of answers) {
    const label = text(answer?.label);
    if (!label) continue;
    out[label] = Array.isArray(answer.value) ? answer.value.map((value) => text(value)).join("\u3001") : text(answer.value);
  }
  return out;
}
__name(answersToMap, "answersToMap");
function upsertWalkInStatement(env, walkin) {
  const normalized = normalizeWalkInAttendance(walkin);
  return env.DB.prepare(
    `INSERT INTO survey_walkin_attendance (
      attendance_id, survey_id, event_id, event_name, line_user_id, display_name,
      resident_note, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(attendance_id) DO UPDATE SET
      survey_id = excluded.survey_id,
      event_id = excluded.event_id,
      event_name = excluded.event_name,
      line_user_id = excluded.line_user_id,
      display_name = excluded.display_name,
      resident_note = excluded.resident_note,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json`
  ).bind(
    normalized.attendanceId,
    normalized.surveyId,
    normalized.eventId,
    normalized.eventName,
    normalized.lineUserId,
    normalized.displayName,
    normalized.residentNote,
    normalized.createdAt,
    JSON.stringify(normalized)
  );
}
__name(upsertWalkInStatement, "upsertWalkInStatement");
function normalizeWalkInAttendance(walkin) {
  return {
    ...walkin,
    attendanceId: text(walkin.attendanceId) || crypto.randomUUID(),
    surveyId: text(walkin.surveyId),
    eventId: text(walkin.eventId),
    eventName: text(walkin.eventName),
    lineUserId: text(walkin.lineUserId),
    displayName: text(walkin.displayName),
    residentNote: text(walkin.residentNote || walkin.note),
    createdAt: text(walkin.createdAt)
  };
}
__name(normalizeWalkInAttendance, "normalizeWalkInAttendance");
function upsertResidentNoteStatement(env, note) {
  const normalized = normalizeResidentNote(note);
  return env.DB.prepare(
    `INSERT INTO resident_notes (line_user_id, display_name, note, updated_at, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(line_user_id) DO UPDATE SET
       display_name = excluded.display_name,
       note = excluded.note,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`
  ).bind(
    normalized.lineUserId,
    normalized.displayName,
    normalized.note,
    normalized.updatedAt,
    JSON.stringify(normalized)
  );
}
__name(upsertResidentNoteStatement, "upsertResidentNoteStatement");
function normalizeResidentNote(note) {
  return {
    lineUserId: text(note.lineUserId),
    displayName: text(note.displayName),
    note: text(note.note),
    updatedAt: text(note.updatedAt) || (/* @__PURE__ */ new Date()).toISOString()
  };
}
__name(normalizeResidentNote, "normalizeResidentNote");

// src/contacts.js
async function getEmergencyContacts(env) {
  const rows = await env.DB.prepare(
    "SELECT id, name, phone, org, sort_order, kind FROM emergency_contacts ORDER BY sort_order ASC, name ASC"
  ).all();
  return { success: true, contacts: rows.results || [] };
}
__name(getEmergencyContacts, "getEmergencyContacts");
function normalizeKind_(kind) {
  return kind === "hint" || kind === "url" ? kind : "tel";
}
__name(normalizeKind_, "normalizeKind_");
async function addEmergencyContact(env, data) {
  const name = text(data.name);
  const kind = normalizeKind_(text(data.kind));
  const phone = text(data.phone);
  if (!name) throw httpError(400, "Missing name");
  if (kind !== "hint" && !phone) throw httpError(400, "Missing phone/link");
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO emergency_contacts (id, name, phone, org, sort_order, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, phone, text(data.org), Number(data.sortOrder) || 0, kind, (/* @__PURE__ */ new Date()).toISOString()).run();
  return { success: true, id };
}
__name(addEmergencyContact, "addEmergencyContact");
async function updateEmergencyContact(env, data) {
  const id = requireId(data.id, "Missing id");
  const name = text(data.name);
  const kind = normalizeKind_(text(data.kind));
  const phone = text(data.phone);
  if (!name) throw httpError(400, "Missing name");
  if (kind !== "hint" && !phone) throw httpError(400, "Missing phone/link");
  await env.DB.prepare(
    "UPDATE emergency_contacts SET name = ?, phone = ?, org = ?, sort_order = ?, kind = ? WHERE id = ?"
  ).bind(name, phone, text(data.org), Number(data.sortOrder) || 0, kind, id).run();
  return { success: true };
}
__name(updateEmergencyContact, "updateEmergencyContact");
async function deleteEmergencyContact(env, data) {
  const id = requireId(data.id, "Missing id");
  await env.DB.prepare("DELETE FROM emergency_contacts WHERE id = ?").bind(id).run();
  return { success: true };
}
__name(deleteEmergencyContact, "deleteEmergencyContact");
async function getEmergencyContactsForLine(env) {
  const rows = await env.DB.prepare(
    "SELECT name, phone, org, kind FROM emergency_contacts ORDER BY sort_order ASC, name ASC"
  ).all();
  return rows.results || [];
}
__name(getEmergencyContactsForLine, "getEmergencyContactsForLine");

// src/chat.js
async function insertChatMessage(env, { lineUserId, displayName, role, content }) {
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, line_user_id, display_name, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), lineUserId, text(displayName), role, content, (/* @__PURE__ */ new Date()).toISOString()).run();
}
__name(insertChatMessage, "insertChatMessage");
async function getChatThreads(env) {
  const rows = await env.DB.prepare(
    `SELECT line_user_id,
            MAX(display_name) AS display_name,
            MAX(created_at) AS last_at,
            COUNT(*) AS message_count
     FROM chat_messages
     GROUP BY line_user_id
     ORDER BY last_at DESC`
  ).all();
  return { success: true, threads: rows.results || [] };
}
__name(getChatThreads, "getChatThreads");
async function getChatMessages(env, data) {
  const lineUserId = text(data.lineUserId);
  if (!lineUserId) throw httpError(400, "Missing lineUserId");
  const rows = await env.DB.prepare(
    `SELECT role, content, created_at FROM chat_messages
     WHERE line_user_id = ? ORDER BY created_at ASC`
  ).bind(lineUserId).all();
  return { success: true, messages: rows.results || [] };
}
__name(getChatMessages, "getChatMessages");

// src/line.js
var LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";
var LINE_PUSH_API = "https://api.line.me/v2/bot/message/push";
var LINE_MULTICAST_API = "https://api.line.me/v2/bot/message/multicast";
var SURVEY_BASE_URL = "https://gsnbhs.pages.dev/survey";
var VOUCHER_URL = "https://gsnbhs.pages.dev/voucher.html";
var BULLETIN_URL = "https://gsnbhs.pages.dev/bulletin.html";
var STORE_DETAIL_URL = "https://gsnbhs.pages.dev/storeopendetail.html?id=";
var STORE_LIST_URL = "https://gsnbhs.pages.dev/storeopenlist.html";
var STORE_APPLY_URL = "https://gsnbhs.pages.dev/store";
var STORE_IMG_FALLBACK = "https://lh3.googleusercontent.com/d/1GAb13SxqDBjTnnwZZjNubyJEWxqibs-Z";
var EVENT_IMG_FALLBACK = "https://gsnbhs.pages.dev/HP_logo.png";
var KV_SESSION_TTL = 6 * 60 * 60;
var EVT_START_RE = /^(我要報名|活動報名|報名活動|報名|活動查詢)$/;
var EVT_LOOKUP_RE = /^(查詢報名|報名查詢|查報名|有沒有報名成功)$/;
var EVT_CANCEL_RE = /^(取消|離開|結束|不報了|算了)$/;
var EVT_WALKIN_QR_RE = /^現場報名_(EVT[\w]+)$/;
var RPT_TYPES = ["\u9053\u8DEF\u53CA\u4EA4\u901A", "\u74B0\u5883\u53CA\u885B\u751F", "\u516C\u5171\u8A2D\u65BD", "\u5B89\u5168\u7591\u616E", "\u5176\u4ED6"];
var RPT_START_RE = /^(我要通報|通報問題|里民通報|問題通報)$/;
var RPT_CANCEL_RE_R = /^(取消|離開|結束|算了|不通報了)$/;
var COM_START_RE = /^(加入共學社群|共學社群|家長共學社群|加入家長共學社群)$/;
var COM_CANCEL_RE = /^(取消|離開|結束|算了|不加了)$/;
var COM_QUESTIONS = [
  { key: "current_school", prompt: "1\uFE0F\u20E3 \u8ACB\u554F\u5B69\u5B50\u300C\u76EE\u524D\u5C31\u8B80\u7684\u5B78\u6821\u8207\u5E74\u7D1A\u300D\uFF1F\n\uFF08\u4F8B\uFF1A\u820A\u793E\u570B\u5C0F \u4E09\u5E74\u7D1A\uFF09" },
  { key: "target_school", prompt: "2\uFE0F\u20E3 \u8ACB\u554F\u300C\u9810\u8A08\u5C31\u8B80\u7684\u5B78\u6821\u300D\uFF1F\n\uFF08\u82E5\u66AB\u6642\u9084\u6C92\u6709\uFF0C\u53EF\u56DE\u8986\u300C\u672A\u5B9A\u300D\uFF09" },
  { key: "residence", prompt: "3\uFE0F\u20E3 \u8ACB\u554F\u60A8\u7684\u300C\u5C45\u4F4F\u5730\u540D\u300D\uFF1F\n\uFF08\u4F8B\uFF1A\u5317\u5C6F\u5340\u6566\u5357\u8DEF\uFF0C\u4E0D\u9700\u586B\u5B8C\u6574\u9580\u724C\uFF09" }
];
var COM_INTRO_TEXT = "\u70BA\u4E86\u8B93\u5BB6\u9577\u80FD\u66F4\u65B9\u4FBF\u53D6\u5F97\uFF3B\u6559\u80B2\u76F8\u95DC\u8CC7\u8A0A\uFF3D\uFF0C\u4E26\u5728\u6C42\u5B78\u904E\u7A0B\u4E2D\uFF3B\u9047\u5230\u4E8B\u60C5\u5373\u6642\u901A\u5831\u53CD\u61C9\uFF3D\uFF0C\u91CC\u9577\u5EFA\u7ACB\u4E86\u300C\u91CC\u60F3\u751F\u6D3B\uFF5C\u570B\u4E2D\u5C0F\u5BB6\u9577\u5171\u5B78\u7248\u300D\u3002\n\n\u9664\u4E86\u5BB6\u9577\u4E4B\u9593\u8CC7\u8A0A\u4EA4\u6D41\u8207\u7D93\u9A57\u5206\u4EAB\uFF0C\u4E5F\u8B93\u5B69\u5B50\u5728\u4E0D\u540C\u5B78\u7FD2\u968E\u6BB5\u90FD\u80FD\u6709\u66F4\u597D\u7684\u652F\u6301\u8207\u8CC7\u6E90\u3002\n\n\u{1F4CC} \u793E\u7FA4\u4EA4\u6D41\u539F\u5247\n\u2714 \u5206\u4EAB\u8CC7\u8A0A\u76E1\u91CF\u9644\u4F86\u6E90\n\u2714 \u5C0A\u91CD\u4E0D\u540C\u5BB6\u9577\u7684\u7D93\u9A57\n\u2714 \u4E0D\u50B3\u64AD\u672A\u7D93\u8B49\u5BE6\u6D88\u606F\n\u2714 \u4E0D\u9032\u884C\u653B\u64CA\u6216\u8B3E\u7F75\n\n\u70BA\u7DAD\u8B77\u5B78\u751F\u6B0A\u76CA\u8207\u5B89\u5168\uFF0C\u672C\u7248\u70BA\u534A\u5BE6\u540D\u5236\uFF0C\u52A0\u5165\u9700\u5148\u8207\u91CC\u9577\u767B\u8A18\uFF0C\u76EE\u524D\u50C5\u958B\u653E\u5E7C\u7A1A\u5712\u4EE5\u4E0A\u5B78\u7AE5\u5BB6\u9577\u53C3\u52A0\u3002\n\n\u63A5\u4E0B\u4F86\u6703\u8ACB\u60A8\u56DE\u7B54 3 \u500B\u554F\u984C\uFF0C\u9001\u51FA\u5F8C\u7531\u91CC\u9577\u5BE9\u6838\uFF0C\u901A\u904E\u5C31\u6703\u628A\u793E\u7FA4\u9023\u7D50\u50B3\u7D66\u60A8 \u{1F60A}";
var BULLETIN_ACTIONS = {
  "action:community": { label: "\u52A0\u5165\u5171\u5B78\u7FA4", data: "action=menu&menu=community" }
};
var COM_JOINED_NOTE = "\u52A0\u5165\u5F8C\u8ACB\u6CE8\u610F\uFF1A\n\u30FB\u66B1\u7A31\u8ACB\u8207\u60A8\u73FE\u5728\u7684 LINE \u540D\u7A31\u4E00\u81F4\n\u30FB\u52A0\u5165\u5F8C\u8ACB\u52FF\u66F4\u6539\u540D\u7A31\uFF0C\u8CC7\u6599\u7121\u6CD5\u6BD4\u5C0D\u5C07\u6703\u79FB\u51FA\u7FA4\u7D44";
var CHAT_FEATURE_ENABLED = false;
var CHAT_START_RE = /^(我要聊天)$/;
var CHAT_EXIT_RE = /^(結束聊天|不聊了|掰掰|再見|返回主選單|我要通報)$/;
var CHAT_MODEL = "claude-haiku-4-5";
var CHAT_MAX_HISTORY = 16;
var CHAT_SYSTEM_PROMPT = "\u4F60\u662F\u300C\u820A\u793E\u91CC\u5C0F\u5E6B\u624B\u300DLINE\u5B98\u65B9\u5E33\u865F\u88E1\u7684\u7559\u8A00\u8490\u96C6\u5C0F\u52A9\u624B\uFF0C\u4F7F\u7528\u53F0\u7063\u7E41\u9AD4\u4E2D\u6587\uFF0C\u500B\u6027\u89AA\u5207\u3001\u7C21\u6F54\u3001\u53E3\u8A9E\u5316\u3002\u4F60\u7684\u4EFB\u52D9\u53EA\u6709\u4E00\u4EF6\u4E8B\uFF1A\u5E6B\u91CC\u9577\u8490\u96C6\u91CC\u6C11\u60F3\u8AAA\u7684\u8A71\uFF0C\u5B8C\u5168\u4E0D\u8CA0\u8CAC\u56DE\u7B54\u4EFB\u4F55\u554F\u984C\u3001\u4E0D\u63D0\u4F9B\u4EFB\u4F55\u5EFA\u8B70\u6216\u8CC7\u8A0A\u3001\u4E0D\u767C\u8868\u610F\u898B\u3002\u898F\u5247\uFF1A1. \u4E0D\u8AD6\u91CC\u6C11\u554F\u4EC0\u9EBC\u554F\u984C\uFF08\u5305\u62EC\u6642\u9593\u3001\u5730\u9EDE\u3001\u653F\u7B56\u3001\u6D3B\u52D5\u3001\u8FA6\u516C\u8655\u8CC7\u8A0A\u7B49\uFF09\uFF0C\u90FD\u4E0D\u8981\u56DE\u7B54\uFF0C\u53EA\u80FD\u89AA\u5207\u5730\u56DE\u61C9\u300C\u5DF2\u7D93\u5E6B\u60A8\u8A18\u9304\u4E0B\u4F86\u4E86\uFF0C\u6703\u8F49\u9054\u7D66\u91CC\u9577\u300D\uFF0C\u4E26\u8996\u9700\u8981\u8FFD\u554F\u7D30\u7BC0\uFF08\u4F8B\u5982\u5730\u9EDE\u3001\u806F\u7D61\u65B9\u5F0F\uFF09\u8B93\u7559\u8A00\u66F4\u5B8C\u6574\u30022. \u7D55\u5C0D\u4E0D\u8981\u63D0\u4F9B\u4EFB\u4F55\u7B54\u6848\u3001\u77E5\u8B58\u3001\u5EFA\u8B70\u3001\u8A55\u8AD6\u6216\u731C\u6E2C\uFF0C\u5373\u4F7F\u4F60\u77E5\u9053\u7B54\u6848\u4E5F\u4E0D\u80FD\u8AAA\u30023. \u6BCF\u6B21\u56DE\u8986\u90FD\u8981\u7C21\u77ED\uFF081-2\u53E5\u8A71\uFF09\uFF0C\u53EA\u505A\u300C\u78BA\u8A8D\u6536\u5230\u300D\u8207\u300C\u8FFD\u554F\u7D30\u7BC0\u300D\u9019\u5169\u4EF6\u4E8B\u30024. \u5982\u679C\u91CC\u6C11\u8A62\u554F\u7DCA\u6025\u72C0\u6CC1\uFF08\u706B\u8B66\u3001\u610F\u5916\u3001\u6025\u75C5\u7B49\uFF09\uFF0C\u8ACB\u63D0\u9192\u4ED6\u76F4\u63A5\u64A5\u6253119/110\uFF0C\u9019\u662F\u552F\u4E00\u7684\u4F8B\u5916\u30025. \u4E0D\u8981\u8AAA\u300C\u6211\u4E0D\u77E5\u9053\u300D\u6216\u9577\u7BC7\u89E3\u91CB\u4F60\u7684\u9650\u5236\uFF0C\u53EA\u8981\u6301\u7E8C\u626E\u6F14\u300C\u6B63\u5728\u8A18\u9304\u7559\u8A00\u7684\u5C0F\u5E6B\u624B\u300D\u5373\u53EF\u3002";
var LINE_CATEGORY_MAP = {
  \u7F8E\u98DF\u5730\u5716: ["\u7F8E\u98DF\u5730\u5716", "\u7F8E\u98DF", "\u9910\u5EF3", "\u5403\u7684", "\u98F2\u98DF", "\u65E9\u9910", "\u5348\u9910", "\u665A\u9910", "\u5BB5\u591C", "\u9EDE\u5FC3"],
  \u98F2\u6599\u51B0\u54C1: ["\u98F2\u6599\u51B0\u54C1", "\u98F2\u6599", "\u51B0\u54C1", "\u624B\u6416", "\u5496\u5561"],
  \u5065\u5EB7\u91AB\u7642: ["\u5065\u5EB7\u91AB\u7642", "\u91AB\u7642", "\u8A3A\u6240", "\u85E5\u5C40", "\u7259\u91AB", "\u4E2D\u91AB"],
  \u751F\u6D3B\u4FBF\u5229: ["\u751F\u6D3B\u4FBF\u5229", "\u751F\u6D3B", "\u7F8E\u5BB9", "\u5065\u8EAB", "\u651D\u5F71", "\u7DAD\u4FEE"],
  \u4F4F\u5B85\u76F8\u95DC: ["\u4F4F\u5B85\u76F8\u95DC", "\u4F4F\u5B85", "\u5C45\u5BB6", "\u88DD\u4FEE", "\u623F\u5C4B"],
  \u5BF5\u7269\u5C08\u5340: ["\u5BF5\u7269\u5C08\u5340", "\u5BF5\u7269", "\u6BDB\u5B69", "\u8C93", "\u72D7"],
  \u5176\u4ED6: ["\u5176\u4ED6", "\u5176\u5B83"]
};
var LINE_CATEGORY_INFO = {
  \u7F8E\u98DF\u5730\u5716: { title: "\u7F8E\u98DF\u5730\u5716", emoji: "\u{1F37D}", subtitle: "\u5728\u5730\u9910\u5EF3 / \u5C0F\u5403", color: "#10B981" },
  \u98F2\u6599\u51B0\u54C1: { title: "\u98F2\u6599\u51B0\u54C1", emoji: "\u{1F964}", subtitle: "\u624B\u6416\u98F2 / \u5496\u5561 / \u51B0\u54C1", color: "#3B82F6" },
  \u5065\u5EB7\u91AB\u7642: { title: "\u5065\u5EB7\u91AB\u7642", emoji: "\u{1F3E5}", subtitle: "\u8A3A\u6240 / \u85E5\u5C40", color: "#8B5CF6" },
  \u751F\u6D3B\u4FBF\u5229: { title: "\u751F\u6D3B\u4FBF\u5229", emoji: "\u{1F9FA}", subtitle: "\u7F8E\u5BB9 / \u5065\u8EAB / \u751F\u6D3B\u670D\u52D9", color: "#0EA5E9" },
  \u4F4F\u5B85\u76F8\u95DC: { title: "\u4F4F\u5B85\u76F8\u95DC", emoji: "\u{1F3E0}", subtitle: "\u5C45\u5BB6 / \u88DD\u4FEE\u670D\u52D9", color: "#F59E0B" },
  \u5BF5\u7269\u5C08\u5340: { title: "\u5BF5\u7269\u5C08\u5340", emoji: "\u{1F43E}", subtitle: "\u6BDB\u5B69\u76F8\u95DC\u670D\u52D9", color: "#EC4899" },
  \u5176\u4ED6: { title: "\u5176\u4ED6", emoji: "\u2728", subtitle: "\u5176\u4ED6\u7279\u7D04\u5546\u5BB6", color: "#64748B" }
};
var MENU_LABELS = {
  news: "\u6700\u65B0\u6D88\u606F",
  course: "\u6559\u80B2\u8AB2\u7A0B",
  apply_event: "\u6D3B\u52D5\u5831\u540D",
  apply_course: "\u8AB2\u7A0B\u5831\u540D"
};
var FOOD_MAP_MENU_ITEMS = [
  { title: "\u7F8E\u98DF\u5730\u5716", emoji: "\u{1F37D}", text: "\u7F8E\u98DF\u5730\u5716", color: "#10B981", desc: "\u5728\u5730\u9910\u5EF3\u3001\u5C0F\u5403\u7279\u7D04\u512A\u60E0\u3002" },
  { title: "\u98F2\u6599\u51B0\u54C1", emoji: "\u{1F964}", text: "\u98F2\u6599\u51B0\u54C1", color: "#3B82F6", desc: "\u624B\u6416\u98F2\u3001\u5496\u5561\u3001\u51B0\u54C1\u7279\u7D04\u512A\u60E0\u3002" },
  { title: "\u5065\u5EB7\u91AB\u7642", emoji: "\u{1F3E5}", text: "\u5065\u5EB7\u91AB\u7642", color: "#8B5CF6", desc: "\u8A3A\u6240\u3001\u85E5\u5C40\u7279\u7D04\u512A\u60E0\u3002" },
  { title: "\u751F\u6D3B\u4FBF\u5229", emoji: "\u{1F9FA}", text: "\u751F\u6D3B\u4FBF\u5229", color: "#0EA5E9", desc: "\u7F8E\u5BB9\u3001\u5065\u8EAB\u7B49\u751F\u6D3B\u670D\u52D9\u3002" },
  { title: "\u4F4F\u5B85\u76F8\u95DC", emoji: "\u{1F3E0}", text: "\u4F4F\u5B85\u76F8\u95DC", color: "#F59E0B", desc: "\u5C45\u5BB6\u3001\u88DD\u4FEE\u76F8\u95DC\u670D\u52D9\u3002" },
  { title: "\u5BF5\u7269\u5C08\u5340", emoji: "\u{1F43E}", text: "\u5BF5\u7269\u5C08\u5340", color: "#EC4899", desc: "\u6BDB\u5B69\u7F8E\u5BB9\u3001\u7528\u54C1\u7B49\u670D\u52D9\u3002" },
  { title: "\u7533\u8ACB\u7279\u7D04", emoji: "\u{1F4DD}", text: "\u5546\u5BB6\u7533\u8ACB", color: "#94A3B8", desc: "\u958B\u653E\u5F8C\u53EF\u7531\u5546\u5BB6\u81EA\u884C\u63D0\u51FA\u7533\u8ACB\u3002" }
];
async function handleLineWebhook(request, env, ctx) {
  const body = await request.text();
  if (!await verifyLineSignature(env, request.headers.get("x-line-signature") || "", body)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const events = Array.isArray(data.events) ? data.events : [];
  ctx.waitUntil(processLineEvents(env, ctx, events));
  return new Response("OK", { status: 200 });
}
__name(handleLineWebhook, "handleLineWebhook");
async function verifyLineSignature(env, signature, body) {
  if (!signature || !env.LINE_CHANNEL_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.LINE_CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(raw))) === signature;
}
__name(verifyLineSignature, "verifyLineSignature");
async function processLineEvents(env, ctx, events) {
  for (const event of events) {
    try {
      await processLineEvent(env, ctx, event);
    } catch (err) {
      console.error(JSON.stringify({ type: "line_event_error", error: err.message }));
    }
  }
}
__name(processLineEvents, "processLineEvents");
async function processLineEvent(env, ctx, event) {
  if (!event?.source?.userId) return;
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  let handled = false;
  try {
    handled = await handleLineMenuEvent(env, userId, replyToken, event);
  } catch (err) {
    console.error(JSON.stringify({ fn: "handleLineMenuEvent", error: err.message }));
  }
  if (!handled) {
    try {
      handled = await handleLineRegEvent(env, ctx, userId, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineRegEvent", userId, error: err.message }));
    }
  }
  if (!handled) {
    try {
      handled = await handleLineReportEvent(env, userId, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineReportEvent", error: err.message }));
    }
  }
  if (!handled) {
    try {
      handled = await handleLineCommunityEvent(env, userId, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineCommunityEvent", error: err.message }));
    }
  }
  if (!handled) {
    try {
      handled = await handleLineChatEvent(env, userId, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineChatEvent", error: err.message }));
    }
  }
  if (!handled) {
    try {
      handled = await handleLineKeywordEvent(env, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineKeywordEvent", error: err.message }));
    }
  }
  if (!handled && env.GAS_SCRIPT_URL) {
    await forwardLineEventToGas(env, event);
  }
}
__name(processLineEvent, "processLineEvent");
async function handleLineRegEvent(env, ctx, userId, replyToken, event) {
  const state = await getEvtSession(env, userId);
  const hasSess = !!state.stage;
  if (event.type === "postback") {
    const pb = parsePostbackData(event.postback?.data || "");
    if (!hasSess && !(pb.action && pb.action.startsWith("evt:"))) return false;
    await handleEvtPostback(env, ctx, userId, replyToken, state, pb);
    return true;
  }
  if (event.type === "message" && event.message?.type === "location") {
    if (state.stage === "checkin_location") {
      await handleEvtCheckinLocation(env, userId, replyToken, state, event.message);
      return true;
    }
    return false;
  }
  if (event.type === "message" && event.message?.type === "text") {
    const msg = String(event.message.text || "").trim();
    if (hasSess) {
      await handleEvtText(env, userId, replyToken, state, msg);
      return true;
    }
    if (EVT_START_RE.test(msg)) {
      await handleEvtStart(env, userId, replyToken);
      return true;
    }
    if (EVT_LOOKUP_RE.test(msg)) {
      await lineReply(env, replyToken, [buildEvtDuplicateSubmitMessage(await findRecentLineRegistration(env, userId, 24 * 60))]);
      return true;
    }
    const walkInMatch = msg.match(EVT_WALKIN_QR_RE);
    if (walkInMatch) {
      await handleEvtWalkInQR(env, userId, replyToken, walkInMatch[1]);
      return true;
    }
    if (/^\d{4}$/.test(msg)) {
      await handleWalkInPin(env, userId, replyToken, msg);
      return true;
    }
  }
  return false;
}
__name(handleLineRegEvent, "handleLineRegEvent");
async function handleEvtStart(env, userId, replyToken) {
  const events = await getActiveEventsForLine(env);
  if (!events.length) return lineReply(env, replyToken, [{ type: "text", text: "\u76EE\u524D\u6C92\u6709\u958B\u653E\u5831\u540D\u7684\u6D3B\u52D5\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u67E5\u8A62\u3002" }]);
  return lineReply(env, replyToken, [buildEvtListCarousel(events)]);
}
__name(handleEvtStart, "handleEvtStart");
async function handleEvtWalkInQR(env, userId, replyToken, eventId) {
  const event = await getEventPayload(env, eventId);
  if (!event || !event.eventId) {
    return lineReply(env, replyToken, [{ type: "text", text: "\u627E\u4E0D\u5230\u6B64\u6D3B\u52D5\uFF0C\u8ACB\u5411\u73FE\u5834\u5DE5\u4F5C\u4EBA\u54E1\u78BA\u8A8D\u3002" }]);
  }
  const status = text(event.status);
  if (status === "\u5DF2\u7D50\u675F" || status === "\u5DF2\u53D6\u6D88") {
    return lineReply(env, replyToken, [{ type: "text", text: `\u300C${text(event.eventName)}\u300D\u5DF2\u7D50\u675F\uFF0C\u7121\u6CD5\u5831\u540D\u3002` }]);
  }
  const requireConsent = parseBoolean(event.requireConsent);
  const questions = Array.isArray(event.questions) ? event.questions : [];
  const sessionData = {
    stage: requireConsent ? "consent" : "answering",
    eventId,
    eventName: text(event.eventName),
    requireConsent,
    reminderTime: text(event.reminderTime) || "",
    questions,
    qIdx: 0,
    answers: [],
    multiBuffer: [],
    consentGiven: false,
    walkIn: true
  };
  await saveEvtSession(env, userId, sessionData);
  const greeting = { type: "text", text: `\u6B61\u8FCE\u53C3\u52A0\u300C${text(event.eventName)}\u300D\uFF01
\u63A5\u4E0B\u4F86\u8ACB\u586B\u5BEB\u5831\u540D\u8CC7\u6599 \u{1F447}` };
  if (requireConsent) {
    return lineReply(env, replyToken, [greeting, buildEvtConsentBubble()]);
  }
  if (!questions.length) return advanceAfterAnswering(env, userId, replyToken, sessionData);
  return lineReply(env, replyToken, [greeting, ...buildEvtQuestionMsgs(questions[0], 0, questions.length)]);
}
__name(handleEvtWalkInQR, "handleEvtWalkInQR");
async function handleWalkInPin(env, userId, replyToken, pin) {
  const row = await env.DB.prepare(
    `SELECT payload_json FROM events
     WHERE event_id LIKE ?
       AND (json_extract(payload_json,'$.status') IS NULL
            OR json_extract(payload_json,'$.status') NOT IN ('\u5DF2\u7D50\u675F','\u5DF2\u53D6\u6D88'))
     ORDER BY json_extract(payload_json,'$.eventStart') DESC
     LIMIT 1`
  ).bind(`%_${pin}`).first();
  if (!row) {
    return lineReply(env, replyToken, [{ type: "text", text: `\u627E\u4E0D\u5230\u5831\u540D\u78BC\u300C${pin}\u300D\u5C0D\u61C9\u7684\u6D3B\u52D5\uFF0C\u8ACB\u5411\u73FE\u5834\u5DE5\u4F5C\u4EBA\u54E1\u78BA\u8A8D\u3002` }]);
  }
  const event = parseJson(row.payload_json);
  const eventId = event.eventId;
  const eventName = text(event.eventName);
  const regRows = await env.DB.prepare(
    `SELECT reg_id, display_name, checked_in, payload_json FROM event_registrations
     WHERE event_id = ? AND line_user_id = ?`
  ).bind(eventId, userId).all();
  if (!regRows.results.length) {
    return handleEvtWalkInQR(env, userId, replyToken, eventId);
  }
  const regs = regRows.results;
  const nameFieldQId = (event.questions || []).find((q) => q.isNameField)?.id || null;
  const allChecked = regs.every((r) => r.checked_in === "TRUE");
  const nameList = regs.map((r) => {
    const payload = nameFieldQId ? parseJson(r.payload_json) : null;
    const name = nameFieldQId && text(payload?.[nameFieldQId]) || r.display_name || "\uFF08\u672A\u53D6\u5F97\u540D\u7A31\uFF09";
    return `\u30FB${name}${r.checked_in === "TRUE" ? " \u2705" : ""}`;
  }).join("\n");
  const footerBtns = [];
  if (!allChecked) {
    footerBtns.push({
      type: "button",
      style: "primary",
      color: "#1565c0",
      height: "sm",
      action: { type: "postback", label: "\u2705 \u6211\u8981\u7C3D\u5230", data: `action=evt:walkin_checkin&eventId=${eventId}` }
    });
  }
  footerBtns.push({
    type: "button",
    style: allChecked ? "primary" : "secondary",
    height: "sm",
    action: { type: "postback", label: "\u{1F4DD} \u5E6B\u5225\u4EBA\u5831\u540D", data: `action=evt:walkin_register&eventId=${eventId}` }
  });
  const bubble = {
    type: "flex",
    altText: "\u8ACB\u9078\u64C7\u64CD\u4F5C",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1565c0",
        paddingAll: "14px",
        contents: [{ type: "text", text: `\u{1F4CB} ${eventName}`, color: "#ffffff", weight: "bold", size: "sm", wrap: true }]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: "\u60A8\u5DF2\u6709\u4EE5\u4E0B\u5831\u540D\u8A18\u9304\uFF1A", size: "sm", color: "#4b5563" },
          { type: "text", text: nameList, size: "sm", color: "#1f2937", wrap: true },
          ...allChecked ? [{ type: "text", text: "\u5DF2\u5168\u90E8\u5B8C\u6210\u7C3D\u5230 \u2705", size: "sm", color: "#2f6836", margin: "md", wrap: true }] : []
        ]
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: footerBtns }
    }
  };
  return lineReply(env, replyToken, [bubble]);
}
__name(handleWalkInPin, "handleWalkInPin");
async function handleEvtText(env, userId, replyToken, state, msg) {
  if (EVT_CANCEL_RE.test(msg)) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "\u5DF2\u53D6\u6D88\u5831\u540D\u6D41\u7A0B\u3002\u82E5\u9700\u8981\u518D\u6B21\u5831\u540D\u8ACB\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002" }]);
  }
  if (state.stage === "answering") {
    const q = (state.questions || [])[state.qIdx];
    if (q && (q.type === "text" || q.type === "number")) {
      state.answers = state.answers || [];
      state.answers.push({ qIdx: state.qIdx, type: q.type, label: q.label, value: msg.substring(0, q.maxLength || 100) });
      state.qIdx++;
      await saveEvtSession(env, userId, state);
      if (state.qIdx >= (state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
      return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[state.qIdx], state.qIdx, state.questions.length));
    }
  }
  return lineReply(env, replyToken, [{ type: "text", text: "\u8ACB\u4F9D\u63D0\u793A\u64CD\u4F5C\uFF0C\u6216\u8F38\u5165\u300C\u53D6\u6D88\u300D\u7D50\u675F\u5831\u540D\u3002" }]);
}
__name(handleEvtText, "handleEvtText");
async function handleEvtPostback(env, ctx, userId, replyToken, state, pb) {
  const action = pb.action || "";
  if (action === "evt:start") return handleEvtStart(env, userId, replyToken);
  if (action === "evt:select") {
    const events = await getActiveEventsForLine(env);
    const ev = events.find((e) => e.eventId === pb.eventId);
    if (!ev) return lineReply(env, replyToken, [{ type: "text", text: "\u627E\u4E0D\u5230\u6B64\u6D3B\u52D5\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002" }]);
    if (ev.isFull) return lineReply(env, replyToken, [{ type: "text", text: `\u300C${ev.eventName}\u300D\u540D\u984D\u5DF2\u6EFF\uFF0C\u7121\u6CD5\u5831\u540D\u3002` }]);
    const eventData = await getEventPayload(env, pb.eventId);
    if (!eventData) return lineReply(env, replyToken, [{ type: "text", text: "\u627E\u4E0D\u5230\u6B64\u6D3B\u52D5\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002" }]);
    await saveEvtSession(env, userId, {
      stage: "confirm_event",
      eventId: pb.eventId,
      eventName: ev.eventName,
      requireConsent: ev.requireConsent,
      reminderTime: text(ev.reminderTime) || "",
      questions: eventData.questions || [],
      qIdx: 0,
      answers: [],
      multiBuffer: []
    });
    const msgs = [];
    if (ev.imageUrl) msgs.push({ type: "image", originalContentUrl: ev.imageUrl, previewImageUrl: ev.imageUrl });
    msgs.push(buildEvtConfirmBubble(ev));
    return lineReply(env, replyToken, msgs);
  }
  if (action === "evt:confirm_yes") {
    if (!state.stage) return lineReply(env, replyToken, [{ type: "text", text: "\u64CD\u4F5C\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002" }]);
    if (state.stage !== "confirm_event") return;
    if (state.requireConsent) {
      state.stage = "consent";
      await saveEvtSession(env, userId, state);
      return lineReply(env, replyToken, [buildEvtConsentBubble()]);
    }
    state.stage = "answering";
    await saveEvtSession(env, userId, state);
    if (!(state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[0], 0, state.questions.length));
  }
  if (action === "evt:confirm_no") {
    await clearEvtSession(env, userId);
    const events = await getActiveEventsForLine(env);
    return events.length ? lineReply(env, replyToken, [{ type: "text", text: "\u6C92\u95DC\u4FC2\uFF01\u8ACB\u5F9E\u4E0B\u65B9\u9078\u64C7\u5176\u4ED6\u6D3B\u52D5\uFF1A" }, buildEvtListCarousel(events)]) : lineReply(env, replyToken, [{ type: "text", text: "\u597D\u7684\uFF0C\u5DF2\u53D6\u6D88\u3002\u82E5\u9700\u8981\u5831\u540D\u8ACB\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002" }]);
  }
  if (action === "evt:consent_yes") {
    if (state.stage !== "consent") {
      if (!state.stage) return lineReply(env, replyToken, [{ type: "text", text: "\u64CD\u4F5C\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002" }]);
      return;
    }
    state.stage = "answering";
    state.consentGiven = true;
    await saveEvtSession(env, userId, state);
    if (!(state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[0], 0, state.questions.length));
  }
  if (action === "evt:consent_no") {
    if (state.stage !== "consent") {
      if (!state.stage) return lineReply(env, replyToken, [{ type: "text", text: "\u64CD\u4F5C\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002" }]);
      return;
    }
    state.stage = "answering";
    state.consentGiven = false;
    await saveEvtSession(env, userId, state);
    if (!(state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, [
      { type: "text", text: "\u4E86\u89E3\uFF01\u5831\u540D\u4ECD\u53EF\u7E7C\u7E8C\uFF0C\u6D3B\u52D5\u62CD\u651D\u6642\u5DE5\u4F5C\u4EBA\u54E1\u6703\u7559\u610F\u907F\u958B\u3002" },
      ...buildEvtQuestionMsgs(state.questions[0], 0, state.questions.length)
    ]);
  }
  if (action === "evt:remind_yes") {
    if (state.stage !== "reminder_opt_in") return lineReply(env, replyToken, await buildEvtStaleReminderMessages(env, userId, state));
    state.wantsReminder = true;
    await saveEvtSession(env, userId, state);
    return sendEvtSummary(env, userId, replyToken, state);
  }
  if (action === "evt:remind_no") {
    if (state.stage !== "reminder_opt_in") return lineReply(env, replyToken, await buildEvtStaleReminderMessages(env, userId, state));
    state.wantsReminder = false;
    await saveEvtSession(env, userId, state);
    return sendEvtSummary(env, userId, replyToken, state);
  }
  if (action === "evt:answer") {
    if (state.stage !== "answering") {
      if (!state.stage) return lineReply(env, replyToken, [{ type: "text", text: "\u64CD\u4F5C\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002" }]);
      return;
    }
    const q = (state.questions || [])[state.qIdx];
    if (!q) return;
    if (q.type === "single" || q.type === "scale" || q.type === "headcount") {
      state.answers.push({ qIdx: state.qIdx, type: q.type, label: q.label, value: pb.value });
      state.qIdx++;
      await saveEvtSession(env, userId, state);
      if (state.qIdx >= state.questions.length) return advanceAfterAnswering(env, userId, replyToken, state);
      return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[state.qIdx], state.qIdx, state.questions.length));
    }
    if (q.type === "multi") {
      state.multiBuffer = state.multiBuffer || [];
      const idx = state.multiBuffer.indexOf(pb.value);
      if (idx >= 0) state.multiBuffer.splice(idx, 1);
      else state.multiBuffer.push(pb.value);
      await saveEvtSession(env, userId, state);
      return lineReply(env, replyToken, [{ type: "text", text: buildMultiStatusText(state.multiBuffer) }]);
    }
    return;
  }
  if (action === "evt:multi_done") {
    if (state.stage !== "answering") return;
    const q2 = (state.questions || [])[state.qIdx];
    const sel = state.multiBuffer || [];
    if (q2?.required && !sel.length) return lineReply(env, replyToken, [{ type: "text", text: "\u6B64\u984C\u70BA\u5FC5\u586B\uFF0C\u8ACB\u81F3\u5C11\u9078\u4E00\u500B\u9078\u9805\u3002" }]);
    state.answers.push({ qIdx: state.qIdx, type: "multi", label: q2?.label || "", value: sel });
    state.multiBuffer = [];
    state.qIdx++;
    await saveEvtSession(env, userId, state);
    if (state.qIdx >= (state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[state.qIdx], state.qIdx, state.questions.length));
  }
  if (action === "evt:skip") {
    if (state.stage !== "answering") return;
    const q3 = (state.questions || [])[state.qIdx];
    state.answers.push({ qIdx: state.qIdx, type: q3?.type || "text", label: q3?.label || "", value: "\uFF08\u7565\u904E\uFF09" });
    state.multiBuffer = [];
    state.qIdx++;
    await saveEvtSession(env, userId, state);
    if (state.qIdx >= (state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[state.qIdx], state.qIdx, state.questions.length));
  }
  if (action === "evt:submit") {
    if (state.stage !== "summary") return;
    const result = await submitRegistrationFromLine(env, ctx, userId, state);
    await clearEvtSession(env, userId);
    return lineReply(
      env,
      replyToken,
      result.success ? [buildEvtSuccessBubble(state)] : [{ type: "text", text: "\u26A0\uFE0F " + (result.error || "\u5831\u540D\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66") }]
    );
  }
  if (action === "evt:edit") {
    if (state.stage !== "summary") return;
    state.stage = "answering";
    state.qIdx = 0;
    state.answers = [];
    state.multiBuffer = [];
    await saveEvtSession(env, userId, state);
    const qs = state.questions || [];
    if (!qs.length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, [
      { type: "text", text: "\u8ACB\u91CD\u65B0\u56DE\u7B54\u4EE5\u4E0B\u554F\u984C\uFF1A" },
      ...buildEvtQuestionMsgs(qs[0], 0, qs.length)
    ]);
  }
  if (action === "evt:walkin_checkin") {
    const eventId = text(pb.eventId);
    if (!eventId) return lineReply(env, replyToken, [{ type: "text", text: "\u64CD\u4F5C\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5831\u540D\u78BC\u3002" }]);
    const event = await getEventPayload(env, eventId);
    if (!event) return lineReply(env, replyToken, [{ type: "text", text: "\u627E\u4E0D\u5230\u6B64\u6D3B\u52D5\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5831\u540D\u78BC\u3002" }]);
    const uncheckedRows = await getUncheckedRegistrationsForLine(env, eventId, userId);
    if (!uncheckedRows.length) {
      return lineReply(env, replyToken, [{ type: "text", text: `\u60A8\u7684\u5831\u540D\u5DF2\u5B8C\u6210\u7C3D\u5230 \u2705` }]);
    }
    if (parseBoolean(event.checkinLocationRequired)) {
      const center = getEventCheckinCenter(event);
      if (!center) {
        return lineReply(env, replyToken, [{ type: "text", text: "\u6B64\u6D3B\u52D5\u5C1A\u672A\u8A2D\u5B9A\u6709\u6548\u7684\u7C3D\u5230\u4E2D\u5FC3\u9EDE\uFF0C\u8ACB\u6D3D\u73FE\u5834\u5DE5\u4F5C\u4EBA\u54E1\u3002" }]);
      }
      await saveEvtSession(env, userId, {
        stage: "checkin_location",
        eventId,
        eventName: text(event.eventName)
      });
      return lineReply(env, replyToken, [buildCheckinLocationRequestMessage(event)]);
    }
    await completeLineCheckin(env, eventId, userId, uncheckedRows);
    return lineReply(env, replyToken, [{ type: "text", text: `\u2705 \u7C3D\u5230\u5B8C\u6210\uFF01
\u611F\u8B1D\u60A8\u53C3\u52A0\u300C${text(event.eventName) || eventId}\u300D\uFF01` }]);
  }
  if (action === "evt:walkin_register") {
    const eventId = text(pb.eventId);
    if (!eventId) return lineReply(env, replyToken, [{ type: "text", text: "\u64CD\u4F5C\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5831\u540D\u78BC\u3002" }]);
    return handleEvtWalkInQR(env, userId, replyToken, eventId);
  }
}
__name(handleEvtPostback, "handleEvtPostback");
async function handleEvtCheckinLocation(env, userId, replyToken, state, message) {
  const eventId = text(state.eventId);
  if (!eventId) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "\u7C3D\u5230\u6D41\u7A0B\u5DF2\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5831\u540D\u78BC\u3002" }]);
  }
  const event = await getEventPayload(env, eventId);
  if (!event) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "\u627E\u4E0D\u5230\u6B64\u6D3B\u52D5\uFF0C\u8ACB\u5411\u73FE\u5834\u5DE5\u4F5C\u4EBA\u54E1\u78BA\u8A8D\u3002" }]);
  }
  const uncheckedRows = await getUncheckedRegistrationsForLine(env, eventId, userId);
  if (!uncheckedRows.length) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "\u60A8\u7684\u5831\u540D\u5DF2\u5B8C\u6210\u7C3D\u5230 \u2705" }]);
  }
  const center = getEventCheckinCenter(event);
  if (!center) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "\u6B64\u6D3B\u52D5\u5C1A\u672A\u8A2D\u5B9A\u6709\u6548\u7684\u7C3D\u5230\u4E2D\u5FC3\u9EDE\uFF0C\u8ACB\u6D3D\u73FE\u5834\u5DE5\u4F5C\u4EBA\u54E1\u3002" }]);
  }
  const lat = Number(message.latitude);
  const lng = Number(message.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return lineReply(env, replyToken, [buildCheckinLocationRequestMessage(event, "\u6C92\u6709\u53D6\u5F97\u6709\u6548\u5B9A\u4F4D\uFF0C\u8ACB\u518D\u50B3\u9001\u4E00\u6B21\u76EE\u524D\u4F4D\u7F6E\u3002")]);
  }
  const distanceMeters = Math.round(distanceMetersBetween(lat, lng, center.lat, center.lng));
  if (distanceMeters > CHECKIN_RADIUS_METERS) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "\u9700\u5728\u6D3B\u52D5\u5834\u5730\u7BC4\u570D\u5167\u624D\u80FD\u7C3D\u5230\uFF0C\u5982\u6709\u554F\u984C\u8ACB\u627E\u91CC\u9577\u624B\u52D5\u7C3D\u5230\u3002" }]);
  }
  await completeLineCheckin(env, eventId, userId, uncheckedRows, { lat, lng, distanceMeters });
  await clearEvtSession(env, userId);
  return lineReply(env, replyToken, [{ type: "text", text: `\u2705 \u7C3D\u5230\u5B8C\u6210\uFF01
\u76EE\u524D\u8DDD\u96E2\u6D3B\u52D5\u5730\u9EDE\u7D04 ${distanceMeters} \u516C\u5C3A\u3002
\u611F\u8B1D\u60A8\u53C3\u52A0\u300C${text(event.eventName) || eventId}\u300D\uFF01` }]);
}
__name(handleEvtCheckinLocation, "handleEvtCheckinLocation");
async function getUncheckedRegistrationsForLine(env, eventId, userId) {
  const rows = await env.DB.prepare(
    "SELECT reg_id FROM event_registrations WHERE event_id = ? AND line_user_id = ? AND checked_in != 'TRUE'"
  ).bind(eventId, userId).all();
  return rows.results || [];
}
__name(getUncheckedRegistrationsForLine, "getUncheckedRegistrationsForLine");
async function completeLineCheckin(env, eventId, userId, uncheckedRows, location) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const rows = Array.isArray(uncheckedRows) ? uncheckedRows : [];
  if (!rows.length) return;
  const statements = rows.map((row) => {
    if (location) {
      return env.DB.prepare(
        `UPDATE event_registrations
            SET checked_in = 'TRUE',
                payload_json = json_set(payload_json,
                  '$.checkedIn', 'TRUE',
                  '$.checkinAt', ?,
                  '$.checkinLat', ?,
                  '$.checkinLng', ?,
                  '$.checkinDistanceMeters', ?)
          WHERE event_id = ? AND reg_id = ? AND line_user_id = ?`
      ).bind(now, location.lat, location.lng, location.distanceMeters, eventId, row.reg_id, userId);
    }
    return env.DB.prepare(
      `UPDATE event_registrations
          SET checked_in = 'TRUE',
              payload_json = json_set(payload_json,'$.checkedIn','TRUE','$.checkinAt',?)
        WHERE event_id = ? AND reg_id = ? AND line_user_id = ?`
    ).bind(now, eventId, row.reg_id, userId);
  });
  await env.DB.batch(statements);
}
__name(completeLineCheckin, "completeLineCheckin");
function getEventCheckinCenter(event) {
  const lat = Number(event.checkinLatitude);
  const lng = Number(event.checkinLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
__name(getEventCheckinCenter, "getEventCheckinCenter");
function distanceMetersBetween(lat1, lng1, lat2, lng2) {
  const toRad = /* @__PURE__ */ __name((deg) => deg * Math.PI / 180, "toRad");
  const earthRadius = 6371e3;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
__name(distanceMetersBetween, "distanceMetersBetween");
function buildCheckinLocationRequestMessage(event, prefix) {
  const textLines = [];
  if (prefix) textLines.push(prefix);
  textLines.push("\u8ACB\u9EDE\u9078\u4E0B\u65B9\u6309\u9215\u50B3\u9001\u76EE\u524D\u4F4D\u7F6E\uFF0C\u4E26\u6309\u53F3\u4E0A\u89D2\u300C\u5206\u4EAB\u300D\uFF0C\u5DF2\u5B8C\u6210\u81EA\u52D5\u7C3D\u5230\u3002");
  return {
    type: "text",
    text: textLines.join("\n"),
    quickReply: {
      items: [{
        type: "action",
        action: { type: "location", label: "\u50B3\u9001\u76EE\u524D\u4F4D\u7F6E" }
      }]
    }
  };
}
__name(buildCheckinLocationRequestMessage, "buildCheckinLocationRequestMessage");
async function advanceAfterAnswering(env, userId, replyToken, state) {
  const hasReminder = state.reminderTime && state.reminderTime !== "none";
  if (hasReminder && state.wantsReminder == null) {
    state.stage = "reminder_opt_in";
    await saveEvtSession(env, userId, state);
    return lineReply(env, replyToken, [buildEvtReminderOptInBubble(state)]);
  }
  return sendEvtSummary(env, userId, replyToken, state);
}
__name(advanceAfterAnswering, "advanceAfterAnswering");
async function sendEvtSummary(env, userId, replyToken, state) {
  state.stage = "summary";
  if (!state.summaryIssuedAt) state.summaryIssuedAt = (/* @__PURE__ */ new Date()).toISOString();
  ensureEvtSubmissionId(state, userId);
  await saveEvtSession(env, userId, state);
  return lineReply(env, replyToken, [buildEvtSummaryBubble(state)]);
}
__name(sendEvtSummary, "sendEvtSummary");
async function submitRegistrationFromLine(env, ctx, userId, state) {
  try {
    const event = await getEventPayload(env, state.eventId);
    if (!event) return { success: false, error: "\u627E\u4E0D\u5230\u6D3B\u52D5" };
    if (text(event.status) !== "\u5831\u540D\u4E2D") return { success: false, error: "\u6B64\u6D3B\u52D5\u5831\u540D\u5DF2\u622A\u6B62" };
    if (!isWithinRegWindow(event)) return { success: false, error: "\u6B64\u6D3B\u52D5\u76EE\u524D\u4E0D\u5728\u958B\u653E\u5831\u540D\u671F\u9593" };
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ?"
    ).bind(state.eventId).first();
    const regCount = Number(countRow?.cnt || 0);
    const quota = parseInt(text(event.quota)) || 0;
    if (quota > 0 && regCount >= quota) return { success: false, error: "\u6B64\u6D3B\u52D5\u540D\u984D\u5DF2\u6EFF" };
    const profile = await getLineProfile(env, userId);
    const displayName = text(profile?.displayName);
    const now = /* @__PURE__ */ new Date();
    const regId = ensureEvtSubmissionId(state, userId);
    const answerMap = {};
    const sessionQuestions = state.questions || [];
    for (const a of state.answers || []) {
      const q = sessionQuestions[a.qIdx];
      const key = q?.id || text(a.label);
      if (key) answerMap[key] = Array.isArray(a.value) ? a.value.join("\u3001") : text(a.value);
    }
    const reg = {
      regId,
      eventId: state.eventId,
      lineUserId: userId,
      displayName,
      consentGiven: state.consentGiven !== false ? "TRUE" : "FALSE",
      lineReminderOptIn: state.wantsReminder === true ? "TRUE" : "FALSE",
      submittedAt: now.toISOString(),
      headcount: "1",
      checkedIn: state.walkIn ? "TRUE" : "FALSE",
      ...answerMap
    };
    await upsertRegistrationStatement(env, state.eventId, reg).run();
    await syncEventRegisteredCount(env, state.eventId);
    ctx.waitUntil(
      forwardToGas(env, {
        action: "submitRegistration",
        eventId: state.eventId,
        lineUserId: userId,
        displayName,
        answers: state.answers || [],
        consentGiven: state.consentGiven !== false
      }).catch((err) => {
        console.error(JSON.stringify({ action: "submitRegistration_line", lineUserId: userId, syncTarget: "gas", error: err.message }));
      })
    );
    return { success: true, regId, displayName };
  } catch (err) {
    return { success: false, error: err.message || "\u7CFB\u7D71\u932F\u8AA4\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66" };
  }
}
__name(submitRegistrationFromLine, "submitRegistrationFromLine");
function lineSessionKey(kind, userId) {
  return `${kind}:${userId}`;
}
__name(lineSessionKey, "lineSessionKey");
async function parseSessionJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
__name(parseSessionJson, "parseSessionJson");
async function getLineSession(env, kind, userId) {
  const key = lineSessionKey(kind, userId);
  if (env.DB) {
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const row = await env.DB.prepare(
        "SELECT state_json FROM line_sessions WHERE session_key = ? AND expires_at > ?"
      ).bind(key, now).first();
      if (row?.state_json) return parseSessionJson(row.state_json);
    } catch {
    }
  }
  if (!env.SESSIONS) return {};
  const raw = await env.SESSIONS.get(key);
  if (!raw) return {};
  return parseSessionJson(raw);
}
__name(getLineSession, "getLineSession");
async function saveLineSession(env, kind, userId, state) {
  state.updatedAt = Date.now();
  const key = lineSessionKey(kind, userId);
  const stateJson = JSON.stringify(state);
  if (env.DB) {
    try {
      const now = /* @__PURE__ */ new Date();
      const expiresAt = new Date(now.getTime() + KV_SESSION_TTL * 1e3).toISOString();
      await env.DB.prepare(
        `INSERT INTO line_sessions (session_key, kind, user_id, state_json, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_key) DO UPDATE SET
           kind = excluded.kind,
           user_id = excluded.user_id,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`
      ).bind(key, kind, userId, stateJson, now.toISOString(), expiresAt).run();
      if (env.SESSIONS) await env.SESSIONS.delete(key).catch(() => {
      });
      return;
    } catch {
    }
  }
  if (env.SESSIONS) {
    await env.SESSIONS.put(key, stateJson, { expirationTtl: KV_SESSION_TTL });
  }
}
__name(saveLineSession, "saveLineSession");
async function clearLineSession(env, kind, userId) {
  const key = lineSessionKey(kind, userId);
  if (env.DB) {
    try {
      await env.DB.prepare("DELETE FROM line_sessions WHERE session_key = ?").bind(key).run();
    } catch {
    }
  }
  if (env.SESSIONS) await env.SESSIONS.delete(key);
}
__name(clearLineSession, "clearLineSession");
async function getEvtSession(env, userId) {
  return getLineSession(env, "evt", userId);
}
__name(getEvtSession, "getEvtSession");
async function saveEvtSession(env, userId, state) {
  return saveLineSession(env, "evt", userId, state);
}
__name(saveEvtSession, "saveEvtSession");
async function clearEvtSession(env, userId) {
  return clearLineSession(env, "evt", userId);
}
__name(clearEvtSession, "clearEvtSession");
async function getComSession(env, userId) {
  return getLineSession(env, "com", userId);
}
__name(getComSession, "getComSession");
async function saveComSession(env, userId, state) {
  return saveLineSession(env, "com", userId, state);
}
__name(saveComSession, "saveComSession");
async function clearComSession(env, userId) {
  return clearLineSession(env, "com", userId);
}
__name(clearComSession, "clearComSession");
async function getRptSession(env, userId) {
  return getLineSession(env, "rpt", userId);
}
__name(getRptSession, "getRptSession");
async function saveRptSession(env, userId, state) {
  return saveLineSession(env, "rpt", userId, state);
}
__name(saveRptSession, "saveRptSession");
async function clearRptSession(env, userId) {
  return clearLineSession(env, "rpt", userId);
}
__name(clearRptSession, "clearRptSession");
async function findRecentLineRegistration(env, userId, minutes = 30) {
  if (!env.DB || !userId) return null;
  const cutoff = new Date(Date.now() - minutes * 60 * 1e3).toISOString();
  const row = await env.DB.prepare(
    `SELECT event_id, display_name, submitted_at, payload_json
       FROM event_registrations
      WHERE line_user_id = ? AND submitted_at >= ?
      ORDER BY submitted_at DESC
      LIMIT 1`
  ).bind(userId, cutoff).first();
  if (!row) return null;
  const payload = parseJson(row.payload_json);
  return {
    eventId: text(row.event_id),
    eventName: text(payload.eventName),
    displayName: text(row.display_name || payload.displayName),
    attendeeName: findRegistrationAttendeeName(payload) || text(row.display_name || payload.displayName),
    phone: findRegistrationPhone(payload),
    submittedAt: text(row.submitted_at || payload.submittedAt)
  };
}
__name(findRecentLineRegistration, "findRecentLineRegistration");
function findRegistrationAttendeeName(payload) {
  for (const key of Object.keys(payload || {})) {
    if (key.includes("\u5831\u540D\u8005\u59D3\u540D") || key === "\u59D3\u540D" || key.includes("\u59D3\u540D")) {
      const value = text(payload[key]);
      if (value) return value;
    }
  }
  return "";
}
__name(findRegistrationAttendeeName, "findRegistrationAttendeeName");
function findRegistrationPhone(payload) {
  for (const key of Object.keys(payload || {})) {
    if (key.includes("\u96FB\u8A71") || key.includes("\u624B\u6A5F")) {
      const value = text(payload[key]);
      if (value) return value;
    }
  }
  return "";
}
__name(findRegistrationPhone, "findRegistrationPhone");
function buildEvtDuplicateSubmitMessage(registration) {
  if (!registration) {
    return {
      type: "text",
      text: "\u76EE\u524D\u9084\u67E5\u4E0D\u5230\u60A8\u6700\u8FD1\u7684\u5831\u540D\u8CC7\u6599\u3002\n\u82E5\u525B\u525B\u624D\u9001\u51FA\uFF0C\u8ACB\u7A0D\u7B49\u4E00\u4E0B\u518D\u8F38\u5165\u300C\u67E5\u8A62\u5831\u540D\u300D\uFF1B\u82E5\u8981\u91CD\u65B0\u64CD\u4F5C\uFF0C\u8ACB\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002"
    };
  }
  const lines = ["\u5DF2\u6536\u5230\u60A8\u7684\u5831\u540D\uFF0C\u4E0D\u9700\u8981\u91CD\u8907\u9001\u51FA\u3002"];
  if (registration?.eventName) lines.push(`\u6D3B\u52D5\uFF1A${registration.eventName}`);
  if (registration?.attendeeName) lines.push(`\u5831\u540D\u8005\uFF1A${registration.attendeeName}`);
  if (registration?.phone) lines.push(`\u96FB\u8A71\uFF1A${registration.phone}`);
  lines.push("\u82E5\u8981\u5E6B\u5176\u4ED6\u4EBA\u5831\u540D\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002");
  return { type: "text", text: lines.join("\n") };
}
__name(buildEvtDuplicateSubmitMessage, "buildEvtDuplicateSubmitMessage");
function buildEvtReminderAlreadyHandledMessage() {
  return {
    type: "text",
    text: "\u5DF2\u6536\u5230\u60A8\u7684\u63D0\u9192\u8A2D\u5B9A\uFF0C\u8ACB\u7E7C\u7E8C\u78BA\u8A8D\u5831\u540D\u8CC7\u6599\uFF1B\u8CC7\u6599\u7121\u8AA4\u5F8C\u8ACB\u9EDE\u300C\u78BA\u8A8D\u9001\u51FA\u300D\u3002"
  };
}
__name(buildEvtReminderAlreadyHandledMessage, "buildEvtReminderAlreadyHandledMessage");
async function buildEvtStaleReminderMessages(env, userId, state) {
  if (state.stage === "summary") {
    return [buildEvtReminderAlreadyHandledMessage(), buildEvtSummaryBubble(state)];
  }
  const recent = await findRecentLineRegistration(env, userId);
  return [recent ? buildEvtDuplicateSubmitMessage(recent) : buildEvtExpiredCardMessage()];
}
__name(buildEvtStaleReminderMessages, "buildEvtStaleReminderMessages");
function buildEvtExpiredCardMessage() {
  return {
    type: "text",
    text: "\u9019\u5F35\u78BA\u8A8D\u5361\u7247\u5DF2\u5931\u6548\uFF0C\u8ACB\u7A0D\u7B49\u4E00\u4E0B\u518D\u6309\u4E00\u6B21\uFF1B\u82E5\u9084\u662F\u4E0D\u884C\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u3002"
  };
}
__name(buildEvtExpiredCardMessage, "buildEvtExpiredCardMessage");
function ensureEvtSubmissionId(state, userId = "") {
  if (!state.submissionId) {
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
    state.submissionId = `REG_${dateStr}_${stableSubmissionSuffix(state, userId)}`;
  }
  return state.submissionId;
}
__name(ensureEvtSubmissionId, "ensureEvtSubmissionId");
function stableSubmissionSuffix(state, userId) {
  const seed = JSON.stringify({
    reservationId: text(state.reservationId),
    summaryIssuedAt: text(state.summaryIssuedAt),
    eventId: text(state.eventId),
    userId: text(userId),
    answers: state.answers || []
  });
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}
__name(stableSubmissionSuffix, "stableSubmissionSuffix");
async function getActiveEventsForLine(env) {
  const now = taiwanIsoNow();
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM events
     WHERE status = '\u5831\u540D\u4E2D'
       AND (registration_start = '' OR registration_start IS NULL OR registration_start <= ?)
       AND (registration_end = '' OR registration_end IS NULL OR registration_end >= ?)
     ORDER BY CASE WHEN sort_order > 0 THEN sort_order ELSE 999999 END ASC,
              event_start ASC, event_id ASC LIMIT 12`
  ).bind(now, now).all();
  return rows.results.map((row) => {
    const ev = parseJson(row.payload_json);
    const quota = parseInt(text(ev.quota)) || 0;
    const regCount = Number(ev.registeredCount || 0);
    const remaining = quota > 0 ? Math.max(0, quota - regCount) : -1;
    return {
      ...ev,
      eventDate: fmtEventDateRange(text(ev.eventStart), text(ev.eventEnd)),
      quota,
      remaining,
      isFull: quota > 0 && regCount >= quota,
      isAlmostFull: quota > 0 && remaining > 0 && remaining < 10
    };
  });
}
__name(getActiveEventsForLine, "getActiveEventsForLine");
var TOKEN_CACHE_KEY = "line:channel_access_token";
var TOKEN_CACHE_TTL = 27 * 24 * 60 * 60;
async function getAccessToken(env) {
  if (env.LINE_CHANNEL_ACCESS_TOKEN) return env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET || !env.SESSIONS) {
    console.error(JSON.stringify({ fn: "getAccessToken", error: "channel credentials not configured" }));
    return "";
  }
  const cached = await env.SESSIONS.get(TOKEN_CACHE_KEY);
  if (cached) return cached;
  try {
    const resp = await fetch("https://api.line.me/v2/oauth/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.LINE_CHANNEL_ID,
        client_secret: env.LINE_CHANNEL_SECRET
      })
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(JSON.stringify({ fn: "getAccessToken", status: resp.status, body: body.slice(0, 200) }));
      return "";
    }
    const data = await resp.json();
    const token = text(data.access_token);
    if (!token) return "";
    await env.SESSIONS.put(TOKEN_CACHE_KEY, token, { expirationTtl: TOKEN_CACHE_TTL });
    console.log(JSON.stringify({ fn: "getAccessToken", renewed: true, expiresIn: data.expires_in }));
    return token;
  } catch (err) {
    console.error(JSON.stringify({ fn: "getAccessToken", error: err.message }));
    return "";
  }
}
__name(getAccessToken, "getAccessToken");
async function lineReply(env, replyToken, messages) {
  const accessToken = await getAccessToken(env);
  if (!accessToken || !replyToken) {
    console.error(JSON.stringify({ fn: "lineReply", error: "missing token or replyToken" }));
    return;
  }
  const resp = await fetch(LINE_REPLY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
    body: JSON.stringify({ replyToken, messages })
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(JSON.stringify({ fn: "lineReply", status: resp.status, body: errText }));
  }
}
__name(lineReply, "lineReply");
async function linePush(env, to, messages) {
  const accessToken = await getAccessToken(env);
  if (!accessToken || !to) return false;
  try {
    const resp = await fetch(LINE_PUSH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ to, messages })
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(JSON.stringify({ fn: "linePush", status: resp.status, body }));
      return false;
    }
    return true;
  } catch (err) {
    console.error(JSON.stringify({ fn: "linePush", error: err.message }));
    return false;
  }
}
__name(linePush, "linePush");
async function notifyHub(env, messages) {
  if (!env.NOTIFY_HUB_URL || !env.NOTIFY_HUB_SECRET) {
    console.error(JSON.stringify({ fn: "notifyHub", error: "hub not configured" }));
    return false;
  }
  try {
    const request = new Request(env.NOTIFY_HUB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.NOTIFY_HUB_SECRET },
      body: JSON.stringify({ villageCode: env.NOTIFY_HUB_VILLAGE_CODE || "GSNBHS", messages })
    });
    const resp = env.NOTIFY_HUB ? await env.NOTIFY_HUB.fetch(request) : await fetch(request);
    const bodyText = await resp.text().catch(() => "");
    if (!resp.ok) {
      console.error(JSON.stringify({ fn: "notifyHub", status: resp.status, body: bodyText.slice(0, 200) }));
      return false;
    }
    const result = parseJson(bodyText);
    if (result.success === false) {
      console.error(JSON.stringify({ fn: "notifyHub", error: result.error }));
      return false;
    }
    return true;
  } catch (err) {
    console.error(JSON.stringify({ fn: "notifyHub", error: err.message }));
    return false;
  }
}
__name(notifyHub, "notifyHub");
async function lineMulticast(env, userIds, messages) {
  const accessToken = await getAccessToken(env);
  if (!accessToken || !userIds.length) return;
  try {
    const resp = await fetch(LINE_MULTICAST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ to: userIds, messages })
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(JSON.stringify({ fn: "lineMulticast", status: resp.status, body }));
    }
  } catch (err) {
    console.error(JSON.stringify({ fn: "lineMulticast", error: err.message }));
  }
}
__name(lineMulticast, "lineMulticast");
async function forwardLineEventToGas(env, event) {
  const token = env.GAS_LINE_TOKEN || "";
  const url = env.GAS_SCRIPT_URL + (token ? "?lineToken=" + encodeURIComponent(token) : "");
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ events: [event] })
    });
    const respText = await resp.text().catch(() => "");
    console.log(JSON.stringify({ fn: "forwardLineEventToGas", status: resp.status, body: respText.slice(0, 200), eventType: event.type, msgType: event.message?.type, msgText: event.message?.text?.slice(0, 30) }));
  } catch (err) {
    console.error(JSON.stringify({ fn: "forwardLineEventToGas", error: err.message }));
  }
}
__name(forwardLineEventToGas, "forwardLineEventToGas");
async function getLineProfile(env, userId) {
  try {
    const accessToken = await getAccessToken(env);
    if (!accessToken) return null;
    const resp = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: "Bearer " + accessToken }
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}
__name(getLineProfile, "getLineProfile");
async function startChatFlow(env, userId, replyToken) {
  if (!CHAT_FEATURE_ENABLED) {
    await lineReply(env, replyToken, [
      { type: "text", text: "\u8ACB\u76F4\u63A5\u5728\u9019\u88E1\u7559\u8A00\uFF0C\u6211\u7B49\u7B49\u5C31\u6703\u56DE\u8986\u60A8 \u{1F60A}" }
    ]);
    return;
  }
  const profile = await getLineProfile(env, userId);
  await saveLineSession(env, "chat", userId, {
    active: true,
    messages: [],
    displayName: profile?.displayName || ""
  });
  await lineReply(env, replyToken, [
    { type: "text", text: "\u60A8\u597D\uFF0C\u9019\u88E1\u662F\u820A\u793E\u91CC\u5C0F\u5E6B\u624B\u7559\u8A00\u5340 \u{1F4DD} \u6709\u4EFB\u4F55\u60F3\u8DDF\u91CC\u9577\u8AAA\u7684\u8A71\u90FD\u53EF\u4EE5\u76F4\u63A5\u6253\u5B57\uFF0C\u6211\u6703\u5E6B\u60A8\u8A18\u9304\u4E0B\u4F86\u8F49\u9054\u7D66\u91CC\u9577\u3002\uFF08\u8F38\u5165\u300C\u8FD4\u56DE\u4E3B\u9078\u55AE\u300D\u53EF\u4EE5\u96A8\u6642\u96E2\u958B\uFF09" }
  ]);
}
__name(startChatFlow, "startChatFlow");
async function handleLineChatEvent(env, userId, replyToken, event) {
  if (!CHAT_FEATURE_ENABLED) return false;
  if (event.type !== "message" || event.message?.type !== "text" || !replyToken) return false;
  const msg = String(event.message.text || "").trim();
  if (!msg) return false;
  const state = await getLineSession(env, "chat", userId);
  const active = !!state.active;
  if (!active && !CHAT_START_RE.test(msg)) return false;
  if (CHAT_START_RE.test(msg)) {
    await startChatFlow(env, userId, replyToken);
    return true;
  }
  if (CHAT_EXIT_RE.test(msg)) {
    await clearLineSession(env, "chat", userId);
    return false;
  }
  await insertChatMessage(env, { lineUserId: userId, displayName: state.displayName, role: "user", content: msg });
  if (!env.ANTHROPIC_API_KEY) {
    await lineReply(env, replyToken, [{ type: "text", text: "\u5DF2\u7D93\u5E6B\u60A8\u8A18\u9304\u4E0B\u4F86\u4E86\uFF0C\u6703\u8F49\u9054\u7D66\u91CC\u9577\u3002" }]);
    return true;
  }
  const history = Array.isArray(state.messages) ? state.messages : [];
  history.push({ role: "user", content: msg });
  let replyText;
  try {
    replyText = await callClaudeChat(env, history);
  } catch (err) {
    console.error(JSON.stringify({ fn: "callClaudeChat", error: err.message }));
    replyText = "\u5DF2\u7D93\u5E6B\u60A8\u8A18\u9304\u4E0B\u4F86\u4E86\uFF0C\u6703\u8F49\u9054\u7D66\u91CC\u9577\u3002";
  }
  history.push({ role: "assistant", content: replyText });
  await saveLineSession(env, "chat", userId, {
    active: true,
    displayName: state.displayName,
    messages: history.slice(-CHAT_MAX_HISTORY)
  });
  await insertChatMessage(env, { lineUserId: userId, displayName: state.displayName, role: "assistant", content: replyText });
  await lineReply(env, replyToken, [{ type: "text", text: replyText }]);
  return true;
}
__name(handleLineChatEvent, "handleLineChatEvent");
async function callClaudeChat(env, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: 512,
      system: CHAT_SYSTEM_PROMPT,
      messages
    })
  });
  if (!res.ok) {
    throw new Error("Claude API HTTP " + res.status + " " + await res.text());
  }
  const data = await res.json();
  if (data.stop_reason === "refusal" || !data.content?.length) {
    return "\u9019\u500B\u554F\u984C\u6211\u4E0D\u65B9\u4FBF\u56DE\u7B54\uFF0C\u5EFA\u8B70\u76F4\u63A5\u4F7F\u7528\u300C\u6211\u8981\u901A\u5831\u300D\u6216\u806F\u7D61\u91CC\u8FA6\u516C\u8655\u3002";
  }
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock?.text || "\u55EF\u55EF\uFF0C\u6211\u5728\u807D\uFF0C\u53EF\u4EE5\u518D\u8AAA\u6E05\u695A\u4E00\u9EDE\u55CE\uFF1F";
}
__name(callClaudeChat, "callClaudeChat");
async function handleLineMenuEvent(env, userId, replyToken, event) {
  if (event.type !== "postback" || !replyToken) return false;
  const pb = parsePostbackData(event.postback?.data || "");
  if (pb.action !== "menu") return false;
  if (pb.menu === "store") {
    await lineReply(env, replyToken, [await buildFoodMapMenu(env)]);
    return true;
  }
  if (pb.menu === "store_cate") {
    const cate = pb.cate || "";
    const stores = await fetchStoresByCategory(env, cate);
    if (!stores.length) {
      await lineReply(env, replyToken, [{ type: "text", text: `\u76EE\u524D\u300C${cate}\u300D\u5206\u985E\u5C1A\u7121\u7279\u7D04\u5546\u5BB6\u3002` }]);
      return true;
    }
    await lineReply(env, replyToken, [buildStoreCarousel(cate, stores)]);
    return true;
  }
  if (pb.menu === "emergency") {
    await lineReply(env, replyToken, [await buildEmergencyContactFlex(env)]);
    return true;
  }
  if (pb.menu === "chat_start") {
    await startChatFlow(env, userId, replyToken);
    return true;
  }
  if (pb.menu === "community") {
    await startCommunityFlow(env, userId, replyToken);
    return true;
  }
  if (pb.menu === "findchief" || pb.menu === "apply" || pb.menu === "backmain") {
    return true;
  }
  if (pb.menu === "news" || pb.menu === "course") {
    const label = pb.menu === "news" ? "\u6700\u65B0\u6D88\u606F" : "\u6559\u80B2\u8AB2\u7A0B";
    const cates = pb.menu === "news" ? ["\u6700\u65B0\u6D88\u606F", "\u91CC\u6C11\u6D3B\u52D5"] : ["\u6559\u80B2\u8AB2\u7A0B"];
    const bulletins = await fetchBulletinsByCategories(env, cates);
    if (!bulletins.length) {
      await lineReply(env, replyToken, [{ type: "text", text: `\u76EE\u524D\u5C1A\u7121\u300C${label}\u300D\u5167\u5BB9\uFF0C\u656C\u8ACB\u671F\u5F85\uFF01` }]);
      return true;
    }
    await lineReply(env, replyToken, [buildBulletinCarousel(label, bulletins)]);
    return true;
  }
  if (pb.menu === "apply_event" || pb.menu === "apply_course") {
    await handleEvtStart(env, userId, replyToken);
    return true;
  }
  if (MENU_LABELS[pb.menu]) {
    await lineReply(env, replyToken, [{ type: "text", text: "\u300C" + MENU_LABELS[pb.menu] + "\u300D\u529F\u80FD\u6E96\u5099\u4E2D\uFF0C\u656C\u8ACB\u671F\u5F85\uFF01" }]);
    return true;
  }
  return false;
}
__name(handleLineMenuEvent, "handleLineMenuEvent");
async function handleLineKeywordEvent(env, replyToken, event) {
  if (event.type !== "message" || event.message?.type !== "text") return false;
  const msg = String(event.message.text || "").trim();
  if (!msg || !replyToken) return false;
  if (/^(舊社里公佈欄|公佈欄|公布欄)$/.test(msg)) {
    const bulletins = await fetchBulletinsByCategories(env, ["\u6700\u65B0\u6D88\u606F", "\u91CC\u6C11\u6D3B\u52D5"]);
    if (!bulletins.length) {
      await lineReply(env, replyToken, [{ type: "text", text: "\u76EE\u524D\u5C1A\u7121\u6700\u65B0\u6D88\u606F\uFF0C\u656C\u8ACB\u671F\u5F85\uFF01" }]);
      return true;
    }
    await lineReply(env, replyToken, [buildBulletinCarousel("\u6700\u65B0\u6D88\u606F", bulletins)]);
    return true;
  }
  if (/^(學校專區|教育專區)$/.test(msg)) {
    const bulletins = await fetchBulletinsByCategories(env, ["\u6559\u80B2\u8AB2\u7A0B"]);
    if (!bulletins.length) {
      await lineReply(env, replyToken, [{ type: "text", text: "\u76EE\u524D\u5C1A\u7121\u6559\u80B2\u8AB2\u7A0B\u5167\u5BB9\uFF0C\u656C\u8ACB\u671F\u5F85\uFF01" }]);
      return true;
    }
    await lineReply(env, replyToken, [buildBulletinCarousel("\u6559\u80B2\u8AB2\u7A0B", bulletins)]);
    return true;
  }
  if (/^(治安通報|線上陳情|我要陳情)$/.test(msg)) {
    await lineReply(env, replyToken, [{
      type: "text",
      text: "\u8ACB\u9EDE\u6B64\u586B\u5BEB\u901A\u5831\u8868\u55AE\uFF0C\u91CC\u9577\u6703\u76E1\u5FEB\u8655\u7406\uFF1A\nhttps://gsnbhs.pages.dev/report"
    }]);
    return true;
  }
  if (/^(留言給我|我想建議|里長幫幫忙)$/.test(msg)) {
    await lineReply(env, replyToken, [{ type: "text", text: "\u8ACB\u76F4\u63A5\u5728\u9019\u88E1\u7559\u8A00\uFF0C\u6211\u7B49\u7B49\u5C31\u6703\u56DE\u8986\u60A8 \u{1F60A}" }]);
    return true;
  }
  if (/^(美食地圖|特約商店|特約商家|商家清單|店家清單|查商家|找商家|找店家|商家|店家|查看特約商店|查看美食地圖)$/.test(msg)) {
    await lineReply(env, replyToken, [await buildFoodMapMenu(env)]);
    return true;
  }
  if (/^(我想免費通話)$/.test(msg)) {
    await lineReply(env, replyToken, [{ type: "text", text: "\u8ACB\u9EDE\u64CA\u8207\u672C\u5E33\u865F\u5C0D\u8A71\u6846\u53F3\u4E0A\u89D2\u7684\u300C\u{1F4DE} \u901A\u8A71\u300D\u5716\u793A\uFF0C\u5373\u53EF\u767C\u8D77\u514D\u8CBB\u901A\u8A71 \u{1F4DE}" }]);
    return true;
  }
  if (/^(返回主選單)$/.test(msg)) {
    await lineReply(env, replyToken, [{ type: "text", text: "\u597D\u7684\uFF0C\u8ACB\u9EDE\u64CA\u4E0B\u65B9\u9078\u55AE\u6309\u9215\u7E7C\u7E8C\u4F7F\u7528\u5176\u4ED6\u529F\u80FD \u{1F60A}" }]);
    return true;
  }
  if (/^(商家申請|店家申請|我要申請|申請商家|申請特約)$/.test(msg)) {
    const applyUrl = await buildStoreApplyUrl(env, event.source?.userId);
    await lineReply(env, replyToken, [{ type: "text", text: "\u7279\u7D04\u5546\u5BB6\u7533\u8ACB\u8ACB\u9EDE\u6B64\u586B\u5BEB\uFF1A\n" + applyUrl }]);
    return true;
  }
  if (/^(里民憑證|出示憑證|憑證|出示里民憑證)$/.test(msg)) {
    await lineReply(env, replyToken, [{ type: "text", text: "\u9EDE\u6B64\u51FA\u793A\u91CC\u6C11\u6191\u8B49\uFF1A\n" + VOUCHER_URL }]);
    return true;
  }
  if (msg === "\u751F\u6D3B\u60C5\u5831") {
    await lineReply(env, replyToken, [buildLifeInfoFlex()]);
    return true;
  }
  if (msg === "\u7DCA\u6025\u806F\u7D61") {
    await lineReply(env, replyToken, [await buildEmergencyContactFlex(env)]);
    return true;
  }
  const surveyMatch = msg.match(/^(?:text=)?問券_(EVT[\w]*)_(SRV[\w]*)$/);
  if (surveyMatch) {
    const [, eventId, surveyId] = surveyMatch;
    const userId = event.source?.userId;
    if (!userId) return false;
    try {
      const [eventRow, surveyRow] = await Promise.all([
        env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first(),
        env.DB.prepare("SELECT payload_json FROM surveys WHERE survey_id = ?").bind(surveyId).first()
      ]);
      if (!eventRow || !surveyRow) {
        await lineReply(env, replyToken, [{ type: "text", text: "\u627E\u4E0D\u5230\u554F\u5238\uFF0C\u8ACB\u78BA\u8A8D QR Code \u662F\u5426\u6B63\u78BA\u3002" }]);
        return true;
      }
      const ev = parseJson(eventRow.payload_json);
      const survey = parseJson(surveyRow.payload_json);
      const profile = await getLineProfile(env, userId);
      const displayName = profile?.displayName || "";
      const surveyUrl = SURVEY_BASE_URL + "?eventId=" + encodeURIComponent(eventId) + "&surveyId=" + encodeURIComponent(surveyId) + "&lineUserId=" + encodeURIComponent(userId) + (displayName ? "&displayName=" + encodeURIComponent(displayName) : "");
      await lineReply(env, replyToken, [buildSurveyInviteBubble(text(ev.eventName), survey, surveyUrl)]);
    } catch (err) {
      console.error(JSON.stringify({ fn: "surveyQrKeyword", eventId, surveyId, error: err.message }));
      await lineReply(env, replyToken, [{ type: "text", text: "\u554F\u5238\u8F09\u5165\u5931\u6557\uFF1A" + err.message }]);
    }
    return true;
  }
  const cate = matchLineCategory(msg);
  if (!cate) return false;
  const stores = await fetchStoresByCategory(env, cate);
  if (!stores.length) {
    await lineReply(env, replyToken, [{ type: "text", text: `\u76EE\u524D\u300C${cate}\u300D\u5206\u985E\u5C1A\u7121\u7F8E\u98DF\u5730\u5716\u5546\u5BB6\u3002
\u8F38\u5165\u300C\u7F8E\u98DF\u5730\u5716\u300D\u53EF\u67E5\u770B\u5176\u4ED6\u5206\u985E\u3002` }]);
    return true;
  }
  await lineReply(env, replyToken, [buildStoreCarousel(cate, stores)]);
  return true;
}
__name(handleLineKeywordEvent, "handleLineKeywordEvent");
function matchLineCategory(msg) {
  for (const [k, arr] of Object.entries(LINE_CATEGORY_MAP)) {
    if (arr.includes(msg)) return k;
  }
  return null;
}
__name(matchLineCategory, "matchLineCategory");
async function fetchBulletinsByCategories(env, cates) {
  try {
    const placeholders = cates.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT payload_json FROM bulletins WHERE status = '\u5DF2\u767C\u5E03' AND category IN (${placeholders}) ORDER BY sort_order ASC, created_at DESC LIMIT 12`
    ).bind(...cates).all();
    return rows.results.map((r) => parseJson(r.payload_json));
  } catch (err) {
    console.error(JSON.stringify({ fn: "fetchBulletinsByCategories", cates, error: err.message }));
    return [];
  }
}
__name(fetchBulletinsByCategories, "fetchBulletinsByCategories");
function buildBulletinCarousel(label, bulletins) {
  const bubbles = bulletins.map((b) => buildBulletinBubble(b));
  return {
    type: "flex",
    altText: `${label}\uFF08${bulletins.length} \u5247\uFF09`,
    contents: { type: "carousel", contents: bubbles }
  };
}
__name(buildBulletinCarousel, "buildBulletinCarousel");
var BULLETIN_TAG_COLOR = {
  \u6700\u65B0\u6D88\u606F: "#F59E0B",
  \u6559\u80B2\u8AB2\u7A0B: "#7C3AED",
  \u91CC\u6C11\u6D3B\u52D5: "#2F6836",
  \u7DCA\u6025\u901A\u544A: "#B91C1C",
  \u653F\u7B56\u5BA3\u5C0E: "#1D4ED8"
};
function buildBulletinBubble(b) {
  const firstImage = String(b.imageUrl || "").split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean)[0];
  const linkUrl = String(b.linkUrl || "").trim();
  const cate = b.category || "\u91CC\u6C11\u6D3B\u52D5";
  const detailUrl = /^https?:\/\//i.test(linkUrl) ? linkUrl : BULLETIN_URL + "?category=" + encodeURIComponent(cate);
  const cardAction = BULLETIN_ACTIONS[linkUrl];
  const tapAction = cardAction ? { type: "postback", data: cardAction.data } : { type: "uri", uri: detailUrl };
  const buttonLabel = cardAction ? cardAction.label : "\u67E5\u770B\u8A73\u60C5";
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "0px",
      spacing: "none",
      action: tapAction,
      contents: [
        {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "image", url: firstImage || EVENT_IMG_FALLBACK, size: "full", aspectRatio: "20:13", aspectMode: "cover" },
            {
              type: "box",
              layout: "vertical",
              position: "absolute",
              offsetTop: "10px",
              offsetStart: "10px",
              backgroundColor: BULLETIN_TAG_COLOR[cate] || "#3B82F6",
              cornerRadius: "6px",
              paddingAll: "4px",
              contents: [{ type: "text", text: cate, size: "xs", color: "#FFFFFF", weight: "bold" }]
            }
          ]
        },
        {
          type: "box",
          layout: "vertical",
          paddingAll: "16px",
          spacing: "sm",
          contents: [
            { type: "text", text: b.title || "(\u672A\u547D\u540D)", weight: "bold", size: "md", wrap: true, maxLines: 2 },
            { type: "text", text: truncateText(stripHtmlTags(b.content), 80), size: "sm", color: "#5A7090", wrap: true, maxLines: 4 }
          ]
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      contents: [{ type: "button", style: "primary", color: "#3B82F6", height: "sm", action: { ...tapAction, label: buttonLabel } }]
    }
  };
}
__name(buildBulletinBubble, "buildBulletinBubble");
function stripHtmlTags(html) {
  return String(html || "").replace(/<[^>]*>/g, "").trim();
}
__name(stripHtmlTags, "stripHtmlTags");
function truncateText(str, max) {
  const s = String(str || "").trim();
  if (!s) return "\uFF08\u8ACB\u9EDE\u64CA\u67E5\u770B\u8A73\u60C5\uFF09";
  return s.length > max ? s.slice(0, max).trim() + "..." : s;
}
__name(truncateText, "truncateText");
async function fetchStoresByCategory(env, cate) {
  try {
    const rows = await queryStoresDb(env).prepare(
      "SELECT public_payload_json FROM stores WHERE status = '\u5DF2\u516C\u958B'"
    ).all();
    const all = rows.results.map((r) => parseJson(r.public_payload_json));
    const stores = all.filter((s) => s.pubCate === cate);
    return shuffleStores(stores).slice(0, 12);
  } catch (err) {
    console.error(JSON.stringify({ fn: "fetchStoresByCategory", cate, error: err.message }));
    return [];
  }
}
__name(fetchStoresByCategory, "fetchStoresByCategory");
function queryStoresDb(env) {
  return env.DB;
}
__name(queryStoresDb, "queryStoresDb");
function shuffleStores(stores) {
  const copy = stores.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
__name(shuffleStores, "shuffleStores");
async function startReportFlow(env, userId, replyToken) {
  await clearRptSession(env, userId);
  await saveRptSession(env, userId, { stage: "select_type" });
  await lineReply(env, replyToken, [buildRptTypeFlex()]);
}
__name(startReportFlow, "startReportFlow");
async function startCommunityFlow(env, userId, replyToken) {
  const pending = await env.DB.prepare(
    "SELECT status FROM community_applications WHERE line_user_id = ? AND status IN ('pending','approved') ORDER BY submitted_at DESC LIMIT 1"
  ).bind(userId).first().catch(() => null);
  if (pending?.status === "approved") {
    await lineReply(env, replyToken, [{
      type: "text",
      text: "\u60A8\u5148\u524D\u7684\u7533\u8ACB\u5DF2\u901A\u904E\u5BE9\u6838 \u{1F60A}\n\n\u793E\u7FA4\u9023\u7D50\uFF1A\n" + communityInviteUrl(env) + "\n\n" + COM_JOINED_NOTE
    }]);
    return;
  }
  if (pending?.status === "pending") {
    await lineReply(env, replyToken, [{ type: "text", text: "\u60A8\u5DF2\u7D93\u9001\u51FA\u7533\u8ACB\u56C9\uFF0C\u91CC\u9577\u5BE9\u6838\u5F8C\u6703\u4E3B\u52D5\u628A\u793E\u7FA4\u9023\u7D50\u50B3\u7D66\u60A8\uFF0C\u8ACB\u8010\u5FC3\u7B49\u5019 \u{1F64F}" }]);
    return;
  }
  await saveComSession(env, userId, { stage: "q0", answers: {} });
  await lineReply(env, replyToken, [
    { type: "text", text: COM_INTRO_TEXT },
    { type: "text", text: COM_QUESTIONS[0].prompt + "\n\n\uFF08\u96A8\u6642\u8F38\u5165\u300C\u53D6\u6D88\u300D\u53EF\u7D50\u675F\u7533\u8ACB\uFF09" }
  ]);
}
__name(startCommunityFlow, "startCommunityFlow");
function communityInviteUrl(env) {
  return text(env.COMMUNITY_INVITE_URL);
}
__name(communityInviteUrl, "communityInviteUrl");
async function buildStoreApplyUrl(env, userId) {
  if (!userId) return STORE_APPLY_URL;
  const profile = await getLineProfile(env, userId);
  const displayName = profile?.displayName || "";
  return STORE_APPLY_URL + "?lineUserId=" + encodeURIComponent(userId) + (displayName ? "&displayName=" + encodeURIComponent(displayName) : "");
}
__name(buildStoreApplyUrl, "buildStoreApplyUrl");
async function handleLineCommunityEvent(env, userId, replyToken, event) {
  if (event.type !== "message" || event.message?.type !== "text" || !replyToken) return false;
  const msg = String(event.message.text || "").trim();
  if (COM_START_RE.test(msg)) {
    await startCommunityFlow(env, userId, replyToken);
    return true;
  }
  const state = await getComSession(env, userId);
  if (!state.stage) return false;
  if (COM_CANCEL_RE.test(msg)) {
    await clearComSession(env, userId);
    await lineReply(env, replyToken, [{ type: "text", text: "\u5DF2\u53D6\u6D88\u7533\u8ACB\u3002\u9700\u8981\u6642\u518D\u8F38\u5165\u300C\u52A0\u5165\u5171\u5B78\u793E\u7FA4\u300D\u5373\u53EF\u91CD\u65B0\u958B\u59CB \u{1F60A}" }]);
    return true;
  }
  const idx = parseInt(String(state.stage).slice(1), 10) || 0;
  const question = COM_QUESTIONS[idx];
  if (!question) {
    await clearComSession(env, userId);
    return false;
  }
  const answers = { ...state.answers || {}, [question.key]: msg.substring(0, 100) };
  const next = COM_QUESTIONS[idx + 1];
  if (next) {
    await saveComSession(env, userId, { stage: "q" + (idx + 1), answers });
    await lineReply(env, replyToken, [{ type: "text", text: next.prompt }]);
    return true;
  }
  await clearComSession(env, userId);
  await submitCommunityApplication(env, userId, replyToken, answers);
  return true;
}
__name(handleLineCommunityEvent, "handleLineCommunityEvent");
async function submitCommunityApplication(env, userId, replyToken, answers) {
  const profile = await getLineProfile(env, userId);
  const displayName = profile?.displayName || "";
  const applicationId = crypto.randomUUID();
  const submittedAt = taiwanIsoNow();
  await env.DB.prepare(
    `INSERT INTO community_applications
       (application_id, line_user_id, display_name, current_school, target_school, residence, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    applicationId,
    userId,
    displayName,
    text(answers.current_school),
    text(answers.target_school),
    text(answers.residence),
    submittedAt
  ).run();
  const pushed = await notifyHub(env, [buildCommunityReviewCard({
    applicationId,
    displayName,
    submittedAt,
    currentSchool: text(answers.current_school),
    targetSchool: text(answers.target_school),
    residence: text(answers.residence)
  })]);
  if (!pushed) {
    console.error(JSON.stringify({ fn: "submitCommunityApplication", error: "hub notify failed", applicationId }));
  }
  await lineReply(env, replyToken, [{
    type: "text",
    text: `\u2705 \u5DF2\u6536\u5230\u60A8\u7684\u7533\u8ACB\uFF01

\u30FB\u76EE\u524D\u5C31\u8B80\uFF1A${text(answers.current_school)}
\u30FB\u9810\u8A08\u5C31\u8B80\uFF1A${text(answers.target_school)}
\u30FB\u5C45\u4F4F\u5730\u540D\uFF1A${text(answers.residence)}

\u91CC\u9577\u5BE9\u6838\u901A\u904E\u5F8C\uFF0C\u6703\u76F4\u63A5\u628A\u793E\u7FA4\u9023\u7D50\u50B3\u7D66\u60A8\uFF0C\u8ACB\u7A0D\u5019 \u{1F64F}`
  }]);
}
__name(submitCommunityApplication, "submitCommunityApplication");
function buildCommunityReviewCard(app) {
  const row = /* @__PURE__ */ __name((label, value) => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#8C8C8C", flex: 2 },
      { type: "text", text: value || "\u2014", size: "sm", color: "#111111", flex: 5, wrap: true }
    ]
  }), "row");
  return {
    type: "flex",
    altText: `\u5171\u5B78\u793E\u7FA4\u7533\u8ACB\uFF1A${app.displayName || "\u91CC\u6C11"}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        backgroundColor: "#1F7A4D",
        contents: [{ type: "text", text: "\u{1F393} \u5BB6\u9577\u5171\u5B78\u793E\u7FA4\u7533\u8ACB", color: "#FFFFFF", weight: "bold", size: "md" }]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: app.displayName || "\uFF08\u672A\u53D6\u5F97 LINE \u540D\u7A31\uFF09", weight: "bold", size: "lg", wrap: true },
          { type: "separator" },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              row("\u76EE\u524D\u5C31\u8B80", app.currentSchool),
              row("\u9810\u8A08\u5C31\u8B80", app.targetSchool),
              row("\u5C45\u4F4F\u5730\u540D", app.residence),
              row("\u7533\u8ACB\u6642\u9593", app.submittedAt)
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1F7A4D",
            height: "sm",
            action: { type: "postback", label: "\u2705 \u901A\u904E", data: `hub:review:GSNBHS:community:${app.applicationId}:approve` }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "postback", label: "\u{1F6AB} \u5A49\u62D2", data: `hub:review:GSNBHS:community:${app.applicationId}:reject` }
          }
        ]
      }
    }
  };
}
__name(buildCommunityReviewCard, "buildCommunityReviewCard");
async function handleHubCallback(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!env.NOTIFY_HUB_SECRET || auth !== "Bearer " + env.NOTIFY_HUB_SECRET) {
    return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  const data = parseJson(await request.text());
  const kind = text(data.kind);
  const id = text(data.id);
  const action = text(data.action);
  const reply = /* @__PURE__ */ __name((body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  }), "reply");
  if (kind !== "community") return reply({ success: false, error: "unknown kind: " + kind }, 400);
  const app = await env.DB.prepare(
    "SELECT line_user_id, display_name, status FROM community_applications WHERE application_id = ?"
  ).bind(id).first();
  if (!app) return reply({ success: false, error: "\u627E\u4E0D\u5230\u9019\u7B46\u7533\u8ACB" }, 404);
  if (app.status !== "pending") {
    return reply({ success: false, error: `\u9019\u7B46\u7533\u8ACB\u5DF2\u7D93\u8655\u7406\u904E\u4E86\uFF08${app.status === "approved" ? "\u5DF2\u901A\u904E" : "\u5DF2\u5A49\u62D2"}\uFF09` });
  }
  const approved = action === "approve";
  const inviteUrl = communityInviteUrl(env);
  if (approved && !inviteUrl) {
    return reply({ success: false, error: "\u5C1A\u672A\u8A2D\u5B9A\u793E\u7FA4\u9080\u8ACB\u9023\u7D50" }, 500);
  }
  await env.DB.prepare(
    "UPDATE community_applications SET status = ?, reviewer_id = ?, reviewed_at = ? WHERE application_id = ?"
  ).bind(approved ? "approved" : "rejected", text(data.reviewerId), text(data.reviewedAt) || taiwanIsoNow(), id).run();
  const sent = await linePush(env, app.line_user_id, [{
    type: "text",
    text: approved ? "\u{1F389} \u60A8\u7684\u5171\u5B78\u793E\u7FA4\u7533\u8ACB\u5DF2\u901A\u904E\u5BE9\u6838\uFF01\n\n\u8ACB\u9EDE\u4EE5\u4E0B\u9023\u7D50\u52A0\u5165\u300C\u91CC\u60F3\u751F\u6D3B\uFF5C\u570B\u4E2D\u5C0F\u5BB6\u9577\u5171\u5B78\u7248\u300D\uFF1A\n" + inviteUrl + "\n\n" + COM_JOINED_NOTE : "\u611F\u8B1D\u60A8\u7533\u8ACB\u52A0\u5165\u5171\u5B78\u793E\u7FA4\u3002\n\n\u7D93\u91CC\u9577\u78BA\u8A8D\uFF0C\u60A8\u7684\u7533\u8ACB\u76EE\u524D\u672A\u80FD\u901A\u904E\uFF08\u672C\u793E\u7FA4\u50C5\u958B\u653E\u5E7C\u7A1A\u5712\u4EE5\u4E0A\u5B78\u7AE5\u5BB6\u9577\u53C3\u52A0\uFF09\u3002\n\u5982\u6709\u7591\u554F\u6B61\u8FCE\u76F4\u63A5\u7559\u8A00\u8A62\u554F\u91CC\u9577 \u{1F64F}"
  }]);
  return reply({ success: true, applicantName: app.display_name, delivered: sent });
}
__name(handleHubCallback, "handleHubCallback");
async function handleLineReportEvent(env, userId, replyToken, event) {
  const state = await getRptSession(env, userId);
  const hasSess = !!state.stage;
  if (event.type === "message" && event.message?.type === "text") {
    const msg = String(event.message.text || "").trim();
    if (RPT_START_RE.test(msg)) {
      await startReportFlow(env, userId, replyToken);
      return true;
    }
    if (!hasSess) return false;
    if (RPT_CANCEL_RE_R.test(msg)) {
      await clearRptSession(env, userId);
      await lineReply(env, replyToken, [{ type: "text", text: "\u5DF2\u53D6\u6D88\u901A\u5831\u6D41\u7A0B\u3002\u9700\u8981\u901A\u5831\u6642\u8ACB\u8F38\u5165\u300C\u6211\u8981\u901A\u5831\u300D\u3002" }]);
      return true;
    }
    if (state.stage === "select_type") {
      await lineReply(env, replyToken, [{ type: "text", text: "\u8ACB\u9EDE\u9078\u4E0A\u65B9\u7684\u985E\u5225\u6309\u9215\u9078\u64C7\u901A\u5831\u985E\u5225\u3002\n\u82E5\u8981\u53D6\u6D88\u8ACB\u8F38\u5165\u300C\u53D6\u6D88\u300D\u3002" }]);
      return true;
    }
    if (state.stage === "input_location") {
      await lineReply(env, replyToken, [{
        type: "text",
        text: "\u8ACB\u9EDE\u9078\u300C\u50B3\u9001\u4F4D\u7F6E\u300D\u5206\u4EAB\u4F4D\u7F6E\uFF0C\u6216\u9EDE\u9078\u300C\u7565\u904E\u4F4D\u7F6E\u300D\u8DF3\u904E\u3002\n\u82E5\u8981\u53D6\u6D88\u8ACB\u8F38\u5165\u300C\u53D6\u6D88\u300D\u3002",
        quickReply: {
          items: [
            { type: "action", action: { type: "location", label: "\u50B3\u9001\u4F4D\u7F6E" } },
            { type: "action", action: { type: "postback", label: "\u7565\u904E\u4F4D\u7F6E", data: "rpt:skip_location" } }
          ]
        }
      }]);
      return true;
    }
    if (state.stage === "input_more_photo") {
      await lineReply(env, replyToken, [buildRptMorePhotoMsg(state.photoCount || 1)]);
      return true;
    }
    if (state.stage === "input_desc") {
      state.description = msg.substring(0, 200);
      state.stage = "input_photo";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [{
        type: "text",
        text: "\u6536\u5230\u8AAA\u660E\uFF01\n\n\u662F\u5426\u8981\u9644\u4E0A\u7167\u7247\uFF1F\n\u8ACB\u76F4\u63A5\u50B3\u9001\u7167\u7247\uFF0C\u6216\u9EDE\u9078\u300C\u7565\u904E\u300D\u7E7C\u7E8C\u3002",
        quickReply: {
          items: [
            { type: "action", action: { type: "postback", label: "\u7565\u904E\u7167\u7247", data: "rpt:skip_photo" } },
            { type: "action", action: { type: "camera", label: "\u62CD\u7167" } },
            { type: "action", action: { type: "cameraRoll", label: "\u5F9E\u76F8\u7C3F\u9078" } }
          ]
        }
      }]);
      return true;
    }
    return false;
  }
  if (event.type === "message" && event.message?.type === "image") {
    if (!hasSess) return false;
    if (state.stage === "input_location") {
      await lineReply(env, replyToken, [{
        type: "text",
        text: "\u{1F4F8} \u7167\u7247\u7A0D\u5F8C\u9084\u53EF\u4EE5\u9644\u4E0A\uFF01\n\n\u73FE\u5728\u8ACB\u5148\u5206\u4EAB\u554F\u984C\u7684\u4F4D\u7F6E\u7D66\u91CC\u9577\u53C3\u8003\uFF0C\u8B93\u91CC\u9577\u80FD\u5FEB\u901F\u627E\u5230\u73FE\u5834\u3002",
        quickReply: {
          items: [
            { type: "action", action: { type: "location", label: "\u50B3\u9001\u4F4D\u7F6E" } },
            { type: "action", action: { type: "postback", label: "\u7565\u904E\u4F4D\u7F6E", data: "rpt:skip_location" } }
          ]
        }
      }]);
      return true;
    }
    if (state.stage === "input_photo") {
      state.hasPhoto = true;
      state.photoCount = 1;
      state.stage = "input_more_photo";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [buildRptMorePhotoMsg(1)]);
      return true;
    }
    if (state.stage === "input_more_photo") {
      state.photoCount = (state.photoCount || 1) + 1;
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [buildRptMorePhotoMsg(state.photoCount)]);
      return true;
    }
    return false;
  }
  if (event.type === "message" && event.message?.type === "location") {
    if (!hasSess || state.stage !== "input_location") return false;
    state.latitude = event.message.latitude;
    state.longitude = event.message.longitude;
    state.address = event.message.address || "";
    state.stage = "input_desc";
    await saveRptSession(env, userId, state);
    await lineReply(env, replyToken, [{ type: "text", text: "\u{1F4CD} \u4F4D\u7F6E\u5DF2\u6536\u5230\uFF01\n\n\u8ACB\u7528\u6587\u5B57\u63CF\u8FF0\u554F\u984C\u72C0\u6CC1\uFF0C\u6700\u591A 200 \u5B57\uFF1A" }]);
    return true;
  }
  if (event.type === "postback") {
    const data = String(event.postback?.data || "");
    if (!data.startsWith("rpt:")) return false;
    if (data.startsWith("rpt:type:")) {
      const type = data.slice("rpt:type:".length);
      await saveRptSession(env, userId, { stage: "input_location", type });
      await lineReply(env, replyToken, [{
        type: "text",
        text: `\u2705 \u985E\u5225\uFF1A${type}

\u8ACB\u50B3\u9001\u554F\u984C\u767C\u751F\u7684\u4F4D\u7F6E\uFF0C\u8B93\u91CC\u9577\u80FD\u5FEB\u901F\u524D\u5F80\u73FE\u5834\u3002`,
        quickReply: {
          items: [
            { type: "action", action: { type: "location", label: "\u50B3\u9001\u4F4D\u7F6E" } },
            { type: "action", action: { type: "postback", label: "\u7565\u904E\u4F4D\u7F6E", data: "rpt:skip_location" } }
          ]
        }
      }]);
      return true;
    }
    if (data === "rpt:skip_location") {
      if (!hasSess) return false;
      state.latitude = null;
      state.longitude = null;
      state.address = "";
      state.stage = "input_desc";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [{ type: "text", text: "\u8ACB\u7528\u6587\u5B57\u63CF\u8FF0\u554F\u984C\uFF08\u53EF\u5728\u8AAA\u660E\u4E2D\u52A0\u5165\u4F4D\u7F6E\u8CC7\u8A0A\uFF09\uFF0C\u6700\u591A 200 \u5B57\uFF1A" }]);
      return true;
    }
    if (data === "rpt:no_more_photo") {
      if (!hasSess) return false;
      state.stage = "confirm";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [buildRptConfirmBubble(state)]);
      return true;
    }
    if (data === "rpt:skip_photo") {
      if (!hasSess) return false;
      state.hasPhoto = false;
      state.stage = "confirm";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [buildRptConfirmBubble(state)]);
      return true;
    }
    if (data === "rpt:submit") {
      if (!hasSess) return false;
      const saved = { ...state };
      await clearRptSession(env, userId);
      await lineReply(env, replyToken, [buildRptThankYouBubble(saved)]);
      return true;
    }
    if (data === "rpt:cancel") {
      await clearRptSession(env, userId);
      await lineReply(env, replyToken, [{ type: "text", text: "\u5DF2\u53D6\u6D88\u901A\u5831\u3002\u9700\u8981\u901A\u5831\u6642\u8ACB\u518D\u8F38\u5165\u300C\u6211\u8981\u901A\u5831\u300D\u3002" }]);
      return true;
    }
    return false;
  }
  return false;
}
__name(handleLineReportEvent, "handleLineReportEvent");
function parsePostbackData(data) {
  const result = {};
  if (!data) return result;
  for (const part of data.split("&")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    result[decodeURIComponent(part.slice(0, eqIdx))] = decodeURIComponent(part.slice(eqIdx + 1));
  }
  return result;
}
__name(parsePostbackData, "parsePostbackData");
function fmtEventDateRange(start, end) {
  const toTW = /* @__PURE__ */ __name((iso) => {
    if (!iso) return "";
    const ms = parseTaiwanIsoToMs(iso);
    const d = isNaN(ms) ? new Date(iso) : new Date(ms);
    if (isNaN(d.getTime())) return String(iso);
    const p = new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(d);
    const g = /* @__PURE__ */ __name((t) => p.find((x) => x.type === t)?.value ?? "", "g");
    return `${g("year")}/${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`;
  }, "toTW");
  const s = toTW(start);
  const e = toTW(end);
  if (s && e) return s.slice(0, 10) === e.slice(0, 10) ? `${s.slice(0, 10)} ${s.slice(11)}-${e.slice(11)}` : `${s} - ${e}`;
  return s || e || "";
}
__name(fmtEventDateRange, "fmtEventDateRange");
function buildMultiStatusText(selected) {
  if (!selected?.length) return "\u76EE\u524D\u5C1A\u672A\u9078\u53D6\u3002\u9078\u597D\u5F8C\u8ACB\u6309\u300C\u9078\u597D\u4E86\uFF0C\u4E0B\u4E00\u984C\u300D\u3002";
  return "\u76EE\u524D\u5DF2\u9078\uFF1A" + selected.join("\u3001") + "\n\u9078\u597D\u5F8C\u8ACB\u6309\u300C\u9078\u597D\u4E86\uFF0C\u4E0B\u4E00\u984C\u300D\u3002";
}
__name(buildMultiStatusText, "buildMultiStatusText");
function fmtReminderTime(reminderTime) {
  if (!reminderTime) return "";
  const m = String(reminderTime).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
  return reminderTime;
}
__name(fmtReminderTime, "fmtReminderTime");
async function getCategoriesWithStores(env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT DISTINCT pub_cate FROM stores WHERE status = '\u5DF2\u516C\u958B'"
    ).all();
    return new Set(rows.results.map((r) => r.pub_cate));
  } catch (err) {
    console.error(JSON.stringify({ fn: "getCategoriesWithStores", error: err.message }));
    return null;
  }
}
__name(getCategoriesWithStores, "getCategoriesWithStores");
async function buildFoodMapMenu(env) {
  const activeCategories = await getCategoriesWithStores(env);
  const items = activeCategories ? FOOD_MAP_MENU_ITEMS.filter((item) => item.text === "\u5546\u5BB6\u7533\u8ACB" || activeCategories.has(item.text)) : FOOD_MAP_MENU_ITEMS;
  const bubbles = items.map((item) => ({
    type: "bubble",
    size: "micro",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: item.color,
      paddingAll: "12px",
      contents: [
        { type: "text", text: item.emoji, size: "xl", align: "center" },
        { type: "text", text: item.title, size: "md", color: "#FFFFFF", weight: "bold", align: "center", wrap: true, margin: "sm" }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [{ type: "text", text: item.desc, size: "xs", color: "#5A7090", wrap: true, maxLines: 3 }]
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "8px",
      contents: [{
        type: "button",
        style: item.text === "\u5546\u5BB6\u7533\u8ACB" ? "secondary" : "primary",
        height: "sm",
        color: item.text === "\u5546\u5BB6\u7533\u8ACB" ? void 0 : item.color,
        action: item.text === "\u5546\u5BB6\u7533\u8ACB" ? { type: "uri", label: "\u6211\u8981\u7533\u8ACB", uri: "https://gsnbhs.pages.dev/store" } : { type: "postback", label: "\u67E5\u770B\u5546\u5BB6", data: "action=menu&menu=store_cate&cate=" + encodeURIComponent(item.text) }
      }]
    }
  }));
  return { type: "flex", altText: "\u820A\u793E\u91CC\u7F8E\u98DF\u5730\u5716\u5206\u985E", contents: { type: "carousel", contents: bubbles } };
}
__name(buildFoodMapMenu, "buildFoodMapMenu");
function buildLifeInfoFlex() {
  return {
    type: "flex",
    altText: "\u751F\u6D3B\u60C5\u5831",
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#A3C0D1",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "\u{1F3E1} \u820A\u793E\u91CC\u5927\u5C0F\u4E8B", color: "#FFFFFF", weight: "bold", size: "xl" },
          { type: "text", text: "\u4E00\u6B65\u4E00\u4F86\u5230\uFF0C\u5171\u70BA\u6539\u5584\u751F\u6D3B\u74B0\u5883", color: "#DCEBFA", size: "sm", margin: "sm" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          { type: "text", text: "\u{1F4A1} \u9130\u91CC\u5EFA\u8A2D", weight: "bold", size: "md", color: "#444444" },
          { type: "button", style: "primary", height: "sm", color: "#737A46", action: { type: "uri", label: "\u{1F333} \u6821\u820D\u5EFA\u8A2D", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#737A46", action: { type: "uri", label: "\u{1F3E2} \u7B49\u5019\u7A7A\u9593", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#737A46", action: { type: "uri", label: "\u{1F3EB} \u7B49\u5019\u5074\u5C0F\u5EFA\u8A2D", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#737A46", action: { type: "uri", label: "\u{1F68C} \u5019\u8ECA\u4EAD\u5EFA\u8A2D", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#E69583", action: { type: "uri", label: "\u{1F333} \u5BF5\u7269\u516C\u5712", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#E69583", action: { type: "uri", label: "\u{1F333} \u666F\u89C0\u5730\u8A2D\u7F6E", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "separator", margin: "md" },
          { type: "text", text: "\u{1F6E3} \u9053\u8DEF\u8207\u6C34\u5229", weight: "bold", size: "md", color: "#444444", margin: "md" },
          { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: "\u{1F6E3} XX\u8DEF\u62D3\u5BEC", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: "\u{1F4A1} \u5C55\u5730\u5C0F\u8A2D\u65BD\u898F\u756B", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: "\u{1F331} \u5B9A\u671F\u8DEF\u6A4B\u76F8\u5229\u6DFB\u65B0\u8A2D\u65BD", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: "\u{1F3E3} XX\u8857\u9053\u8DEF\u7FFB\u65B0", uri: "https://www.facebook.com/profile.php?id=61588593610574" } }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        contents: [
          { type: "button", style: "link", action: { type: "uri", label: "\u7DDA\u4E0A\u9673\u60C5", uri: "https://forms.fillout.com/t/eniXfoCyTeus" } },
          { type: "button", style: "link", action: { type: "uri", label: "\u6848\u4EF6\u7E3D\u89BD", uri: "https://delaine19093.softr.app/" } }
        ]
      }
    }
  };
}
__name(buildLifeInfoFlex, "buildLifeInfoFlex");
async function buildEmergencyContactFlex(env) {
  const contacts = await getEmergencyContactsForLine(env);
  const buttons = contacts.length ? contacts.map((c) => {
    if (c.kind === "hint") {
      return { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "message", label: c.name, text: "\u6211\u60F3\u514D\u8CBB\u901A\u8A71" } };
    }
    if (c.kind === "url") {
      return { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: c.name, uri: c.phone } };
    }
    return { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: (c.org ? c.org + " " : "") + c.name, uri: "tel:" + c.phone } };
  }) : [{ type: "text", text: "\u76EE\u524D\u5C1A\u672A\u8A2D\u5B9A\u806F\u7D61\u96FB\u8A71", color: "#94A3B8", size: "sm" }];
  return {
    type: "flex",
    altText: "\u806F\u7D61\u96FB\u8A71",
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0B5EA8",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "\u91CD\u8981\u806F\u7D61\u96FB\u8A71", color: "#FFFFFF", weight: "bold", size: "xl" },
          { type: "text", text: "\u9EDE\u9078\u5F8C\u53EF\u4EE5\u76F4\u63A5\u96FB\u8A71", color: "#DCEBFA", size: "sm", margin: "sm" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: buttons
      }
    }
  };
}
__name(buildEmergencyContactFlex, "buildEmergencyContactFlex");
function buildStoreCarousel(category, stores) {
  const info = LINE_CATEGORY_INFO[category] || { title: category, emoji: "\u{1F3EA}", subtitle: "", color: "#3B82F6" };
  const bubbles = [];
  for (let i = 0; i < stores.length; i += 3) {
    bubbles.push(buildStoreBubble(info, stores.slice(i, i + 3)));
    if (bubbles.length >= 4) break;
  }
  return {
    type: "flex",
    altText: `${info.title}\uFF1A\u7F8E\u98DF\u5730\u5716\u5546\u5BB6\u6E05\u55AE\uFF08${stores.length} \u9593\uFF09`,
    contents: { type: "carousel", contents: bubbles }
  };
}
__name(buildStoreCarousel, "buildStoreCarousel");
function buildStoreBubble(info, stores) {
  const bodyContents = [];
  stores.forEach((s, idx) => {
    if (idx > 0) bodyContents.push({ type: "separator", margin: "md" });
    bodyContents.push(buildStoreItem(s));
  });
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: info.color || "#3B82F6",
      paddingAll: "16px",
      contents: [
        { type: "text", text: info.title + " " + info.emoji, size: "xl", color: "#FFFFFF", weight: "bold" },
        { type: "text", text: "\u512A\u60E0\u5167\u5BB9\u4F9D\u5404\u5E97\u5BB6\u5BE6\u969B\u6D3B\u52D5\u8FA6\u6CD5\u70BA\u6E96\uFF0C\u4F7F\u7528\u524D\u8ACB\u5148\u5411\u5E97\u5BB6\u78BA\u8A8D\u3002", size: "xxs", color: "#FFFFFFE6", wrap: true, margin: "md" }
      ]
    },
    body: { type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm", contents: bodyContents },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "button", style: "primary", color: "#5B9B7B", action: { type: "uri", label: "\u51FA\u793A\u91CC\u6C11\u6191\u8B49", uri: VOUCHER_URL } },
        { type: "button", style: "secondary", action: { type: "uri", label: "\u66F4\u591A\u5546\u5BB6", uri: STORE_LIST_URL } }
      ]
    }
  };
}
__name(buildStoreBubble, "buildStoreBubble");
function buildStoreItem(s) {
  const img = s.photo1 || STORE_IMG_FALLBACK;
  const brandUrl = String(s.brandUrl || "").trim();
  const detailUrl = STORE_DETAIL_URL + encodeURIComponent(s.storeId);
  const btnUrl = /^https?:\/\//i.test(brandUrl) ? brandUrl : detailUrl;
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    height: "128px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        height: "84px",
        action: { type: "uri", label: "\u67E5\u770B\u5546\u5BB6", uri: detailUrl },
        contents: [
          { type: "image", url: img, flex: 2, size: "full", aspectRatio: "1:1", aspectMode: "cover" },
          {
            type: "box",
            layout: "vertical",
            flex: 5,
            spacing: "xs",
            contents: [
              { type: "text", text: s.pubName || "(\u672A\u547D\u540D)", weight: "bold", size: "md", wrap: true, maxLines: 2 },
              { type: "text", text: s.pubOffer || "\uFF08\u8ACB\u6D3D\u5E97\u5BB6\uFF09", size: "sm", color: "#5A7090", wrap: true, maxLines: 4 }
            ]
          }
        ]
      },
      { type: "button", style: "primary", color: "#3B82F6", height: "sm", action: { type: "uri", label: "\u54C1\u724C\u4ECB\u7D39", uri: btnUrl } }
    ]
  };
}
__name(buildStoreItem, "buildStoreItem");
function buildEvtListCarousel(events) {
  const bubbles = events.slice(0, 12).map((ev) => {
    const statusText = ev.isFull ? "\u{1F534} \u540D\u984D\u5DF2\u6EFF" : ev.isAlmostFull ? `\u26A0\uFE0F \u5269\u9918 ${ev.remaining} \u500B\u540D\u984D` : "\u{1F7E2} \u5831\u540D\u4E2D";
    const statusColor = ev.isFull ? "#cc0000" : ev.isAlmostFull ? "#e37400" : "#00aa44";
    const bodyContents = [
      { type: "text", text: ev.eventName, weight: "bold", size: "md", wrap: true },
      ev.eventDate ? { type: "text", text: "\u{1F4C5} " + ev.eventDate, size: "sm", color: "#555555", wrap: true } : null,
      ev.eventLocation ? buildEvtLocationText(ev) : null,
      ev.description ? { type: "text", text: ev.description, size: "sm", color: "#555555", wrap: true, margin: "sm" } : null,
      { type: "text", text: statusText, size: "sm", color: statusColor }
    ].filter(Boolean);
    const btnAction = ev.isFull ? { type: "message", label: "\u540D\u984D\u5DF2\u6EFF", text: "\u6B64\u6D3B\u52D5\u540D\u984D\u5DF2\u6EFF" } : { type: "postback", label: "\u9078\u64C7\u6B64\u6D3B\u52D5", data: `action=evt:select&eventId=${ev.eventId}` };
    const bubble = {
      type: "bubble",
      size: "giga",
      body: { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents },
      footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: ev.isFull ? "secondary" : "primary", color: ev.isFull ? void 0 : "#1a73e8", height: "sm", action: btnAction }] }
    };
    const heroUrl = ev.imageUrl || EVENT_IMG_FALLBACK;
    bubble.hero = { type: "image", url: heroUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover", gravity: "top" };
    return bubble;
  });
  return { type: "flex", altText: "\u76EE\u524D\u53EF\u5831\u540D\u7684\u6D3B\u52D5", contents: { type: "carousel", contents: bubbles } };
}
__name(buildEvtListCarousel, "buildEvtListCarousel");
function buildEvtLocationText(ev) {
  const loc = { type: "text", text: ev.eventLocation, size: "sm", color: ev.mapUrl ? "#1a73e8" : "#555555", wrap: true, flex: 1 };
  if (ev.mapUrl) {
    loc.decoration = "underline";
    loc.action = { type: "uri", uri: ev.mapUrl };
  }
  return { type: "box", layout: "horizontal", spacing: "xs", contents: [{ type: "text", text: "\u{1F4CD}", size: "sm", flex: 0 }, loc] };
}
__name(buildEvtLocationText, "buildEvtLocationText");
function buildEvtConfirmBubble(ev) {
  const bodyContents = [
    { type: "text", text: "\u60A8\u9078\u64C7\u7684\u6D3B\u52D5\uFF1A", size: "sm", color: "#666666" },
    { type: "text", text: ev.eventName, weight: "bold", size: "lg", wrap: true },
    ev.eventDate ? { type: "text", text: "\u{1F4C5} " + ev.eventDate, size: "sm", color: "#555555" } : null,
    ev.eventLocation ? buildEvtLocationText(ev) : null,
    ev.isAlmostFull ? { type: "text", text: `\u26A0\uFE0F \u672C\u6D3B\u52D5\u76EE\u524D\u5269\u9918 ${ev.remaining} \u500B\u540D\u984D\uFF0C\u8ACB\u628A\u63E1\u6A5F\u6703\uFF01`, size: "sm", color: "#e37400", wrap: true, margin: "sm" } : null,
    { type: "separator", margin: "md" },
    { type: "text", text: "\u662F\u9019\u500B\u6D3B\u52D5\u55CE\uFF1F", size: "md", weight: "bold", margin: "md" }
  ].filter(Boolean);
  const heroUrl = ev.imageUrl || EVENT_IMG_FALLBACK;
  return {
    type: "flex",
    altText: "\u78BA\u8A8D\u5831\u540D\u6D3B\u52D5\uFF1F",
    contents: {
      type: "bubble",
      hero: { type: "image", url: heroUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover", gravity: "top" },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
        { type: "button", style: "secondary", height: "sm", flex: 1, action: { type: "postback", label: "\u4E0D\u662F", data: "action=evt:confirm_no" } },
        { type: "button", style: "primary", height: "sm", flex: 2, color: "#1a73e8", action: { type: "postback", label: "\u662F\uFF0C\u6211\u8981\u5831\u540D", data: "action=evt:confirm_yes" } }
      ] }
    }
  };
}
__name(buildEvtConfirmBubble, "buildEvtConfirmBubble");
function buildEvtConsentBubble() {
  return {
    type: "flex",
    altText: "\u{1F4F8} \u6D3B\u52D5\u7167\u7247\u62CD\u651D\u544A\u77E5",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: "#1a73e8", contents: [{ type: "text", text: "\u{1F4F8} \u6D3B\u52D5\u7167\u7247\u62CD\u651D\u544A\u77E5", color: "#ffffff", weight: "bold", size: "md" }] },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "text", text: "\u672C\u6D3B\u52D5\u9032\u884C\u671F\u9593\u53EF\u80FD\u9032\u884C\u651D\u5F71\u8A18\u9304\u3002", wrap: true, size: "sm" },
        { type: "text", text: "\u7167\u7247\u53EF\u80FD\u7528\u65BC\u91CC\u8FA6\u516C\u5BA4\u793E\u7FA4\u5A92\u9AD4\u3001\u5BA3\u50B3\u8CC7\u6599\u3002", wrap: true, size: "sm" },
        { type: "text", text: "\u5982\u4E0D\u540C\u610F\uFF0C\u4ECD\u53EF\u7E7C\u7E8C\u5831\u540D\uFF0C\u6D3B\u52D5\u62CD\u651D\u6642\u5DE5\u4F5C\u4EBA\u54E1\u6703\u7559\u610F\u907F\u958B\u3002", wrap: true, size: "sm", color: "#666666" },
        { type: "separator", margin: "md" },
        { type: "text", text: "\u9078\u300C\u6211\u540C\u610F\u300D\u5373\u8996\u70BA\u5DF2\u95B1\u8B80\u4E26\u63A5\u53D7\u4E0A\u8FF0\u8AAA\u660E\u3002", wrap: true, size: "xs", color: "#999999", margin: "md" }
      ] },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
        { type: "button", style: "secondary", height: "sm", flex: 1, action: { type: "postback", label: "\u4E0D\u540C\u610F", data: "action=evt:consent_no" } },
        { type: "button", style: "primary", height: "sm", flex: 1, color: "#1a73e8", action: { type: "postback", label: "\u6211\u540C\u610F", data: "action=evt:consent_yes" } }
      ] }
    }
  };
}
__name(buildEvtConsentBubble, "buildEvtConsentBubble");
function buildEvtQuestionHeader(headerText, progress) {
  return {
    type: "box",
    layout: "horizontal",
    backgroundColor: "#1a73e8",
    paddingAll: "16px",
    contents: [
      { type: "text", text: "\u{1F3AA} " + headerText, color: "#ffffff", weight: "bold", size: "sm", flex: 1 },
      progress ? { type: "text", text: progress, color: "#ffffff", weight: "bold", size: "sm", align: "end", flex: 0 } : null
    ].filter(Boolean)
  };
}
__name(buildEvtQuestionHeader, "buildEvtQuestionHeader");
function buildEvtQuestionMsgs(q, qIdx, total) {
  if (!q) return [];
  const progress = `(${qIdx + 1}/${total})`;
  if (q.type === "text") {
    const contents = [
      { type: "text", text: q.label, weight: "bold", size: "md", wrap: true },
      { type: "text", text: "\u8ACB\u76F4\u63A5\u5728\u804A\u5929\u5BA4\u8F38\u5165\u7B54\u6848\u5F8C\u9001\u51FA\u3002", size: "sm", color: "#666666", wrap: true, margin: "md" },
      q.required ? null : { type: "text", text: "\u6B64\u984C\u975E\u5FC5\u586B\uFF0C\u4E5F\u53EF\u4EE5\u7565\u904E\u3002", size: "xs", color: "#999999", wrap: true, margin: "sm" }
    ].filter(Boolean);
    const footer = q.required ? [] : [{ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "\u7565\u904E\u6B64\u984C", data: "action=evt:skip" } }];
    return [{ type: "flex", altText: q.label, contents: {
      type: "bubble",
      header: buildEvtQuestionHeader("\u8ACB\u56DE\u7B54\u554F\u984C", progress),
      body: { type: "box", layout: "vertical", spacing: "sm", contents },
      footer: footer.length ? { type: "box", layout: "vertical", spacing: "sm", contents: footer } : void 0
    } }];
  }
  const buildOptionBubble = /* @__PURE__ */ __name((label, opts, isHeadcount) => {
    const buttons = (opts || []).slice(0, isHeadcount ? 13 : 10).map((opt) => {
      const value = isHeadcount ? String(opt).replace(/\D/g, "") : opt;
      return { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: String(opt).substring(0, 20), data: `action=evt:answer&value=${encodeURIComponent(value)}` } };
    });
    if (q.allowOther && !isHeadcount) buttons.push({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "\u5176\u4ED6", data: "action=evt:answer&value=__OTHER__" } });
    if (!q.required) buttons.push({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "\u7565\u904E\u6B64\u984C", data: "action=evt:skip" } });
    return [{ type: "flex", altText: label, contents: {
      type: "bubble",
      header: buildEvtQuestionHeader(isHeadcount ? "\u5831\u540D\u4EBA\u6578" : "\u8ACB\u9078\u64C7\u7B54\u6848", progress),
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: label, weight: "bold", size: "md", wrap: true },
        { type: "text", text: isHeadcount ? "\u7CFB\u7D71\u6703\u4F9D\u6B64\u8A08\u7B97\u5269\u9918\u540D\u984D\u3002" : "\u8ACB\u9EDE\u9078\u4E0B\u65B9\u9078\u9805\u3002", size: "xs", color: "#888888", wrap: true }
      ] },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons }
    } }];
  }, "buildOptionBubble");
  if (q.type === "number") {
    const contents = [
      { type: "text", text: q.label, weight: "bold", size: "md", wrap: true },
      { type: "text", text: "\u8ACB\u76F4\u63A5\u5728\u804A\u5929\u5BA4\u8F38\u5165\u6578\u5B57\u5F8C\u9001\u51FA\u3002", size: "sm", color: "#666666", wrap: true, margin: "md" },
      q.required ? null : { type: "text", text: "\u6B64\u984C\u975E\u5FC5\u586B\uFF0C\u4E5F\u53EF\u4EE5\u7565\u904E\u3002", size: "xs", color: "#999999", wrap: true, margin: "sm" }
    ].filter(Boolean);
    const footer = q.required ? [] : [{ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "\u7565\u904E\u6B64\u984C", data: "action=evt:skip" } }];
    return [{ type: "flex", altText: q.label, contents: {
      type: "bubble",
      header: buildEvtQuestionHeader("\u8ACB\u56DE\u7B54\u554F\u984C", progress),
      body: { type: "box", layout: "vertical", spacing: "sm", contents },
      footer: footer.length ? { type: "box", layout: "vertical", spacing: "sm", contents: footer } : void 0
    } }];
  }
  if (q.type === "single") return buildOptionBubble(q.label, q.options, false);
  if (q.type === "scale") return buildOptionBubble(q.label, ["1", "2", "3", "4", "5"], false);
  if (q.type === "headcount") {
    const maxN = Math.min(Math.max(parseInt((q.options || [])[0]) || 10, 1), 13);
    return buildOptionBubble(q.label, Array.from({ length: maxN }, (_, i) => `${i + 1} \u4EBA`), true);
  }
  if (q.type === "multi") {
    const buttons = (q.options || []).slice(0, 10).map((opt) => ({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: String(opt).substring(0, 18), data: `action=evt:answer&value=${encodeURIComponent(opt)}` } }));
    if (q.allowOther) buttons.push({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "\u5176\u4ED6", data: "action=evt:answer&value=__OTHER__" } });
    buttons.push({ type: "button", style: "primary", color: "#1a73e8", height: "sm", action: { type: "postback", label: "\u9078\u597D\u4E86\uFF0C\u4E0B\u4E00\u984C", data: "action=evt:multi_done" } });
    if (!q.required) buttons.push({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "\u7565\u904E\u6B64\u984C", data: "action=evt:skip" } });
    return [{ type: "flex", altText: q.label, contents: {
      type: "bubble",
      header: buildEvtQuestionHeader("\u53EF\u8907\u9078", progress),
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: q.label, weight: "bold", size: "md", wrap: true },
        { type: "text", text: "\u53EF\u8907\u9078\uFF0C\u9EDE\u9078\u5F8C\u6703\u6A19\u8A18\u70BA\u5DF2\u9078\u3002", size: "xs", color: "#888888", wrap: true }
      ] },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons }
    } }];
  }
  return [];
}
__name(buildEvtQuestionMsgs, "buildEvtQuestionMsgs");
function buildEvtReminderOptInBubble(state) {
  const timeText = fmtReminderTime(state.reminderTime);
  return {
    type: "flex",
    altText: "\u{1F514} \u6D3B\u52D5\u63D0\u9192\u8A2D\u5B9A",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "\u{1F514} \u6D3B\u52D5\u63D0\u9192", weight: "bold", size: "lg", color: "#1f2937" },
          { type: "separator", margin: "md" },
          { type: "text", text: `\u6B64\u6D3B\u52D5\u9810\u8A08\u65BC ${timeText} \u767C\u9001 LINE \u63D0\u9192\u3002`, size: "sm", wrap: true, color: "#4b5563", margin: "md" },
          { type: "text", text: "\u8ACB\u554F\u60A8\u662F\u5426\u60F3\u5728\u6D3B\u52D5\u524D\u6536\u5230\u63D0\u9192\u901A\u77E5\uFF1F", size: "sm", wrap: true, color: "#4b5563", margin: "sm" }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          { type: "button", style: "secondary", height: "sm", flex: 1, action: { type: "postback", label: "\u4E0D\u7528\u4E86", data: "action=evt:remind_no" } },
          { type: "button", style: "primary", height: "sm", flex: 2, color: "#1a73e8", action: { type: "postback", label: "\u597D\uFF0C\u63D0\u9192\u6211", data: "action=evt:remind_yes" } }
        ]
      }
    }
  };
}
__name(buildEvtReminderOptInBubble, "buildEvtReminderOptInBubble");
function buildEvtReminderBubble(event) {
  const timeText = fmtEventDateRange(text(event.eventStart), text(event.eventEnd));
  const loc = text(event.eventLocation);
  const bodyContents = [
    { type: "text", text: text(event.eventName), weight: "bold", size: "lg", color: "#1f2937", wrap: true },
    { type: "separator", margin: "md" }
  ];
  if (timeText) bodyContents.push({
    type: "box",
    layout: "horizontal",
    margin: "md",
    contents: [
      { type: "text", text: "\u{1F4C5}", size: "sm", flex: 0 },
      { type: "text", text: timeText, size: "sm", flex: 1, wrap: true, margin: "sm", color: "#4b5563" }
    ]
  });
  if (loc) bodyContents.push({
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: "\u{1F4CD}", size: "sm", flex: 0 },
      { type: "text", text: loc, size: "sm", flex: 1, wrap: true, margin: "sm", color: "#4b5563" }
    ]
  });
  bodyContents.push({ type: "separator", margin: "md" });
  bodyContents.push({ type: "text", text: "\u660E\u5929\u898B\u5537\uFF01\u5982\u6709\u554F\u984C\u8ACB\u806F\u7E6B\u6211\u5011\u3002", size: "xs", color: "#6b7280", wrap: true, margin: "md" });
  return {
    type: "flex",
    altText: "\u{1F514} \u6D3B\u52D5\u63D0\u9192\uFF1A" + text(event.eventName),
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1a73e8",
        paddingAll: "16px",
        contents: [{ type: "text", text: "\u{1F514} \u6D3B\u52D5\u63D0\u9192", color: "#ffffff", weight: "bold", size: "md" }]
      },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents }
    }
  };
}
__name(buildEvtReminderBubble, "buildEvtReminderBubble");
function buildEvtReminderMessages(event) {
  const messages = [];
  const imageUrl = text(event.imageUrl);
  if (/^https:\/\//i.test(imageUrl)) {
    messages.push({
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl
    });
  }
  messages.push(buildEvtReminderBubble(event));
  return messages;
}
__name(buildEvtReminderMessages, "buildEvtReminderMessages");
function buildEvtSummaryBubble(state) {
  const answers = state.answers || [];
  const contents = [
    { type: "text", text: "\u{1F4CB} \u5831\u540D\u8CC7\u6599\u78BA\u8A8D", weight: "bold", size: "lg" },
    { type: "text", text: "\u6D3B\u52D5\uFF1A" + (state.eventName || ""), size: "sm", color: "#1a73e8", wrap: true },
    { type: "separator", margin: "md" },
    ...answers.map((a) => {
      const val = Array.isArray(a.value) ? a.value.join("\u3001") : a.value;
      return { type: "text", text: a.label + "\uFF1A" + val, size: "sm", wrap: true, margin: "sm" };
    }),
    ...!answers.length ? [{ type: "text", text: "\uFF08\u6B64\u6D3B\u52D5\u7121\u9700\u586B\u5BEB\u554F\u984C\uFF09", size: "sm", color: "#999999" }] : [],
    { type: "separator", margin: "md" },
    { type: "text", text: "\u8CC7\u6599\u78BA\u8A8D\u7121\u8AA4\u5F8C\u8ACB\u9EDE\u300C\u78BA\u8A8D\u9001\u51FA\u300D\u3002\u9EDE\u4E00\u6B21\u5373\u53EF\uFF0C\u8ACB\u7A0D\u5019\u7CFB\u7D71\u56DE\u8986\u3002", size: "xs", color: "#999999", wrap: true, margin: "sm" }
  ];
  return {
    type: "flex",
    altText: "\u{1F4CB} \u5831\u540D\u78BA\u8A8D",
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", spacing: "sm", contents },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
        { type: "button", style: "secondary", height: "sm", flex: 1, action: { type: "postback", label: "\u4FEE\u6539", data: "action=evt:edit" } },
        { type: "button", style: "primary", height: "sm", flex: 2, color: "#1a73e8", action: { type: "postback", label: "\u78BA\u8A8D\u9001\u51FA", data: "action=evt:submit" } }
      ] }
    }
  };
}
__name(buildEvtSummaryBubble, "buildEvtSummaryBubble");
function buildEvtSuccessBubble(state) {
  const isWalkIn = !!state.walkIn;
  let reminderLine = "";
  const hasReminder = state.reminderTime && state.reminderTime !== "none";
  if (hasReminder && !isWalkIn) {
    const timeText = fmtReminderTime(state.reminderTime);
    reminderLine = state.wantsReminder === true ? `\u{1F514} \u5DF2\u8A2D\u5B9A\u63D0\u9192\uFF0C\u5C07\u65BC ${timeText} \u50B3\u9001 LINE \u901A\u77E5\u3002` : "\u60A8\u9078\u64C7\u4E0D\u63A5\u6536 LINE \u63D0\u9192\u3002";
  }
  const bodyContents = [
    { type: "text", text: state.eventName || "\u6D3B\u52D5\u5831\u540D", weight: "bold", size: "lg", color: "#1f2937", wrap: true },
    { type: "separator", margin: "md" },
    { type: "text", text: isWalkIn ? "\u5831\u540D\u5B8C\u6210\uFF0C\u60A8\u5DF2\u81EA\u52D5\u5B8C\u6210\u7C3D\u5230\uFF01" : "\u611F\u8B1D\u60A8\u5831\u540D\u53C3\u52A0\u6B64\u6D3B\u52D5\uFF01", size: "sm", color: "#4b5563", wrap: true, margin: "md" },
    ...reminderLine ? [{ type: "text", text: reminderLine, size: "sm", color: "#4b5563", wrap: true }] : [],
    { type: "text", text: "\u5982\u9700\u4FEE\u6539\u5831\u540D\u5167\u5BB9\uFF0C\u8ACB\u76F4\u63A5\u548C\u6211\u5011\u8AAA\u5373\u53EF\u3002", size: "sm", color: "#4b5563", wrap: true },
    { type: "text", text: "\u{1F4CC} \u6211\u5011\u5DF2\u70BA\u60A8\u4FDD\u7559\u5831\u540D\u8CC7\u6599", size: "xs", color: "#6b7280", wrap: true, margin: "md" },
    { type: "separator", margin: "md" },
    { type: "text", text: isWalkIn ? "\u82E5\u8981\u5E6B\u5176\u4ED6\u4EBA\u5831\u540D\uFF0C\u8ACB\u518D\u6B21\u8F38\u5165\u5831\u540D\u78BC\uFF0C\u6BCF\u4EBA\u586B\u4E00\u4EFD\u5373\u53EF\u3002" : "\u82E5\u8981\u5E6B\u5BB6\u4EBA\u6216\u670B\u53CB\u5831\u540D\uFF0C\u8ACB\u518D\u6B21\u8F38\u5165\u300C\u6211\u8981\u5831\u540D\u300D\u91CD\u8907\u64CD\u4F5C\uFF0C\u6BCF\u4EBA\u586B\u4E00\u4EFD\u5373\u53EF\u3002", size: "xs", color: "#6b7280", wrap: true, margin: "md" }
  ];
  return {
    type: "flex",
    altText: isWalkIn ? "\u5831\u540D\u4E26\u7C3D\u5230\u5B8C\u6210" : "\u5831\u540D\u6210\u529F",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: isWalkIn ? "#1565c0" : "#2f6836", paddingAll: "16px", contents: [{ type: "text", text: isWalkIn ? "\u2705 \u5831\u540D\u4E26\u7C3D\u5230\u5B8C\u6210" : "\u2705 \u5831\u540D\u6210\u529F", color: "#ffffff", weight: "bold", size: "md" }] },
      body: { type: "box", layout: "vertical", spacing: "md", contents: bodyContents }
    }
  };
}
__name(buildEvtSuccessBubble, "buildEvtSuccessBubble");
function buildSurveyInviteBubble(eventName, survey, surveyUrl) {
  const surveyName = text(survey.surveyName);
  const title = text(survey.introTitle) || surveyName || "\u6D3B\u52D5\u610F\u898B\u8ABF\u67E5";
  const desc = text(survey.introDescription) || "\u60A8\u7684\u610F\u898B\u5C07\u5E6B\u52A9\u6211\u5011\u898F\u5283\u66F4\u597D\u7684\u6D3B\u52D5\u3002";
  return {
    type: "flex",
    altText: "\u{1F4DD} \u6D3B\u52D5\u5F8C\u554F\u5238\uFF1A" + surveyName,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#6d42c7",
        paddingAll: "16px",
        contents: [{ type: "text", text: title, color: "#ffffff", weight: "bold", size: "md", wrap: true }]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: String(eventName), weight: "bold", size: "lg", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: desc, size: "sm", color: "#555555", wrap: true, margin: "md" },
          { type: "text", text: "\u6309\u4E0B\u65B9\u6309\u9215\u5F8C\u5728\u700F\u89BD\u5668\u9801\u9762\u586B\u5BEB\u554F\u5238\u3002", size: "xs", color: "#888888", wrap: true }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "button", style: "primary", color: "#1a73e8", height: "sm", action: { type: "uri", label: "\u958B\u59CB\u586B\u5BEB", uri: surveyUrl } }]
      }
    }
  };
}
__name(buildSurveyInviteBubble, "buildSurveyInviteBubble");
function buildRptTypeFlex() {
  return {
    type: "flex",
    altText: "\u8ACB\u9078\u64C7\u901A\u5831\u985E\u5225",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#27AE60",
        paddingAll: "14px",
        contents: [
          { type: "text", text: "\u{1F4DD} \u91CC\u6C11\u901A\u5831", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: "\u8ACB\u9078\u64C7\u901A\u5831\u985E\u5225", color: "#d4f5d4", size: "sm", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "14px",
        contents: RPT_TYPES.map((t) => ({
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "postback", label: t, data: `rpt:type:${t}` }
        }))
      }
    }
  };
}
__name(buildRptTypeFlex, "buildRptTypeFlex");
function buildRptMorePhotoMsg(count) {
  const msg = count === 1 ? "\u{1F4F8} \u6536\u5230\u7B2C 1 \u5F35\u7167\u7247\uFF01\n\n\u8981\u518D\u9644\u4E00\u5F35\u55CE\uFF1F" : `\u{1F4F8} \u5DF2\u6536\u5230\u7B2C ${count} \u5F35\u7167\u7247\uFF01

\u8981\u518D\u9644\u4E00\u5F35\u55CE\uFF1F`;
  return {
    type: "text",
    text: msg,
    quickReply: {
      items: [
        { type: "action", action: { type: "camera", label: "\u518D\u62CD\u4E00\u5F35" } },
        { type: "action", action: { type: "cameraRoll", label: "\u5F9E\u76F8\u7C3F\u9078" } },
        { type: "action", action: { type: "postback", label: "\u7565\u904E\uFF0C\u78BA\u8A8D\u9001\u51FA", data: "rpt:no_more_photo" } }
      ]
    }
  };
}
__name(buildRptMorePhotoMsg, "buildRptMorePhotoMsg");
function buildMapButton(lat, lng) {
  return {
    type: "button",
    style: "link",
    height: "sm",
    action: {
      type: "uri",
      label: "\u{1F4CD} \u5728 Google \u5730\u5716\u4E0A\u67E5\u770B",
      uri: `https://www.google.com/maps?q=${lat},${lng}`
    }
  };
}
__name(buildMapButton, "buildMapButton");
function buildRptConfirmBubble(state) {
  const locStr = state.address || (state.latitude != null ? `${state.latitude.toFixed(5)}, ${state.longitude.toFixed(5)}` : "\u672A\u63D0\u4F9B");
  const photoText = state.hasPhoto ? state.photoCount > 1 ? `\u2705 ${state.photoCount} \u5F35` : "\u2705 1 \u5F35" : "\u2014 \u672A\u9644";
  const bodyContents = [
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "\u985E\u5225", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: state.type || "\u2014", size: "sm", flex: 5, wrap: true, weight: "bold" }
    ] },
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "\u4F4D\u7F6E", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: locStr, size: "sm", flex: 5, wrap: true }
    ] }
  ];
  if (state.latitude != null) bodyContents.push(buildMapButton(state.latitude, state.longitude));
  bodyContents.push(
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "\u8AAA\u660E", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: state.description || "\u2014", size: "sm", flex: 5, wrap: true }
    ] },
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "\u7167\u7247", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: photoText, size: "sm", flex: 5 }
    ] },
    { type: "separator" },
    { type: "text", text: "\u5167\u5BB9\u6B63\u78BA\u55CE\uFF1F", size: "sm", color: "#555555", margin: "sm" }
  );
  return {
    type: "flex",
    altText: "\u78BA\u8A8D\u901A\u5831\u5167\u5BB9",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#2980B9",
        paddingAll: "14px",
        contents: [{ type: "text", text: "\u{1F4CB} \u78BA\u8A8D\u901A\u5831\u5167\u5BB9", color: "#FFFFFF", weight: "bold", size: "md" }]
      },
      body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "14px", contents: bodyContents },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "secondary",
            height: "sm",
            flex: 1,
            action: { type: "postback", label: "\u53D6\u6D88", data: "rpt:cancel" }
          },
          {
            type: "button",
            style: "primary",
            height: "sm",
            flex: 2,
            color: "#27AE60",
            action: { type: "postback", label: "\u78BA\u8A8D\u9001\u51FA", data: "rpt:submit" }
          }
        ]
      }
    }
  };
}
__name(buildRptConfirmBubble, "buildRptConfirmBubble");
function buildRptThankYouBubble(state) {
  const locStr = state.address || (state.latitude != null ? `${state.latitude.toFixed(5)}, ${state.longitude.toFixed(5)}` : "\u672A\u63D0\u4F9B");
  const photoText = state.hasPhoto ? state.photoCount > 1 ? `\u2705 ${state.photoCount} \u5F35` : "\u2705 1 \u5F35" : "\u2014 \u672A\u9644";
  const bodyContents = [
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "\u985E\u5225", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: state.type || "\u2014", size: "sm", flex: 5, wrap: true, weight: "bold" }
    ] },
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "\u4F4D\u7F6E", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: locStr, size: "sm", flex: 5, wrap: true }
    ] }
  ];
  if (state.latitude != null) bodyContents.push(buildMapButton(state.latitude, state.longitude));
  bodyContents.push(
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "\u8AAA\u660E", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: state.description || "\u2014", size: "sm", flex: 5, wrap: true }
    ] },
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "\u7167\u7247", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: photoText, size: "sm", flex: 5 }
    ] }
  );
  return {
    type: "flex",
    altText: "\u2705 \u901A\u5831\u5DF2\u9001\u51FA",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#27AE60",
        paddingAll: "14px",
        contents: [
          { type: "text", text: "\u2705 \u901A\u5831\u5DF2\u9001\u51FA", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: "\u611F\u8B1D\u60A8\u7684\u901A\u5831\uFF0C\u6211\u5011\u5C07\u76E1\u5FEB\u8655\u7406\uFF01", color: "#d4f5d4", size: "sm", margin: "xs", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "14px",
        contents: bodyContents
      }
    }
  };
}
__name(buildRptThankYouBubble, "buildRptThankYouBubble");

// src/scheduled.js
var SURVEY_GRACE_DAYS = 14;
async function closeEndedEvents(env) {
  const now = taiwanIsoNow();
  const endedAt = (/* @__PURE__ */ new Date()).toISOString();
  const result = await env.DB.prepare(
    `UPDATE events
        SET status = '\u5DF2\u7D50\u675F',
            updated_at = ?,
            payload_json = json_set(payload_json,
              '$.status', '\u5DF2\u7D50\u675F',
              '$.updatedAt', ?)
      WHERE status NOT IN ('\u5DF2\u7D50\u675F', '\u5DF2\u53D6\u6D88')
        AND event_end != ''
        AND event_end <= ?`
  ).bind(endedAt, endedAt, now).run();
  if (result.meta?.changes) {
    console.log(JSON.stringify({ fn: "closeEndedEvents", closed: result.meta.changes }));
  }
}
__name(closeEndedEvents, "closeEndedEvents");
async function sendEventReminders(env) {
  const nowMs = Date.now();
  const now = taiwanIsoNow();
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM events
     WHERE status NOT IN ('\u5DF2\u7D50\u675F', '\u5DF2\u53D6\u6D88')
       AND event_end != ''
       AND event_end >= ?
       AND json_extract(payload_json, '$.reminderTime') IS NOT NULL
       AND json_extract(payload_json, '$.reminderTime') != ''
       AND json_extract(payload_json, '$.reminderTime') != 'none'`
  ).bind(now).all();
  for (const row of rows.results) {
    const event = parseJson(row.payload_json);
    const eventId = text(event.eventId);
    if (!eventId) continue;
    const reminderTime = text(event.reminderTime);
    if (!reminderTime || reminderTime === "none") continue;
    const reminderMs = parseTaiwanIsoToMs(reminderTime);
    if (isNaN(reminderMs)) continue;
    if (reminderMs > nowMs) continue;
    const eventEndMs = parseTaiwanIsoToMs(text(event.eventEnd));
    if (!isNaN(eventEndMs) && eventEndMs < nowMs) continue;
    const sentIds = new Set(
      Array.isArray(event.reminderSentLineIds) ? event.reminderSentLineIds : []
    );
    const regRows = await env.DB.prepare(
      `SELECT line_user_id FROM event_registrations
       WHERE event_id = ? AND line_user_id != ''
         AND json_extract(payload_json, '$.lineReminderOptIn') = 'TRUE'`
    ).bind(eventId).all();
    const allIds = [...new Set(regRows.results.map((r) => r.line_user_id).filter(Boolean))];
    const newIds = allIds.filter((id) => !sentIds.has(id));
    if (!newIds.length) continue;
    const updatedSentIds = [...sentIds, ...newIds];
    await env.DB.prepare(
      `UPDATE events SET payload_json =
        json_set(json_set(payload_json, '$.reminderSentLineIds', json(?)), '$.reminderSentAt', ?)
       WHERE event_id = ?`
    ).bind(JSON.stringify(updatedSentIds), (/* @__PURE__ */ new Date()).toISOString(), eventId).run();
    const reminderMessages = buildEvtReminderMessages(event);
    for (let k = 0; k < newIds.length; k += 500) {
      await lineMulticast(env, newIds.slice(k, k + 500), reminderMessages);
    }
    console.log(JSON.stringify({ fn: "sendEventReminders", event: event.eventName, recipients: newIds.length }));
  }
}
__name(sendEventReminders, "sendEventReminders");
async function resetReminderSent(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  await env.DB.prepare(
    `UPDATE events SET payload_json =
      json_set(json_set(payload_json, '$.reminderSentAt', ''), '$.reminderSentLineIds', json('[]'))
     WHERE event_id = ?`
  ).bind(eventId).run();
  return { success: true };
}
__name(resetReminderSent, "resetReminderSent");
async function resetSurveySentAt(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  await env.DB.prepare(
    `UPDATE events SET payload_json = json_set(payload_json, '$.surveySentAt', '') WHERE event_id = ?`
  ).bind(eventId).run();
  return { success: true };
}
__name(resetSurveySentAt, "resetSurveySentAt");
async function sendPostEventSurveys(env) {
  const nowMs = Date.now();
  const graceMs = SURVEY_GRACE_DAYS * 24 * 60 * 60 * 1e3;
  const now = taiwanIsoNow();
  const oldest = taiwanIsoMinutesAgo(SURVEY_GRACE_DAYS * 24 * 60);
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM events
     WHERE survey_id != ''
       AND survey_id IS NOT NULL
       AND event_end != ''
       AND event_end <= ?
       AND event_end >= ?
       AND (
         json_extract(payload_json, '$.surveySentAt') IS NULL
         OR json_extract(payload_json, '$.surveySentAt') = ''
       )`
  ).bind(now, oldest).all();
  for (const row of rows.results) {
    const event = parseJson(row.payload_json);
    const eventId = text(event.eventId);
    if (!eventId) continue;
    const surveyId = text(event.surveyId);
    if (!surveyId) continue;
    if (text(event.surveySentAt)) continue;
    const eventEndMs = parseTaiwanIsoToMs(text(event.eventEnd));
    if (isNaN(eventEndMs)) {
      console.warn(JSON.stringify({ fn: "sendPostEventSurveys", skip: "no eventEnd", eventId }));
      continue;
    }
    const delayMs = parseSurveyDelayMinutes(text(event.surveyDelay)) * 60 * 1e3;
    const sendAtMs = eventEndMs + delayMs;
    if (sendAtMs > nowMs) continue;
    if (sendAtMs < nowMs - graceMs) {
      console.log(JSON.stringify({ fn: "sendPostEventSurveys", skip: "overdue", eventId }));
      continue;
    }
    const surveyRow = await env.DB.prepare(
      "SELECT payload_json FROM surveys WHERE survey_id = ?"
    ).bind(surveyId).first();
    if (!surveyRow) continue;
    const survey = parseJson(surveyRow.payload_json);
    const surveyTarget = text(event.surveyTarget) || "\u5168\u90E8\u5831\u540D";
    let regQuery;
    if (surveyTarget === "\u5DF2\u7C3D\u5230") {
      regQuery = await env.DB.prepare(
        "SELECT line_user_id FROM event_registrations WHERE event_id = ? AND checked_in = 'TRUE' AND line_user_id != ''"
      ).bind(eventId).all();
    } else {
      regQuery = await env.DB.prepare(
        "SELECT line_user_id FROM event_registrations WHERE event_id = ? AND line_user_id != ''"
      ).bind(eventId).all();
    }
    const userIds = [...new Set(regQuery.results.map((r) => r.line_user_id).filter(Boolean))];
    if (!userIds.length) continue;
    const sentAt = (/* @__PURE__ */ new Date()).toISOString();
    for (const uid of userIds) {
      const surveyUrl = SURVEY_BASE_URL + "?eventId=" + encodeURIComponent(eventId) + "&surveyId=" + encodeURIComponent(surveyId) + "&lineUserId=" + encodeURIComponent(uid);
      await lineMulticast(env, [uid], [buildSurveyInviteBubble(text(event.eventName), survey, surveyUrl)]);
    }
    await env.DB.prepare(
      "UPDATE events SET payload_json = json_set(payload_json, '$.surveySentAt', ?) WHERE event_id = ?"
    ).bind(sentAt, eventId).run();
    console.log(JSON.stringify({ fn: "sendPostEventSurveys", survey: survey.surveyName, event: event.eventName, recipients: userIds.length }));
  }
}
__name(sendPostEventSurveys, "sendPostEventSurveys");
function parseSurveyDelayMinutes(value) {
  if (value === 0 || value === "0") return 0;
  if (!value) return 60;
  const m = parseInt(value, 10);
  if (isNaN(m) || m < 0) return 60;
  return m;
}
__name(parseSurveyDelayMinutes, "parseSurveyDelayMinutes");

// src/events.js
async function reorderEvents(env, data) {
  const orders = Array.isArray(data.orders) ? data.orders : [];
  if (!orders.length) return { success: true };
  const statements = orders.map(
    ({ eventId, sortOrder }) => env.DB.prepare(
      `UPDATE events
       SET sort_order = ?,
           payload_json = json_set(payload_json, '$.sortOrder', ?)
       WHERE event_id = ?`
    ).bind(Number(sortOrder ?? 0), Number(sortOrder ?? 0), text(eventId))
  );
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true };
}
__name(reorderEvents, "reorderEvents");
async function getEvents(env) {
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM events
     ORDER BY CASE WHEN sort_order > 0 THEN sort_order ELSE 999999 END ASC,
              updated_at DESC, event_id DESC`
  ).all();
  return { success: true, events: rows.results.map((row) => parseJson(row.payload_json)) };
}
__name(getEvents, "getEvents");
async function getEvent(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first();
  if (!row) return { success: false, error: "\u627E\u4E0D\u5230\u6D3B\u52D5" };
  return { success: true, event: parseJson(row.payload_json) };
}
__name(getEvent, "getEvent");
async function createEvent(env, data) {
  if (!text(data.eventName)) throw httpError(400, "Missing eventName");
  await normalizeCheckinLocationFields(data);
  const gasResult = await forwardToGas(env, data);
  const eventId = requireId(gasResult.eventId || data.eventId, "Missing eventId");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const event = normalizeEvent({
    ...eventUpdatePayload(data),
    eventId,
    registeredCount: 0,
    registrationSheet: `REG_${eventId}`,
    createdAt: now,
    updatedAt: now,
    createdBy: data.createdBy || "",
    surveySentAt: ""
  });
  await upsertEventStatement(env, event).run();
  return { success: true, eventId, event };
}
__name(createEvent, "createEvent");
async function updateEvent(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  await normalizeCheckinLocationFields(data);
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first();
  if (!row) {
    return forwardToGas(env, data);
  }
  const existing = parseJson(row.payload_json);
  const event = {
    ...existing,
    ...eventUpdatePayload(data),
    eventId,
    registeredCount: Number(existing.registeredCount || 0),
    registrationSheet: text(existing.registrationSheet),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (shouldResetReminderSent(event, existing)) {
    event.reminderSentAt = "";
    event.reminderSentLineIds = [];
  }
  if (shouldResetSurveySent(event, existing)) {
    event.surveySentAt = "";
  }
  await upsertEventStatement(env, normalizeEvent(event)).run();
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "updateEvent",
      eventId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true, event };
}
__name(updateEvent, "updateEvent");
async function updateEventStatus(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const status = requireId(data.status, "Missing status");
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first();
  if (!row) {
    return forwardToGas(env, data);
  }
  const existing = parseJson(row.payload_json);
  const event = {
    ...existing,
    eventId,
    status,
    registeredCount: Number(existing.registeredCount || 0),
    registrationSheet: text(existing.registrationSheet),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await upsertEventStatement(env, normalizeEvent(event)).run();
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "updateEventStatus",
      eventId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true, event };
}
__name(updateEventStatus, "updateEventStatus");
async function deleteEvent(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first();
  if (!row) {
    return forwardToGas(env, data);
  }
  const regCount = await countRegistrations(env, eventId);
  if (regCount > 0 && !parseBoolean(data.force)) {
    return {
      success: false,
      error: "Event has registrations; pass force:true to delete",
      hasRegistrations: true,
      count: regCount
    };
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM event_registrations WHERE event_id = ?").bind(eventId),
    env.DB.prepare("DELETE FROM events WHERE event_id = ?").bind(eventId)
  ]);
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "deleteEvent",
      eventId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true };
}
__name(deleteEvent, "deleteEvent");
async function normalizeCheckinLocationFields(data) {
  const required = parseBoolean(data.checkinLocationRequired);
  data.checkinLocationRequired = required;
  data.checkinRadiusMeters = CHECKIN_RADIUS_METERS;
  if (!required) {
    data.checkinLatitude = "";
    data.checkinLongitude = "";
    return;
  }
  let lat = parseOptionalNumber(data.checkinLatitude);
  let lng = parseOptionalNumber(data.checkinLongitude);
  if (!isValidLatLng(lat, lng)) {
    const parsed = await resolveMapUrlLatLng(text(data.mapUrl));
    if (parsed) {
      lat = parsed.lat;
      lng = parsed.lng;
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw httpError(400, "Google Map \u9023\u7D50\u7121\u6CD5\u89E3\u6790\u5EA7\u6A19\uFF0C\u8ACB\u6539\u8CBC\u5B8C\u6574 Google Maps \u9023\u7D50\u6216\u624B\u52D5\u586B\u5BEB\u7C3D\u5230\u4E2D\u5FC3\u5EA7\u6A19");
  }
  data.checkinLatitude = lat;
  data.checkinLongitude = lng;
}
__name(normalizeCheckinLocationFields, "normalizeCheckinLocationFields");
function shouldResetSurveySent(event, existing) {
  const keys = ["surveyId", "surveyTarget", "surveyDelay", "eventEnd"];
  return keys.some((key) => text(event[key]) !== text(existing[key]));
}
__name(shouldResetSurveySent, "shouldResetSurveySent");
function shouldResetReminderSent(event, existing) {
  const keys = ["reminderTime", "eventStart", "eventEnd"];
  return keys.some((key) => text(event[key]) !== text(existing[key]));
}
__name(shouldResetReminderSent, "shouldResetReminderSent");
function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
__name(isValidLatLng, "isValidLatLng");
function parseOptionalNumber(value) {
  const raw = text(value);
  if (!raw) return NaN;
  return Number(raw);
}
__name(parseOptionalNumber, "parseOptionalNumber");
async function resolveMapUrlLatLng(mapUrl) {
  if (!mapUrl) return null;
  const direct = parseLatLngFromText(mapUrl);
  if (direct) return direct;
  if (!/^https?:\/\//i.test(mapUrl)) return null;
  let nextUrl = mapUrl;
  try {
    for (let i = 0; i < 5 && nextUrl; i++) {
      const resp = await fetch(nextUrl, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 hpnbhs-events-api" }
      });
      const fromUrl = parseLatLngFromText(resp.url || nextUrl);
      if (fromUrl) return fromUrl;
      const location = resp.headers.get("location") || resp.headers.get("Location") || "";
      const fromLocation = parseLatLngFromText(location);
      if (fromLocation) return fromLocation;
      if (location) {
        nextUrl = new URL(location, nextUrl).toString();
        continue;
      }
      const body = await resp.text().catch(() => "");
      const fromBody = parseLatLngFromText(body);
      if (fromBody) return fromBody;
      break;
    }
    return null;
  } catch (error) {
    console.error(JSON.stringify({ fn: "resolveMapUrlLatLng", error: error.message }));
    return null;
  }
}
__name(resolveMapUrlLatLng, "resolveMapUrlLatLng");
function parseLatLngFromText(value) {
  if (!value) return null;
  const candidates = [String(value)];
  try {
    candidates.push(decodeURIComponent(candidates[0]));
  } catch {
  }
  try {
    candidates.push(decodeURIComponent(candidates[1] || candidates[0]));
  } catch {
  }
  for (const raw of candidates) {
    const patterns = [
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /%403d(-?\d+(?:\.\d+)?)%2C4d(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (!match) continue;
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (isValidLatLng(lat, lng)) return { lat, lng };
    }
  }
  return null;
}
__name(parseLatLngFromText, "parseLatLngFromText");

// src/registrations.js
async function getRegistrations(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const [eventRow, { registrations, totalHeadcount }] = await Promise.all([
    env.DB.prepare("SELECT json_extract(payload_json,'$.registrationSheet') AS rs FROM events WHERE event_id = ?").bind(eventId).first(),
    getRegistrationRows(env, eventId)
  ]);
  return {
    success: true,
    registrations,
    totalHeadcount,
    registrationSheet: text(eventRow?.rs)
  };
}
__name(getRegistrations, "getRegistrations");
async function getRegistrationRows(env, eventId) {
  const rows = await env.DB.prepare(
    `SELECT r.payload_json, rn.note AS rn_note
     FROM event_registrations r
     LEFT JOIN resident_notes rn ON r.line_user_id = rn.line_user_id
     WHERE r.event_id = ?
     ORDER BY
       CASE WHEN r.display_name = '' OR r.display_name IS NULL THEN 1 ELSE 0 END ASC,
       r.display_name ASC,
       r.submitted_at ASC`
  ).bind(eventId).all();
  const registrations = rows.results.map((row) => {
    const reg = parseJson(row.payload_json);
    reg.residentNote = row.rn_note ?? "";
    return reg;
  });
  const totalHeadcount = registrations.reduce((sum, reg) => sum + (Number(reg.headcount || 0) || 1), 0);
  return { registrations, totalHeadcount };
}
__name(getRegistrationRows, "getRegistrationRows");
async function getEventStats(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const eventRow = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first();
  if (!eventRow) return { success: false, error: "\u627E\u4E0D\u5230\u6D3B\u52D5" };
  const event = parseJson(eventRow.payload_json);
  const questions = Array.isArray(event.questions) ? event.questions : [];
  const { registrations, totalHeadcount } = await getRegistrationRows(env, eventId);
  const stats = {
    total: totalHeadcount,
    totalRegistrations: registrations.length,
    consentRate: 0,
    answers: {}
  };
  const consentCount = registrations.filter(
    (reg) => text(reg.consentGiven).toUpperCase() === "TRUE"
  ).length;
  stats.consentRate = registrations.length ? Math.round(consentCount / registrations.length * 100) : 0;
  for (const question of questions) {
    if (question.type === "text") continue;
    const label = text(question.label);
    if (!label) continue;
    const counts = {};
    for (const reg of registrations) {
      const value = text(reg[label]);
      if (!value) continue;
      for (const item of value.split("\u3001")) {
        const opt = text(item);
        if (opt) counts[opt] = (counts[opt] || 0) + 1;
      }
    }
    stats.answers[label] = counts;
  }
  return { success: true, stats };
}
__name(getEventStats, "getEventStats");
async function checkInRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const regId = requireId(data.regId, "Missing regId");
  const checkedIn = data.checkedIn !== void 0 ? parseBoolean(data.checkedIn) : true;
  const checkedText = checkedIn ? "TRUE" : "FALSE";
  const result = await env.DB.prepare(
    `UPDATE event_registrations
        SET checked_in = ?,
            payload_json = json_set(payload_json, '$.checkedIn', ?)
      WHERE event_id = ? AND reg_id = ?`
  ).bind(checkedText, checkedText, eventId, regId).run();
  if (!result.meta.changes) {
    const minimalReg = {
      regId,
      eventId,
      lineUserId: text(data.lineUserId),
      displayName: text(data.displayName),
      checkedIn: checkedText,
      submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
      headcount: 1
    };
    await upsertRegistrationStatement(env, eventId, minimalReg).run();
    ctx.waitUntil(forwardToGas(env, data).catch((error) => {
      console.error(JSON.stringify({ action: "checkInRegistration", regId, syncTarget: "gas", error: error.message }));
    }));
    return { success: true, checkedIn };
  }
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({ action: "checkInRegistration", syncTarget: "gas", error: error.message }));
  }));
  return { success: true, checkedIn };
}
__name(checkInRegistration, "checkInRegistration");
async function updateRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const regId = requireId(data.regId, "Missing regId");
  const updates = data.updates && typeof data.updates === "object" ? data.updates : null;
  if (!updates) throw httpError(400, "Missing updates");
  const row = await env.DB.prepare(
    "SELECT payload_json FROM event_registrations WHERE event_id = ? AND reg_id = ?"
  ).bind(eventId, regId).first();
  if (!row) {
    return forwardToGas(env, data);
  }
  const reg = parseJson(row.payload_json);
  for (const [key, value] of Object.entries(updates)) {
    if (isSystemRegistrationColumn(key)) continue;
    reg[key] = text(value);
  }
  reg.eventId = eventId;
  reg.regId = regId;
  await upsertRegistrationStatement(env, eventId, reg).run();
  const registeredCount = await syncEventRegisteredCount(env, eventId);
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "updateRegistration",
      eventId,
      regId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true, registeredCount, registration: reg };
}
__name(updateRegistration, "updateRegistration");
async function deleteRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const regId = requireId(data.regId, "Missing regId");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const [delResult] = await env.DB.batch([
    env.DB.prepare("DELETE FROM event_registrations WHERE event_id = ? AND reg_id = ?").bind(eventId, regId),
    env.DB.prepare(
      `UPDATE events
          SET registered_count = (SELECT COALESCE(SUM(headcount),0) FROM event_registrations WHERE event_id = ?),
              payload_json = json_set(payload_json,
                '$.registeredCount', (SELECT COALESCE(SUM(headcount),0) FROM event_registrations WHERE event_id = ?),
                '$.updatedAt', ?)
        WHERE event_id = ?`
    ).bind(eventId, eventId, now, eventId)
  ]);
  if (!delResult.meta.changes) {
    return forwardToGas(env, data);
  }
  const countRow = await env.DB.prepare(
    "SELECT registered_count FROM events WHERE event_id = ?"
  ).bind(eventId).first();
  const registeredCount = Number(countRow?.registered_count || 0);
  ctx.waitUntil(
    forwardToGas(env, data).catch((error) => {
      console.error(JSON.stringify({ action: "deleteRegistration", eventId, regId, syncTarget: "gas", error: error.message }));
    })
  );
  return { success: true, registeredCount };
}
__name(deleteRegistration, "deleteRegistration");

// src/survey.js
async function getSurveys(env) {
  const rows = await env.DB.prepare(
    "SELECT payload_json FROM surveys ORDER BY updated_at DESC, survey_id DESC"
  ).all();
  return { success: true, surveys: rows.results.map((row) => parseJson(row.payload_json)) };
}
__name(getSurveys, "getSurveys");
async function getSurvey(env, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  const row = await env.DB.prepare("SELECT payload_json FROM surveys WHERE survey_id = ?").bind(surveyId).first();
  if (!row) return { success: false, error: "\u627E\u4E0D\u5230\u554F\u5238" };
  return { success: true, survey: parseJson(row.payload_json) };
}
__name(getSurvey, "getSurvey");
async function createSurvey(env, ctx, data) {
  if (!text(data.surveyName)) throw httpError(400, "Missing surveyName");
  const surveyFileName = text(data.surveyFileName) || `survey${Date.now().toString().slice(-4)}.html`;
  const createData = { ...data, surveyFileName };
  const gasResult = await forwardToGas(env, createData);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const surveyId = text(gasResult.surveyId) || text(data.surveyId) || `SRV_${compactDate()}_${Date.now().toString().slice(-4)}`;
  const survey = normalizeSurvey({
    surveyId,
    surveyName: data.surveyName,
    surveyFileName,
    questions: data.questions || [],
    createdAt: now,
    updatedAt: now,
    createdBy: data.createdBy || "",
    introTitle: data.introTitle || data.surveyName || "",
    introDescription: data.introDescription || "",
    outroTitle: data.outroTitle || "\u554F\u5238\u5DF2\u5B8C\u6210",
    outroDescription: data.outroDescription || "\u611F\u8B1D\u60A8\u7684\u586B\u5BEB\u3002"
  });
  await upsertSurveyStatement(env, survey).run();
  return { success: true, surveyId, survey };
}
__name(createSurvey, "createSurvey");
async function updateSurvey(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  const row = await env.DB.prepare("SELECT payload_json FROM surveys WHERE survey_id = ?").bind(surveyId).first();
  if (!row) {
    return forwardToGas(env, data);
  }
  const existing = parseJson(row.payload_json);
  const survey = normalizeSurvey({
    ...existing,
    ...surveyUpdatePayload(data),
    surveyId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  await upsertSurveyStatement(env, survey).run();
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "updateSurvey",
      surveyId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true, survey };
}
__name(updateSurvey, "updateSurvey");
async function deleteSurvey(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  const row = await env.DB.prepare("SELECT survey_id FROM surveys WHERE survey_id = ?").bind(surveyId).first();
  if (!row) {
    return forwardToGas(env, data);
  }
  await env.DB.prepare("DELETE FROM surveys WHERE survey_id = ?").bind(surveyId).run();
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "deleteSurvey",
      surveyId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true };
}
__name(deleteSurvey, "deleteSurvey");
async function submitRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const lineUserId = text(data.lineUserId);
  if (!lineUserId) throw httpError(400, "Missing lineUserId");
  const event = await getEventPayload(env, eventId);
  if (!event) return forwardToGas(env, data);
  if (text(event.status) !== "\u5831\u540D\u4E2D")
    return { success: false, error: "\u6B64\u6D3B\u52D5\u5831\u540D\u5DF2\u622A\u6B62" };
  if (!isWithinRegWindow(event))
    return { success: false, error: "\u6B64\u6D3B\u52D5\u76EE\u524D\u4E0D\u5728\u958B\u653E\u5831\u540D\u671F\u9593" };
  const existingRow = await env.DB.prepare(
    "SELECT reg_id FROM event_registrations WHERE event_id=? AND line_user_id=? LIMIT 1"
  ).bind(eventId, lineUserId).first();
  const displayName = await resolveDisplayName(env, data);
  const now = /* @__PURE__ */ new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const regId = existingRow ? text(existingRow.reg_id) : `REG_${dateStr}_${crypto.randomUUID()}`;
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const answerMap = {};
  answers.forEach((a) => {
    answerMap[text(a.label)] = Array.isArray(a.value) ? a.value.join("\u3001") : text(a.value);
  });
  const reg = {
    regId,
    eventId,
    lineUserId,
    displayName,
    consentGiven: data.consentGiven !== false ? "TRUE" : "FALSE",
    submittedAt: now.toISOString(),
    headcount: "1",
    checkedIn: "FALSE",
    ...answerMap
  };
  const quotaNum = parseInt(text(event.quota), 10) || 0;
  if (existingRow || quotaNum <= 0) {
    await upsertRegistrationStatement(env, eventId, reg).run();
  } else {
    const result = await env.DB.prepare(
      `INSERT INTO event_registrations
         (event_id, reg_id, line_user_id, display_name, checked_in, submitted_at, headcount, payload_json)
       SELECT ?, ?, ?, ?, 'FALSE', ?, 1, ?
       WHERE (SELECT COALESCE(SUM(headcount), 0) FROM event_registrations WHERE event_id = ?) < ?`
    ).bind(
      eventId,
      regId,
      lineUserId,
      displayName,
      now.toISOString(),
      JSON.stringify({ ...reg, eventId }),
      eventId,
      quotaNum
    ).run();
    if (!result.meta.changes) {
      return { success: false, error: "\u6B64\u6D3B\u52D5\u5831\u540D\u5DF2\u984D\u6EFF" };
    }
  }
  await syncEventRegisteredCount(env, eventId);
  ctx.waitUntil(
    forwardToGas(env, data).catch((error) => {
      console.error(
        JSON.stringify({
          action: "submitRegistration",
          eventId,
          lineUserId,
          syncTarget: "gas",
          error: error.message
        })
      );
    })
  );
  return { success: true, regId, displayName };
}
__name(submitRegistration, "submitRegistration");
async function getSurveyPublic(env, data) {
  const survey = await findSurvey(env, data);
  if (!survey) {
    if (data.surveyId || data.surveyFileName) {
      const gasResult = await forwardToGasResult(env, data);
      if (gasResult.survey?.surveyId) {
        await upsertSurveyStatement(env, normalizeSurvey(gasResult.survey)).run();
      }
      return gasResult;
    }
    return { success: false, error: "Missing surveyId or surveyFileName" };
  }
  const eventId = text(data.eventId);
  const event = eventId ? await getEventPayload(env, eventId) : null;
  const displayName = text(data.lineUserId) ? await resolveDisplayName(env, data) : "";
  return {
    success: true,
    survey,
    displayName,
    eventName: text(event?.eventName)
  };
}
__name(getSurveyPublic, "getSurveyPublic");
async function submitSurveyResponse(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  const answers = Array.isArray(data.answers) ? data.answers : null;
  if (!answers) throw httpError(400, "Missing answers");
  const event = await getEventPayload(env, eventId);
  if (!event) return forwardToGas(env, data);
  const response = normalizeSurveyResponse({
    surveyId,
    responseId: `SRVR_${compactDate()}_${Date.now().toString().slice(-4)}`,
    eventId,
    eventName: text(event.eventName),
    lineUserId: text(data.lineUserId),
    displayName: text(data.displayName),
    residentNote: "",
    submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: "web",
    answers: answersToMap(answers)
  });
  if (!response.displayName && response.lineUserId) {
    response.displayName = await resolveDisplayName(env, data);
  }
  if (response.lineUserId) {
    const note = await getResidentNote(env, response.lineUserId);
    response.residentNote = text(note?.note);
  }
  await upsertSurveyResponseStatement(env, response).run();
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "submitSurveyResponse",
      surveyId,
      eventId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true, responseId: response.responseId };
}
__name(submitSurveyResponse, "submitSurveyResponse");
async function getSurveyResponses(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  return buildSurveyResponsesFromD1(env, surveyId);
}
__name(getSurveyResponses, "getSurveyResponses");
async function deleteSurveyEntry(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  if (data.responseId) {
    const responseId = requireId(data.responseId, "Missing responseId");
    await env.DB.prepare("DELETE FROM survey_responses WHERE survey_id = ? AND response_id = ?").bind(surveyId, responseId).run();
    ctx.waitUntil(forwardToGas(env, data).catch(() => {
    }));
    return { success: true };
  }
  if (data.attendanceId) {
    const attendanceId = requireId(data.attendanceId, "Missing attendanceId");
    await env.DB.prepare("DELETE FROM survey_walkin_attendance WHERE survey_id = ? AND attendance_id = ?").bind(surveyId, attendanceId).run();
    ctx.waitUntil(forwardToGas(env, data).catch(() => {
    }));
    return { success: true };
  }
  return { success: false, error: "Missing responseId or attendanceId" };
}
__name(deleteSurveyEntry, "deleteSurveyEntry");
async function updateSurveyResidentNote(env, ctx, data) {
  const lineUserId = requireId(data.lineUserId, "Missing lineUserId");
  const note = normalizeResidentNote({
    lineUserId,
    displayName: data.displayName,
    note: data.note,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  await upsertResidentNoteStatement(env, note).run();
  await env.DB.prepare(
    `UPDATE survey_responses
        SET resident_note = ?,
            payload_json = json_set(payload_json, '$.residentNote', ?)
      WHERE line_user_id = ?`
  ).bind(note.note, note.note, lineUserId).run();
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "updateSurveyResidentNote",
      lineUserId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true };
}
__name(updateSurveyResidentNote, "updateSurveyResidentNote");
async function addSurveyWalkInAttendance(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  const eventId = requireId(data.eventId, "Missing eventId");
  const displayName = requireId(data.displayName, "Missing displayName");
  const event = await getEventPayload(env, eventId);
  if (!event) return forwardToGas(env, data);
  const attendanceId = `WALKIN_${compactDate()}_${Date.now().toString().slice(-5)}`;
  const lineUserId = `walkin:${attendanceId}`;
  const walkin = normalizeWalkInAttendance({
    attendanceId,
    surveyId,
    eventId,
    eventName: text(event.eventName),
    lineUserId,
    displayName,
    residentNote: data.note,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  const statements = [upsertWalkInStatement(env, walkin)];
  if (text(data.note)) {
    statements.push(upsertResidentNoteStatement(env, {
      lineUserId,
      displayName,
      note: data.note,
      updatedAt: walkin.createdAt
    }));
  }
  await env.DB.batch(statements);
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "addSurveyWalkInAttendance",
      surveyId,
      eventId,
      syncTarget: "gas",
      error: error.message
    }));
  }));
  return { success: true, lineUserId };
}
__name(addSurveyWalkInAttendance, "addSurveyWalkInAttendance");
async function addWalkInRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const displayName = requireId(data.displayName, "Missing displayName");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const regId = `WALKIN_${compactDate()}_${Date.now().toString().slice(-5)}`;
  const reg = {
    regId,
    eventId,
    lineUserId: "",
    displayName,
    checkedIn: "TRUE",
    lineReminderOptIn: "FALSE",
    consentGiven: "FALSE",
    submittedAt: now,
    headcount: "1"
  };
  await upsertRegistrationStatement(env, eventId, reg).run();
  const registeredCount = await syncEventRegisteredCount(env, eventId);
  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({ action: "addWalkInRegistration", eventId, syncTarget: "gas", error: error.message }));
  }));
  return { success: true, regId, registeredCount, registration: reg };
}
__name(addWalkInRegistration, "addWalkInRegistration");
async function getLineUserRegistrationHistory(env, data) {
  const query = requireId(data.query, "Missing query").toLowerCase();
  const rows = await env.DB.prepare(
    `SELECT r.payload_json, e.event_name
       FROM event_registrations r
       LEFT JOIN events e ON e.event_id = r.event_id
      WHERE lower(r.line_user_id) LIKE ?
         OR lower(r.display_name) LIKE ?
      ORDER BY r.submitted_at DESC, r.event_id DESC
      LIMIT 200`
  ).bind(`%${query}%`, `%${query}%`).all();
  return {
    success: true,
    records: rows.results.map((row) => {
      const reg = parseJson(row.payload_json);
      return {
        eventId: text(reg.eventId),
        eventName: text(reg.eventName) || text(row.event_name),
        lineUserId: text(reg.lineUserId),
        displayName: text(reg.displayName),
        submittedAt: text(reg.submittedAt),
        checkedIn: text(reg.checkedIn || "FALSE").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
        consentGiven: text(reg.consentGiven || "FALSE").toUpperCase() === "TRUE" ? "TRUE" : "FALSE"
      };
    })
  };
}
__name(getLineUserRegistrationHistory, "getLineUserRegistrationHistory");
async function buildSurveyResponsesFromD1(env, surveyId) {
  const eventsRows = await env.DB.prepare(
    "SELECT event_id, event_name, payload_json FROM events WHERE survey_id = ? ORDER BY event_start DESC, event_id DESC"
  ).bind(surveyId).all();
  const events = eventsRows.results.map((row) => ({
    eventId: text(row.event_id),
    eventName: text(row.event_name)
  }));
  const eventNameById = new Map(events.map((event) => [event.eventId, event.eventName]));
  const notes = await loadResidentNotes(env);
  const registeredByKey = /* @__PURE__ */ new Map();
  const registeredRows = [];
  const allRegRows = events.length ? await env.DB.prepare(
    `SELECT payload_json FROM event_registrations WHERE event_id IN (${events.map(() => "?").join(",")}) ORDER BY event_id ASC, submitted_at ASC`
  ).bind(...events.map((e) => e.eventId)).all() : { results: [] };
  const regsByEvent = /* @__PURE__ */ new Map();
  for (const row of allRegRows.results) {
    const reg = parseJson(row.payload_json);
    const eid = text(reg.eventId);
    if (!regsByEvent.has(eid)) regsByEvent.set(eid, []);
    regsByEvent.get(eid).push(row);
  }
  for (const event of events) {
    const regs = { results: regsByEvent.get(event.eventId) || [] };
    for (const row of regs.results) {
      const reg = parseJson(row.payload_json);
      const uid = text(reg.lineUserId);
      if (!uid) continue;
      const key = `${event.eventId}
${uid}`;
      if (registeredByKey.has(key)) continue;
      const note = notes.get(uid);
      const regObj = {
        eventId: event.eventId,
        eventName: event.eventName,
        surveyId,
        lineUserId: uid,
        displayName: text(reg.displayName),
        residentNote: text(note?.note),
        registered: true,
        attended: text(reg.checkedIn || "FALSE").toUpperCase() === "TRUE",
        filled: false,
        submittedAt: "",
        source: "",
        answers: {}
      };
      registeredByKey.set(key, regObj);
      registeredRows.push(regObj);
    }
  }
  const responses = [];
  const respRows = await env.DB.prepare(
    "SELECT payload_json FROM survey_responses WHERE survey_id = ? ORDER BY submitted_at DESC"
  ).bind(surveyId).all();
  const filledKeys = /* @__PURE__ */ new Set();
  for (const row of respRows.results) {
    const resp = normalizeSurveyResponse(parseJson(row.payload_json));
    const key = `${resp.eventId}
${resp.lineUserId}`;
    const reg = registeredByKey.get(key);
    const note = resp.lineUserId ? notes.get(resp.lineUserId) : null;
    responses.push({
      ...resp,
      eventName: text(resp.eventName) || eventNameById.get(resp.eventId) || resp.eventId,
      displayName: text(resp.displayName) || text(reg?.displayName),
      residentNote: text(note?.note) || text(resp.residentNote),
      registered: !!reg,
      attended: reg ? !!reg.attended : true,
      filled: true,
      status: normalizeSurveyResponseStatus(!!reg, reg ? !!reg.attended : true, true)
    });
    if (resp.lineUserId) filledKeys.add(key);
  }
  const walkRows = await env.DB.prepare(
    "SELECT payload_json FROM survey_walkin_attendance WHERE survey_id = ? ORDER BY created_at DESC"
  ).bind(surveyId).all();
  for (const row of walkRows.results) {
    const walk = normalizeWalkInAttendance(parseJson(row.payload_json));
    const key = `${walk.eventId}
${walk.lineUserId}`;
    if (filledKeys.has(key)) continue;
    const note = walk.lineUserId ? notes.get(walk.lineUserId) : null;
    responses.push({
      eventId: walk.eventId,
      eventName: text(walk.eventName) || eventNameById.get(walk.eventId) || walk.eventId,
      surveyId,
      lineUserId: walk.lineUserId,
      displayName: walk.displayName,
      residentNote: text(note?.note) || text(walk.residentNote),
      registered: false,
      attended: true,
      filled: false,
      submittedAt: "",
      source: "walkin",
      answers: {},
      status: normalizeSurveyResponseStatus(false, true, false)
    });
  }
  for (const reg of registeredRows) {
    const key = `${reg.eventId}
${reg.lineUserId}`;
    if (filledKeys.has(key)) continue;
    responses.push({
      ...reg,
      status: normalizeSurveyResponseStatus(true, reg.attended, false)
    });
  }
  responses.sort((a, b) => text(b.submittedAt).localeCompare(text(a.submittedAt)) || text(a.eventName).localeCompare(text(b.eventName)) || text(a.displayName).localeCompare(text(b.displayName)));
  return { success: true, events, responses };
}
__name(buildSurveyResponsesFromD1, "buildSurveyResponsesFromD1");
async function findSurvey(env, data) {
  const surveyId = text(data.surveyId);
  if (surveyId) {
    const row2 = await env.DB.prepare("SELECT payload_json FROM surveys WHERE survey_id = ?").bind(surveyId).first();
    return row2 ? parseJson(row2.payload_json) : null;
  }
  const surveyFileName = text(data.surveyFileName);
  if (!surveyFileName) return null;
  const row = await env.DB.prepare(
    "SELECT payload_json FROM surveys WHERE json_extract(payload_json,'$.surveyFileName') = ?"
  ).bind(surveyFileName).first();
  return row ? parseJson(row.payload_json) : null;
}
__name(findSurvey, "findSurvey");
async function resolveDisplayName(env, data) {
  const lineUserId = text(data.lineUserId);
  if (!lineUserId) return "";
  if (text(data.displayName)) return text(data.displayName);
  const [noteRow, regRow] = await Promise.all([
    env.DB.prepare("SELECT display_name FROM resident_notes WHERE line_user_id = ? AND display_name != ''").bind(lineUserId).first(),
    env.DB.prepare("SELECT display_name FROM event_registrations WHERE line_user_id = ? AND display_name != '' ORDER BY submitted_at DESC LIMIT 1").bind(lineUserId).first()
  ]);
  const d1Name = text(noteRow?.display_name) || text(regRow?.display_name);
  if (d1Name) return d1Name;
  if (!env.GAS_SCRIPT_URL) return "";
  try {
    const json = await forwardToGas(env, {
      action: "getSurveyPublic",
      surveyId: data.surveyId,
      surveyFileName: data.surveyFileName,
      eventId: data.eventId,
      lineUserId
    });
    return text(json.displayName);
  } catch (error) {
    console.error(JSON.stringify({ action: "resolveDisplayName", lineUserId, error: error.message }));
    return "";
  }
}
__name(resolveDisplayName, "resolveDisplayName");
async function getResidentNote(env, lineUserId) {
  const row = await env.DB.prepare("SELECT payload_json FROM resident_notes WHERE line_user_id = ?").bind(lineUserId).first();
  return row ? parseJson(row.payload_json) : null;
}
__name(getResidentNote, "getResidentNote");
async function loadResidentNotes(env) {
  const rows = await env.DB.prepare("SELECT payload_json FROM resident_notes").all();
  const notes = /* @__PURE__ */ new Map();
  for (const row of rows.results) {
    const note = normalizeResidentNote(parseJson(row.payload_json));
    if (note.lineUserId) notes.set(note.lineUserId, note);
  }
  return notes;
}
__name(loadResidentNotes, "loadResidentNotes");

// src/upload.js
var driveTokenCache = null;
var driveTokenExpiry = 0;
async function getGoogleAccessToken(env) {
  if (driveTokenCache && Date.now() < driveTokenExpiry) return driveTokenCache;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token"
    }).toString()
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("\u7121\u6CD5\u53D6\u5F97 Drive access token: " + JSON.stringify(json));
  driveTokenCache = json.access_token;
  driveTokenExpiry = Date.now() + (json.expires_in - 60) * 1e3;
  return driveTokenCache;
}
__name(getGoogleAccessToken, "getGoogleAccessToken");
async function uploadToDrive(env, b64, mimeType, fileName) {
  const accessToken = await getGoogleAccessToken(env);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const boundary = `----Boundary${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: fileName, parents: [env.GOOGLE_DRIVE_FOLDER_ID] });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${metadata}\r
--${boundary}\r
Content-Type: ${mimeType}\r
\r
`
  );
  const tail = enc.encode(`\r
--${boundary}--`);
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
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  const file = await uploadRes.json();
  if (!file.id) throw new Error("Drive \u4E0A\u50B3\u5931\u6557: " + JSON.stringify(file));
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" })
  });
  return `https://lh3.googleusercontent.com/d/${file.id}`;
}
__name(uploadToDrive, "uploadToDrive");
async function uploadEventImage(env, data, request) {
  const b64 = text(data.imageBase64);
  if (!b64) return { success: false, error: "Missing imageBase64" };
  if (b64.length * 0.75 > 2 * 1024 * 1024) return { success: false, error: "\u5716\u7247\u904E\u5927\uFF0C\u8ACB\u58D3\u7E2E\u81F3 2MB \u4EE5\u4E0B" };
  const mimeType = text(data.mimeType) || "image/jpeg";
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN && env.GOOGLE_DRIVE_FOLDER_ID) {
    const ext = mimeType.split("/")[1] || "jpg";
    const url = await uploadToDrive(env, b64, mimeType, `event_${compactDate()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
    return { success: true, url };
  }
  const imageId = `img_${compactDate()}_${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(
    "INSERT INTO image_uploads (image_id, mime_type, data_base64, uploaded_at) VALUES (?, ?, ?, ?)"
  ).bind(imageId, mimeType, b64, (/* @__PURE__ */ new Date()).toISOString()).run();
  const origin = new URL(request.url).origin;
  return { success: true, url: `${origin}/img/${imageId}` };
}
__name(uploadEventImage, "uploadEventImage");
async function uploadPublicPhoto(env, data, request) {
  let b64 = text(data.imageBase64 || data.base64);
  if (!b64) return { success: false, error: "Missing imageBase64" };
  const commaIdx = b64.indexOf(",");
  if (commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
  if (b64.length * 0.75 > 2 * 1024 * 1024) return { success: false, error: "\u5716\u7247\u904E\u5927\uFF0C\u8ACB\u58D3\u7E2E\u81F3 2MB \u4EE5\u4E0B" };
  const mimeType = text(data.mimeType) || "image/jpeg";
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN && env.GOOGLE_DRIVE_FOLDER_ID) {
    const ext = mimeType.split("/")[1] || "jpg";
    const url = await uploadToDrive(env, b64, mimeType, `report_${compactDate()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
    return { success: true, url };
  }
  const imageId = `img_${compactDate()}_${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(
    "INSERT INTO image_uploads (image_id, mime_type, data_base64, uploaded_at) VALUES (?, ?, ?, ?)"
  ).bind(imageId, mimeType, b64, (/* @__PURE__ */ new Date()).toISOString()).run();
  const origin = new URL(request.url).origin;
  return { success: true, url: `${origin}/img/${imageId}` };
}
__name(uploadPublicPhoto, "uploadPublicPhoto");

// src/index.js
var ACTIONS = /* @__PURE__ */ new Set([
  "health",
  "login",
  "importBundle",
  "getEvents",
  "getEvent",
  "getEventDetailBundle",
  "createEvent",
  "updateEvent",
  "updateEventStatus",
  "deleteEvent",
  "reorderEvents",
  "getRegistrations",
  "getEventStats",
  "checkInRegistration",
  "updateRegistration",
  "deleteRegistration",
  "getSurveys",
  "getSurvey",
  "getSurveyPublic",
  "submitSurveyResponse",
  "submitRegistration",
  "createSurvey",
  "updateSurvey",
  "deleteSurvey",
  "getSurveyResponses",
  "deleteSurveyEntry",
  "updateSurveyResidentNote",
  "addSurveyWalkInAttendance",
  "addWalkInRegistration",
  "resetReminderSent",
  "resetSurveySentAt",
  "getLineUserRegistrationHistory",
  "uploadEventImage",
  "uploadPublicPhoto",
  "getEmergencyContacts",
  "addEmergencyContact",
  "updateEmergencyContact",
  "deleteEmergencyContact",
  "getChatThreads",
  "getChatMessages"
]);
var PUBLIC_ACTIONS = /* @__PURE__ */ new Set(["getSurveyPublic", "submitSurveyResponse", "submitRegistration", "uploadPublicPhoto"]);
var index_default = {
  async scheduled(controller, env) {
    const cron = controller.cron;
    try {
      await runScheduledJobs(env, `cron:${cron}`);
    } catch (err) {
      console.error(JSON.stringify({ fn: "scheduled", cron, error: err.message }));
    }
  },
  async fetch(request, env, ctx) {
    if (request.method === "POST" && new URL(request.url).pathname === "/line-webhook") {
      return handleLineWebhook(request, env, ctx);
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/hub-callback") {
      return handleHubCallback(request, env);
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/scheduled") {
      if (!isSchedulerAuthorized(request, env)) {
        return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }
      try {
        return jsonResponse(await runScheduledJobs(env, "shared-scheduler"));
      } catch (err) {
        console.error(JSON.stringify({ fn: "scheduledFetch", error: err.message }));
        return jsonResponse({ success: false, error: "Scheduled jobs failed" }, 500);
      }
    }
    if (request.method === "GET") {
      const imgPath = new URL(request.url).pathname;
      if (imgPath.startsWith("/img/")) {
        const imageId = decodeURIComponent(imgPath.slice(5));
        const row = await env.DB.prepare(
          "SELECT mime_type, data_base64 FROM image_uploads WHERE image_id = ?"
        ).bind(imageId).first();
        if (!row) return new Response("Not Found", { status: 404 });
        const bytes = Uint8Array.from(atob(row.data_base64), (c) => c.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            "Content-Type": row.mime_type,
            "Cache-Control": "public, max-age=31536000",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      return new Response("Not Found", { status: 404 });
    }
    if (request.method === "OPTIONS") return corsResponse(env, null, 204);
    if (request.method !== "POST") {
      return corsJson(env, { success: false, error: "POST only" }, 405);
    }
    let data;
    try {
      data = JSON.parse(await request.text() || "{}");
    } catch {
      return corsJson(env, { success: false, error: "Invalid JSON" }, 400);
    }
    const action = text(data.action);
    if (!ACTIONS.has(action)) {
      return corsJson(env, { success: false, error: "Unsupported action" }, 400);
    }
    try {
      if (action === "health") {
        return corsJson(env, { success: true, service: "events-api" });
      }
      if (action === "login") {
        const idToken = text(data.id_token);
        const payload = await verifyGoogleIdToken(env, idToken);
        if (!payload) return corsJson(env, { success: false, error: "\u672A\u6388\u6B0A\u7684\u5E33\u865F" }, 401);
        if (env.GAS_SCRIPT_URL) {
          try {
            const gasRes = await fetch(env.GAS_SCRIPT_URL, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({ action: "login", id_token: idToken })
            });
            const gasJson = await gasRes.json();
            if (gasJson.success && gasJson.sessionToken) {
              return corsJson(env, { success: true, email: payload.email, name: payload.name, role: gasJson.role || "admin", sessionToken: gasJson.sessionToken });
            }
          } catch {
          }
        }
        return corsJson(env, { success: true, email: payload.email, name: payload.name, role: "admin", sessionToken: idToken });
      }
      if (action === "importBundle") {
        await requireImporter(env, data);
        return corsJson(env, await importBundle(env, data.bundle || {}));
      }
      if (PUBLIC_ACTIONS.has(action)) {
        if (action === "getSurveyPublic") return corsJson(env, await getSurveyPublic(env, data));
        if (action === "submitSurveyResponse") return corsJson(env, await submitSurveyResponse(env, ctx, data));
        if (action === "submitRegistration") return corsJson(env, await submitRegistration(env, ctx, data));
        if (action === "uploadPublicPhoto") return corsJson(env, await uploadPublicPhoto(env, data, request));
      }
      if (action === "getEventDetailBundle") {
        const eventId = text(data.eventId);
        if (!eventId) return corsJson(env, { success: false, error: "Missing eventId" }, 400);
        const [, eventResult, statsResult, surveysResult] = await Promise.all([
          requireAdmin(env, data),
          getEvent(env, { eventId }),
          getEventStats(env, { eventId }),
          getSurveys(env)
        ]);
        return corsJson(env, {
          success: eventResult.success,
          error: eventResult.error,
          event: eventResult.event,
          stats: statsResult.stats,
          surveys: surveysResult.surveys
        });
      }
      if (action === "getEvents") {
        const [, result] = await Promise.all([requireAdmin(env, data), getEvents(env)]);
        return corsJson(env, result);
      }
      if (action === "getRegistrations") {
        const eventId = text(data.eventId);
        if (!eventId) return corsJson(env, { success: false, error: "Missing eventId" }, 400);
        const [, result] = await Promise.all([requireAdmin(env, data), getRegistrations(env, data)]);
        return corsJson(env, result);
      }
      if (action === "getEventStats") {
        const eventId = text(data.eventId);
        if (!eventId) return corsJson(env, { success: false, error: "Missing eventId" }, 400);
        const [, result] = await Promise.all([requireAdmin(env, data), getEventStats(env, data)]);
        return corsJson(env, result);
      }
      await requireAdmin(env, data);
      if (action === "getEvent") return corsJson(env, await getEvent(env, data));
      if (action === "createEvent") return corsJson(env, await createEvent(env, data));
      if (action === "updateEvent") return corsJson(env, await updateEvent(env, ctx, data));
      if (action === "updateEventStatus") return corsJson(env, await updateEventStatus(env, ctx, data));
      if (action === "deleteEvent") return corsJson(env, await deleteEvent(env, ctx, data));
      if (action === "reorderEvents") return corsJson(env, await reorderEvents(env, data));
      if (action === "checkInRegistration") return corsJson(env, await checkInRegistration(env, ctx, data));
      if (action === "updateRegistration") return corsJson(env, await updateRegistration(env, ctx, data));
      if (action === "deleteRegistration") return corsJson(env, await deleteRegistration(env, ctx, data));
      if (action === "getSurveys") return corsJson(env, await getSurveys(env));
      if (action === "getSurvey") return corsJson(env, await getSurvey(env, data));
      if (action === "createSurvey") return corsJson(env, await createSurvey(env, ctx, data));
      if (action === "updateSurvey") return corsJson(env, await updateSurvey(env, ctx, data));
      if (action === "deleteSurvey") return corsJson(env, await deleteSurvey(env, ctx, data));
      if (action === "getSurveyResponses") return corsJson(env, await getSurveyResponses(env, ctx, data));
      if (action === "deleteSurveyEntry") return corsJson(env, await deleteSurveyEntry(env, ctx, data));
      if (action === "updateSurveyResidentNote") return corsJson(env, await updateSurveyResidentNote(env, ctx, data));
      if (action === "addSurveyWalkInAttendance") return corsJson(env, await addSurveyWalkInAttendance(env, ctx, data));
      if (action === "addWalkInRegistration") return corsJson(env, await addWalkInRegistration(env, ctx, data));
      if (action === "resetReminderSent") return corsJson(env, await resetReminderSent(env, data));
      if (action === "resetSurveySentAt") return corsJson(env, await resetSurveySentAt(env, data));
      if (action === "getLineUserRegistrationHistory") return corsJson(env, await getLineUserRegistrationHistory(env, data));
      if (action === "uploadEventImage") return corsJson(env, await uploadEventImage(env, data, request));
      if (action === "getEmergencyContacts") return corsJson(env, await getEmergencyContacts(env));
      if (action === "addEmergencyContact") return corsJson(env, await addEmergencyContact(env, data));
      if (action === "updateEmergencyContact") return corsJson(env, await updateEmergencyContact(env, data));
      if (action === "deleteEmergencyContact") return corsJson(env, await deleteEmergencyContact(env, data));
      if (action === "getChatThreads") return corsJson(env, await getChatThreads(env));
      if (action === "getChatMessages") return corsJson(env, await getChatMessages(env, data));
      return corsJson(env, { success: false, error: "Unsupported action" }, 400);
    } catch (error) {
      const status = Number(error.status || 500);
      console.error(JSON.stringify({ action, status, error: error.message }));
      return corsJson(env, { success: false, error: status < 500 ? error.message : "\u4F3A\u670D\u5668\u932F\u8AA4", code: status }, status);
    }
  }
};
async function runScheduledJobs(env, source) {
  await closeEndedEvents(env);
  await sendEventReminders(env);
  await sendPostEventSurveys(env);
  return { success: true, source };
}
__name(runScheduledJobs, "runScheduledJobs");
function isSchedulerAuthorized(request, env) {
  const token = text(env.SCHEDULER_TOKEN);
  if (!token) return false;
  const auth = text(request.headers.get("Authorization"));
  const headerToken = text(request.headers.get("X-Scheduler-Token"));
  return auth === `Bearer ${token}` || headerToken === token;
}
__name(isSchedulerAuthorized, "isSchedulerAuthorized");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8" }
  });
}
__name(jsonResponse, "jsonResponse");
async function importBundle(env, bundle) {
  const events = Array.isArray(bundle.events) ? bundle.events : [];
  const surveys = Array.isArray(bundle.surveys) ? bundle.surveys : [];
  const statements = [];
  let registrationCount = 0;
  for (const entry of events) {
    const event = normalizeEvent(entry.event || entry);
    const registrations = Array.isArray(entry.registrations) ? entry.registrations : [];
    statements.push(upsertEventStatement(env, event));
    for (const reg of registrations) {
      statements.push(upsertRegistrationStatement(env, event.eventId, reg));
      registrationCount++;
    }
  }
  for (const survey of surveys) {
    statements.push(upsertSurveyStatement(env, survey));
  }
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  const importId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO import_runs (id, imported_at, event_count, registration_count, survey_count)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(importId, (/* @__PURE__ */ new Date()).toISOString(), events.length, registrationCount, surveys.length).run();
  return {
    success: true,
    importId,
    imported: {
      events: events.length,
      registrations: registrationCount,
      surveys: surveys.length
    }
  };
}
__name(importBundle, "importBundle");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
