// ── Registrations CRUD + check-in ────────────────────────────────────────────
import { text, requireId, httpError, parseJson, parseBoolean } from "./utils.js";
import { forwardToGas } from "./auth.js";
import {
  upsertRegistrationStatement,
  syncEventRegisteredCount,
  isSystemRegistrationColumn,
} from "./db.js";

export async function getRegistrations(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const [eventRow, { registrations, totalHeadcount }] = await Promise.all([
    env.DB.prepare("SELECT json_extract(payload_json,'$.registrationSheet') AS rs FROM events WHERE event_id = ?")
      .bind(eventId).first(),
    getRegistrationRows(env, eventId),
  ]);
  return {
    success: true,
    registrations,
    totalHeadcount,
    registrationSheet: text(eventRow?.rs),
  };
}

export async function getRegistrationRows(env, eventId) {
  const rows = await env.DB.prepare(
    `SELECT r.payload_json, rn.note AS rn_note
     FROM event_registrations r
     LEFT JOIN resident_notes rn ON r.line_user_id = rn.line_user_id
     WHERE r.event_id = ?
     ORDER BY
       CASE WHEN r.display_name = '' OR r.display_name IS NULL THEN 1 ELSE 0 END ASC,
       r.display_name ASC,
       r.submitted_at ASC`,
  ).bind(eventId).all();
  const registrations = rows.results.map((row) => {
    const reg = parseJson(row.payload_json);
    reg.residentNote = row.rn_note ?? "";
    return reg;
  });
  const totalHeadcount = registrations.reduce((sum, reg) => sum + (Number(reg.headcount || 0) || 1), 0);
  return { registrations, totalHeadcount };
}

export async function getEventStats(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const eventRow = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?")
    .bind(eventId)
    .first();
  if (!eventRow) return { success: false, error: "找不到活動" };
  const event = parseJson(eventRow.payload_json);
  const questions = Array.isArray(event.questions) ? event.questions : [];
  const { registrations, totalHeadcount } = await getRegistrationRows(env, eventId);
  const stats = {
    total: totalHeadcount,
    totalRegistrations: registrations.length,
    consentRate: 0,
    answers: {},
  };
  const consentCount = registrations.filter(
    (reg) => text(reg.consentGiven).toUpperCase() === "TRUE",
  ).length;
  stats.consentRate = registrations.length
    ? Math.round((consentCount / registrations.length) * 100)
    : 0;
  for (const question of questions) {
    if (question.type === "text") continue;
    const label = text(question.label);
    if (!label) continue;
    const counts = {};
    for (const reg of registrations) {
      const value = text(reg[label]);
      if (!value) continue;
      for (const item of value.split("、")) {
        const opt = text(item);
        if (opt) counts[opt] = (counts[opt] || 0) + 1;
      }
    }
    stats.answers[label] = counts;
  }
  return { success: true, stats };
}

export async function checkInRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const regId = requireId(data.regId, "Missing regId");
  const checkedIn = data.checkedIn !== undefined ? parseBoolean(data.checkedIn) : true;
  const checkedText = checkedIn ? "TRUE" : "FALSE";

  // Direct UPDATE with json_set — no SELECT needed; meta.changes detects missing row.
  const result = await env.DB.prepare(
    `UPDATE event_registrations
        SET checked_in = ?,
            payload_json = json_set(payload_json, '$.checkedIn', ?)
      WHERE event_id = ? AND reg_id = ?`,
  ).bind(checkedText, checkedText, eventId, regId).run();

  if (!result.meta.changes) {
    // Pre-migration: not in D1, upsert minimal record so next toggle is instant.
    const minimalReg = {
      regId, eventId,
      lineUserId: text(data.lineUserId),
      displayName: text(data.displayName),
      checkedIn: checkedText,
      submittedAt: new Date().toISOString(),
      headcount: 1,
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

export async function updateRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const regId = requireId(data.regId, "Missing regId");
  const updates = data.updates && typeof data.updates === "object" ? data.updates : null;
  if (!updates) throw httpError(400, "Missing updates");

  const row = await env.DB.prepare(
    "SELECT payload_json FROM event_registrations WHERE event_id = ? AND reg_id = ?",
  )
    .bind(eventId, regId)
    .first();

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
      error: error.message,
    }));
  }));

  return { success: true, registeredCount, registration: reg };
}

export async function deleteRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const regId = requireId(data.regId, "Missing regId");
  const now = new Date().toISOString();

  // Batch DELETE + count sync in one round-trip; check meta.changes to detect missing row.
  const [delResult] = await env.DB.batch([
    env.DB.prepare("DELETE FROM event_registrations WHERE event_id = ? AND reg_id = ?")
      .bind(eventId, regId),
    env.DB.prepare(
      `UPDATE events
          SET registered_count = (SELECT COALESCE(SUM(headcount),0) FROM event_registrations WHERE event_id = ?),
              payload_json = json_set(payload_json,
                '$.registeredCount', (SELECT COALESCE(SUM(headcount),0) FROM event_registrations WHERE event_id = ?),
                '$.updatedAt', ?)
        WHERE event_id = ?`,
    ).bind(eventId, eventId, now, eventId),
  ]);

  if (!delResult.meta.changes) {
    return forwardToGas(env, data);
  }

  const countRow = await env.DB.prepare(
    "SELECT registered_count FROM events WHERE event_id = ?",
  ).bind(eventId).first();
  const registeredCount = Number(countRow?.registered_count || 0);

  ctx.waitUntil(
    forwardToGas(env, data).catch((error) => {
      console.error(JSON.stringify({ action: "deleteRegistration", eventId, regId, syncTarget: "gas", error: error.message }));
    }),
  );

  return { success: true, registeredCount };
}
