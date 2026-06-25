// ── Survey CRUD, responses, analytics, resident data ─────────────────────────
import { text, requireId, httpError, parseJson, compactDate, isWithinRegWindow } from "./utils.js";
import { forwardToGas, forwardToGasResult } from "./auth.js";
import {
  getEventPayload,
  upsertRegistrationStatement,
  upsertSurveyStatement,
  upsertSurveyResponseStatement,
  upsertWalkInStatement,
  upsertResidentNoteStatement,
  normalizeSurvey,
  normalizeSurveyResponse,
  normalizeWalkInAttendance,
  normalizeResidentNote,
  normalizeSurveyResponseStatus,
  answersToMap,
  surveyUpdatePayload,
  syncEventRegisteredCount,
} from "./db.js";

// ── Survey CRUD ──────────────────────────────────────────────────────────────

export async function getSurveys(env) {
  const rows = await env.DB.prepare(
    "SELECT payload_json FROM surveys ORDER BY updated_at DESC, survey_id DESC",
  ).all();
  return { success: true, surveys: rows.results.map((row) => parseJson(row.payload_json)) };
}

export async function getSurvey(env, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  const row = await env.DB.prepare("SELECT payload_json FROM surveys WHERE survey_id = ?")
    .bind(surveyId)
    .first();
  if (!row) return { success: false, error: "找不到問券" };
  return { success: true, survey: parseJson(row.payload_json) };
}

export async function createSurvey(env, ctx, data) {
  if (!text(data.surveyName)) throw httpError(400, "Missing surveyName");
  const surveyFileName = text(data.surveyFileName) || `survey${Date.now().toString().slice(-4)}.html`;
  const createData = { ...data, surveyFileName };
  const gasResult = await forwardToGas(env, createData);
  const now = new Date().toISOString();
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
    outroTitle: data.outroTitle || "問券已完成",
    outroDescription: data.outroDescription || "感謝您的填寫。",
  });
  await upsertSurveyStatement(env, survey).run();

  return { success: true, surveyId, survey };
}

export async function updateSurvey(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  const row = await env.DB.prepare("SELECT payload_json FROM surveys WHERE survey_id = ?")
    .bind(surveyId)
    .first();

  if (!row) {
    return forwardToGas(env, data);
  }

  const existing = parseJson(row.payload_json);
  const survey = normalizeSurvey({
    ...existing,
    ...surveyUpdatePayload(data),
    surveyId,
    updatedAt: new Date().toISOString(),
  });
  await upsertSurveyStatement(env, survey).run();

  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "updateSurvey",
      surveyId,
      syncTarget: "gas",
      error: error.message,
    }));
  }));

  return { success: true, survey };
}

export async function deleteSurvey(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  const row = await env.DB.prepare("SELECT survey_id FROM surveys WHERE survey_id = ?")
    .bind(surveyId)
    .first();

  if (!row) {
    return forwardToGas(env, data);
  }

  await env.DB.prepare("DELETE FROM surveys WHERE survey_id = ?").bind(surveyId).run();

  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "deleteSurvey",
      surveyId,
      syncTarget: "gas",
      error: error.message,
    }));
  }));

  return { success: true };
}

// ── Registration via survey flow ─────────────────────────────────────────────

export async function submitRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const lineUserId = text(data.lineUserId);
  if (!lineUserId) throw httpError(400, "Missing lineUserId");

  const event = await getEventPayload(env, eventId);
  if (!event) return forwardToGas(env, data);

  if (text(event.status) !== "報名中")
    return { success: false, error: "此活動報名已截止" };
  if (!isWithinRegWindow(event))
    return { success: false, error: "此活動目前不在開放報名期間" };

  const existingRow = await env.DB.prepare(
    "SELECT reg_id FROM event_registrations WHERE event_id=? AND line_user_id=? LIMIT 1",
  ).bind(eventId, lineUserId).first();

  const displayName = await resolveDisplayName(env, data);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const regId = existingRow ? text(existingRow.reg_id) : `REG_${dateStr}_${crypto.randomUUID()}`;

  const answers = Array.isArray(data.answers) ? data.answers : [];
  const answerMap = {};
  answers.forEach((a) => {
    answerMap[text(a.label)] = Array.isArray(a.value)
      ? a.value.join("、")
      : text(a.value);
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
    ...answerMap,
  };

  const quotaNum = parseInt(text(event.quota), 10) || 0;

  if (existingRow || quotaNum <= 0) {
    await upsertRegistrationStatement(env, eventId, reg).run();
  } else {
    const result = await env.DB.prepare(
      `INSERT INTO event_registrations
         (event_id, reg_id, line_user_id, display_name, checked_in, submitted_at, headcount, payload_json)
       SELECT ?, ?, ?, ?, 'FALSE', ?, 1, ?
       WHERE (SELECT COALESCE(SUM(headcount), 0) FROM event_registrations WHERE event_id = ?) < ?`,
    ).bind(
      eventId, regId, lineUserId, displayName, now.toISOString(), JSON.stringify({ ...reg, eventId }),
      eventId, quotaNum,
    ).run();

    if (!result.meta.changes) {
      return { success: false, error: "此活動報名已額滿" };
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
          error: error.message,
        }),
      );
    }),
  );

  return { success: true, regId, displayName };
}

// ── Survey public access ─────────────────────────────────────────────────────

export async function getSurveyPublic(env, data) {
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
    eventName: text(event?.eventName),
  };
}

export async function submitSurveyResponse(env, ctx, data) {
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
    submittedAt: new Date().toISOString(),
    source: "web",
    answers: answersToMap(answers),
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
      error: error.message,
    }));
  }));

  return { success: true, responseId: response.responseId };
}

export async function getSurveyResponses(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  return buildSurveyResponsesFromD1(env, surveyId);
}

export async function deleteSurveyEntry(env, ctx, data) {
  const surveyId = requireId(data.surveyId, "Missing surveyId");
  if (data.responseId) {
    const responseId = requireId(data.responseId, "Missing responseId");
    await env.DB.prepare("DELETE FROM survey_responses WHERE survey_id = ? AND response_id = ?")
      .bind(surveyId, responseId).run();
    ctx.waitUntil(forwardToGas(env, data).catch(() => {}));
    return { success: true };
  }
  if (data.attendanceId) {
    const attendanceId = requireId(data.attendanceId, "Missing attendanceId");
    await env.DB.prepare("DELETE FROM survey_walkin_attendance WHERE survey_id = ? AND attendance_id = ?")
      .bind(surveyId, attendanceId).run();
    ctx.waitUntil(forwardToGas(env, data).catch(() => {}));
    return { success: true };
  }
  return { success: false, error: "Missing responseId or attendanceId" };
}

export async function updateSurveyResidentNote(env, ctx, data) {
  const lineUserId = requireId(data.lineUserId, "Missing lineUserId");
  const note = normalizeResidentNote({
    lineUserId,
    displayName: data.displayName,
    note: data.note,
    updatedAt: new Date().toISOString(),
  });
  await upsertResidentNoteStatement(env, note).run();
  await env.DB.prepare(
    `UPDATE survey_responses
        SET resident_note = ?,
            payload_json = json_set(payload_json, '$.residentNote', ?)
      WHERE line_user_id = ?`,
  )
    .bind(note.note, note.note, lineUserId)
    .run();

  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "updateSurveyResidentNote",
      lineUserId,
      syncTarget: "gas",
      error: error.message,
    }));
  }));

  return { success: true };
}

export async function addSurveyWalkInAttendance(env, ctx, data) {
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
    createdAt: new Date().toISOString(),
  });
  const statements = [upsertWalkInStatement(env, walkin)];
  if (text(data.note)) {
    statements.push(upsertResidentNoteStatement(env, {
      lineUserId,
      displayName,
      note: data.note,
      updatedAt: walkin.createdAt,
    }));
  }
  await env.DB.batch(statements);

  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({
      action: "addSurveyWalkInAttendance",
      surveyId,
      eventId,
      syncTarget: "gas",
      error: error.message,
    }));
  }));

  return { success: true, lineUserId };
}

export async function addWalkInRegistration(env, ctx, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  const displayName = requireId(data.displayName, "Missing displayName");
  const now = new Date().toISOString();
  const regId = `WALKIN_${compactDate()}_${Date.now().toString().slice(-5)}`;

  const reg = {
    regId, eventId,
    lineUserId: "", displayName,
    checkedIn: "TRUE", lineReminderOptIn: "FALSE", consentGiven: "FALSE",
    submittedAt: now, headcount: "1",
  };

  await upsertRegistrationStatement(env, eventId, reg).run();
  const registeredCount = await syncEventRegisteredCount(env, eventId);

  ctx.waitUntil(forwardToGas(env, data).catch((error) => {
    console.error(JSON.stringify({ action: "addWalkInRegistration", eventId, syncTarget: "gas", error: error.message }));
  }));

  return { success: true, regId, registeredCount, registration: reg };
}

// ── Analytics ────────────────────────────────────────────────────────────────

export async function getLineUserRegistrationHistory(env, data) {
  const query = requireId(data.query, "Missing query").toLowerCase();
  const rows = await env.DB.prepare(
    `SELECT r.payload_json, e.event_name
       FROM event_registrations r
       LEFT JOIN events e ON e.event_id = r.event_id
      WHERE lower(r.line_user_id) LIKE ?
         OR lower(r.display_name) LIKE ?
      ORDER BY r.submitted_at DESC, r.event_id DESC
      LIMIT 200`,
  )
    .bind(`%${query}%`, `%${query}%`)
    .all();
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
        consentGiven: text(reg.consentGiven || "FALSE").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
      };
    }),
  };
}

export async function buildSurveyResponsesFromD1(env, surveyId) {
  const eventsRows = await env.DB.prepare(
    "SELECT event_id, event_name, payload_json FROM events WHERE survey_id = ? ORDER BY event_start DESC, event_id DESC",
  )
    .bind(surveyId)
    .all();
  const events = eventsRows.results.map((row) => ({
    eventId: text(row.event_id),
    eventName: text(row.event_name),
  }));
  const eventNameById = new Map(events.map((event) => [event.eventId, event.eventName]));
  const notes = await loadResidentNotes(env);
  const registeredByKey = new Map();
  const registeredRows = [];

  // Single batch query instead of N separate queries
  const allRegRows = events.length
    ? await env.DB.prepare(
        `SELECT payload_json FROM event_registrations WHERE event_id IN (${events.map(() => "?").join(",")}) ORDER BY event_id ASC, submitted_at ASC`,
      ).bind(...events.map((e) => e.eventId)).all()
    : { results: [] };

  const regsByEvent = new Map();
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
      const key = `${event.eventId}\n${uid}`;
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
        answers: {},
      };
      registeredByKey.set(key, regObj);
      registeredRows.push(regObj);
    }
  }

  const responses = [];
  const respRows = await env.DB.prepare(
    "SELECT payload_json FROM survey_responses WHERE survey_id = ? ORDER BY submitted_at DESC",
  )
    .bind(surveyId)
    .all();
  const filledKeys = new Set();
  for (const row of respRows.results) {
    const resp = normalizeSurveyResponse(parseJson(row.payload_json));
    const key = `${resp.eventId}\n${resp.lineUserId}`;
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
      status: normalizeSurveyResponseStatus(!!reg, reg ? !!reg.attended : true, true),
    });
    if (resp.lineUserId) filledKeys.add(key);
  }

  const walkRows = await env.DB.prepare(
    "SELECT payload_json FROM survey_walkin_attendance WHERE survey_id = ? ORDER BY created_at DESC",
  )
    .bind(surveyId)
    .all();
  for (const row of walkRows.results) {
    const walk = normalizeWalkInAttendance(parseJson(row.payload_json));
    const key = `${walk.eventId}\n${walk.lineUserId}`;
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
      status: normalizeSurveyResponseStatus(false, true, false),
    });
  }

  for (const reg of registeredRows) {
    const key = `${reg.eventId}\n${reg.lineUserId}`;
    if (filledKeys.has(key)) continue;
    responses.push({
      ...reg,
      status: normalizeSurveyResponseStatus(true, reg.attended, false),
    });
  }

  responses.sort((a, b) => (
    text(b.submittedAt).localeCompare(text(a.submittedAt)) ||
    text(a.eventName).localeCompare(text(b.eventName)) ||
    text(a.displayName).localeCompare(text(b.displayName))
  ));

  return { success: true, events, responses };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export async function findSurvey(env, data) {
  const surveyId = text(data.surveyId);
  if (surveyId) {
    const row = await env.DB.prepare("SELECT payload_json FROM surveys WHERE survey_id = ?")
      .bind(surveyId)
      .first();
    return row ? parseJson(row.payload_json) : null;
  }
  const surveyFileName = text(data.surveyFileName);
  if (!surveyFileName) return null;
  const row = await env.DB.prepare(
    "SELECT payload_json FROM surveys WHERE json_extract(payload_json,'$.surveyFileName') = ?",
  ).bind(surveyFileName).first();
  return row ? parseJson(row.payload_json) : null;
}

export async function resolveDisplayName(env, data) {
  const lineUserId = text(data.lineUserId);
  if (!lineUserId) return "";
  if (text(data.displayName)) return text(data.displayName);

  // Try D1 before touching GAS
  const [noteRow, regRow] = await Promise.all([
    env.DB.prepare("SELECT display_name FROM resident_notes WHERE line_user_id = ? AND display_name != ''")
      .bind(lineUserId).first(),
    env.DB.prepare("SELECT display_name FROM event_registrations WHERE line_user_id = ? AND display_name != '' ORDER BY submitted_at DESC LIMIT 1")
      .bind(lineUserId).first(),
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
      lineUserId,
    });
    return text(json.displayName);
  } catch (error) {
    console.error(JSON.stringify({ action: "resolveDisplayName", lineUserId, error: error.message }));
    return "";
  }
}

export async function getResidentNote(env, lineUserId) {
  const row = await env.DB.prepare("SELECT payload_json FROM resident_notes WHERE line_user_id = ?")
    .bind(lineUserId)
    .first();
  return row ? parseJson(row.payload_json) : null;
}

export async function loadResidentNotes(env) {
  const rows = await env.DB.prepare("SELECT payload_json FROM resident_notes").all();
  const notes = new Map();
  for (const row of rows.results) {
    const note = normalizeResidentNote(parseJson(row.payload_json));
    if (note.lineUserId) notes.set(note.lineUserId, note);
  }
  return notes;
}

export async function importSurveyResponsesFromGas(env, data) {
  const json = await forwardToGas(env, data);
  if (!Array.isArray(json.responses)) return;
  const statements = [];
  for (const response of json.responses) {
    if (response.filled) {
      statements.push(upsertSurveyResponseStatement(env, normalizeSurveyResponse({
        ...response,
        responseId: response.responseId || `LEGACY_${text(response.eventId)}_${text(response.lineUserId)}_${text(response.submittedAt)}`,
      })));
    }
    if (!response.registered && response.attended && !response.filled) {
      statements.push(upsertWalkInStatement(env, normalizeWalkInAttendance({
        attendanceId: response.attendanceId || `LEGACY_${text(response.eventId)}_${text(response.lineUserId)}`,
        ...response,
        createdAt: response.createdAt || response.submittedAt || new Date().toISOString(),
      })));
    }
    if (text(response.lineUserId) && text(response.residentNote)) {
      statements.push(upsertResidentNoteStatement(env, normalizeResidentNote({
        lineUserId: response.lineUserId,
        displayName: response.displayName,
        note: response.residentNote,
        updatedAt: new Date().toISOString(),
      })));
    }
  }
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
}
