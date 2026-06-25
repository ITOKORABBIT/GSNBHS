// ── Events CRUD ───────────────────────────────────────────────────────────────
import { text, requireId, httpError, parseJson, parseBoolean, CHECKIN_RADIUS_METERS } from "./utils.js";
import { forwardToGas } from "./auth.js";
import { normalizeEvent, eventUpdatePayload, upsertEventStatement, countRegistrations } from "./db.js";

export async function reorderEvents(env, data) {
  const orders = Array.isArray(data.orders) ? data.orders : [];
  if (!orders.length) return { success: true };
  const statements = orders.map(({ eventId, sortOrder }) =>
    env.DB.prepare(
      `UPDATE events
       SET sort_order = ?,
           payload_json = json_set(payload_json, '$.sortOrder', ?)
       WHERE event_id = ?`,
    ).bind(Number(sortOrder ?? 0), Number(sortOrder ?? 0), text(eventId)),
  );
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true };
}

export async function getEvents(env) {
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM events
     ORDER BY CASE WHEN sort_order > 0 THEN sort_order ELSE 999999 END ASC,
              updated_at DESC, event_id DESC`,
  ).all();
  return { success: true, events: rows.results.map((row) => parseJson(row.payload_json)) };
}

export async function getEvent(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?")
    .bind(eventId)
    .first();
  if (!row) return { success: false, error: "找不到活動" };
  return { success: true, event: parseJson(row.payload_json) };
}

export async function createEvent(env, data) {
  if (!text(data.eventName)) throw httpError(400, "Missing eventName");
  await normalizeCheckinLocationFields(data);
  const gasResult = await forwardToGas(env, data);
  const eventId = requireId(gasResult.eventId || data.eventId, "Missing eventId");
  const now = new Date().toISOString();
  const event = normalizeEvent({
    ...eventUpdatePayload(data),
    eventId,
    registeredCount: 0,
    registrationSheet: `REG_${eventId}`,
    createdAt: now,
    updatedAt: now,
    createdBy: data.createdBy || "",
    surveySentAt: "",
  });
  await upsertEventStatement(env, event).run();
  return { success: true, eventId, event };
}

export async function updateEvent(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  await normalizeCheckinLocationFields(data);
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?")
    .bind(eventId)
    .first();

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
    updatedAt: new Date().toISOString(),
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
      error: error.message,
    }));
  }));

  return { success: true, event };
}

export async function updateEventStatus(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const status = requireId(data.status, "Missing status");
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?")
    .bind(eventId)
    .first();

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
    updatedAt: new Date().toISOString(),
  };
  await upsertEventStatement(env, normalizeEvent(event)).run();

  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "updateEventStatus",
      eventId,
      syncTarget: "gas",
      error: error.message,
    }));
  }));

  return { success: true, event };
}

export async function deleteEvent(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?")
    .bind(eventId)
    .first();

  if (!row) {
    return forwardToGas(env, data);
  }

  const regCount = await countRegistrations(env, eventId);
  if (regCount > 0 && !parseBoolean(data.force)) {
    return {
      success: false,
      error: "Event has registrations; pass force:true to delete",
      hasRegistrations: true,
      count: regCount,
    };
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM event_registrations WHERE event_id = ?").bind(eventId),
    env.DB.prepare("DELETE FROM events WHERE event_id = ?").bind(eventId),
  ]);

  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "deleteEvent",
      eventId,
      syncTarget: "gas",
      error: error.message,
    }));
  }));

  return { success: true };
}

// ── Check-in location normalization ─────────────────────────────────────────

export async function normalizeCheckinLocationFields(data) {
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
    throw httpError(400, "Google Map 連結無法解析座標，請改貼完整 Google Maps 連結或手動填寫簽到中心座標");
  }
  data.checkinLatitude = lat;
  data.checkinLongitude = lng;
}

// ── Private helpers ──────────────────────────────────────────────────────────

function shouldResetSurveySent(event, existing) {
  const keys = ["surveyId", "surveyTarget", "surveyDelay", "eventEnd"];
  return keys.some((key) => text(event[key]) !== text(existing[key]));
}

function shouldResetReminderSent(event, existing) {
  const keys = ["reminderTime", "eventStart", "eventEnd"];
  return keys.some((key) => text(event[key]) !== text(existing[key]));
}

function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function parseOptionalNumber(value) {
  const raw = text(value);
  if (!raw) return NaN;
  return Number(raw);
}

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
        headers: { "User-Agent": "Mozilla/5.0 hpnbhs-events-api" },
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

function parseLatLngFromText(value) {
  if (!value) return null;
  const candidates = [String(value)];
  try { candidates.push(decodeURIComponent(candidates[0])); } catch {}
  try { candidates.push(decodeURIComponent(candidates[1] || candidates[0])); } catch {}
  for (const raw of candidates) {
    const patterns = [
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /%403d(-?\d+(?:\.\d+)?)%2C4d(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
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
