// ── DB statement helpers and normalizers ─────────────────────────────────────
// All functions that build D1 prepared statements or normalize data shapes.
import { text, parseJson } from "./utils.js";

// ── Event ──────────────────────────────────────────────────────────────────

export async function getEventPayload(env, eventId) {
  const row = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?")
    .bind(eventId)
    .first();
  return row ? parseJson(row.payload_json) : null;
}

export function upsertEventStatement(env, event) {
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
      payload_json = excluded.payload_json`,
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
    JSON.stringify(event),
  );
}

export function normalizeEvent(event) {
  return {
    ...event,
    eventId: text(event.eventId),
    eventName: text(event.eventName),
    status: text(event.status),
    registeredCount: Number(event.registeredCount || 0),
  };
}

export function eventUpdatePayload(data) {
  const blocked = new Set([
    "action",
    "sessionToken",
    "id_token",
    "importToken",
    "eventId",
    "registeredCount",
    "registrationSheet",
    "createdAt",
    "surveySentAt",
  ]);
  const payload = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (blocked.has(key)) continue;
    payload[key] = value;
  }
  return payload;
}

export async function countRegistrations(env, eventId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM event_registrations WHERE event_id = ?",
  )
    .bind(eventId)
    .first();
  return Number(row?.count || 0);
}

export async function totalHeadcount(env, eventId) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(headcount), 0) AS total FROM event_registrations WHERE event_id = ?",
  )
    .bind(eventId)
    .first();
  return Number(row?.total || 0);
}

export async function syncEventRegisteredCount(env, eventId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE events
        SET registered_count = (SELECT COALESCE(SUM(headcount),0) FROM event_registrations WHERE event_id = ?),
            payload_json = json_set(payload_json,
              '$.registeredCount', (SELECT COALESCE(SUM(headcount),0) FROM event_registrations WHERE event_id = ?),
              '$.updatedAt', ?)
      WHERE event_id = ?`,
  ).bind(eventId, eventId, now, eventId).run();
  const row = await env.DB.prepare(
    "SELECT registered_count FROM events WHERE event_id = ?",
  ).bind(eventId).first();
  return Number(row?.registered_count || 0);
}

// ── Registration ───────────────────────────────────────────────────────────

export function upsertRegistrationStatement(env, eventId, registration) {
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
      payload_json = excluded.payload_json`,
  ).bind(
    eventId,
    regId,
    text(registration.lineUserId),
    text(registration.displayName),
    text(registration.checkedIn || "FALSE").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
    text(registration.submittedAt),
    Number(registration.headcount || 0) || 1,
    JSON.stringify(normalized),
  );
}

export function isSystemRegistrationColumn(key) {
  return new Set(["regId", "eventId", "lineUserId", "submittedAt", "headcount"]).has(key);
}

// ── Survey ─────────────────────────────────────────────────────────────────

export function upsertSurveyStatement(env, survey) {
  return env.DB.prepare(
    `INSERT INTO surveys (survey_id, survey_name, updated_at, payload_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(survey_id) DO UPDATE SET
       survey_name = excluded.survey_name,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`,
  ).bind(
    text(survey.surveyId),
    text(survey.surveyName),
    text(survey.updatedAt || survey.createdAt || ""),
    JSON.stringify(survey),
  );
}

export function normalizeSurvey(survey) {
  const now = new Date().toISOString();
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
    outroDescription: text(survey.outroDescription),
  };
}

export function normalizeSurveyQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).map((question, index) => {
    const q = question || {};
    let type = text(q.type || "text");
    if (type === "radio") type = "single";
    if (type === "checkbox") type = "multi";
    if (!["text", "single", "multi", "scale"].includes(type)) type = "text";
    let options = Array.isArray(q.options)
      ? q.options.map((option) => text(option)).filter(Boolean)
      : [];
    if (type === "scale") options = ["1", "2", "3", "4", "5"];
    return {
      id: text(q.id) || `srv_q_${index}`,
      type,
      label: text(q.label) || `問題 ${index + 1}`,
      required: q.required === true || text(q.required).toUpperCase() === "TRUE",
      options,
      allowOther: q.allowOther === true || text(q.allowOther).toUpperCase() === "TRUE",
      maxLength: Math.min(500, Math.max(1, Number.parseInt(q.maxLength, 10) || 200)),
    };
  });
}

export function surveyUpdatePayload(data) {
  const blocked = new Set(["action", "sessionToken", "id_token", "importToken", "surveyId", "createdAt"]);
  const payload = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (blocked.has(key)) continue;
    payload[key] = value;
  }
  return payload;
}

// ── Survey responses ────────────────────────────────────────────────────────

export function upsertSurveyResponseStatement(env, response) {
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
      payload_json = excluded.payload_json`,
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
    JSON.stringify(normalized),
  );
}

export function normalizeSurveyResponse(response) {
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
    answers: response.answers && typeof response.answers === "object" ? response.answers : {},
  };
}

export function normalizeSurveyResponseStatus(registered, attended, filled) {
  if (registered && attended && filled) return "registered_attended_filled";
  if (registered && attended && !filled) return "registered_attended_missing";
  if (registered && !attended && filled) return "registered_absent_filled";
  if (registered && !attended && !filled) return "registered_absent_missing";
  if (!registered && attended && filled) return "walkin_filled";
  if (!registered && attended && !filled) return "walkin_missing";
  return "missing";
}

export function answersToMap(answers) {
  const out = {};
  for (const answer of answers) {
    const label = text(answer?.label);
    if (!label) continue;
    out[label] = Array.isArray(answer.value) ? answer.value.map((value) => text(value)).join("、") : text(answer.value);
  }
  return out;
}

// ── Walk-in attendance ──────────────────────────────────────────────────────

export function upsertWalkInStatement(env, walkin) {
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
      payload_json = excluded.payload_json`,
  ).bind(
    normalized.attendanceId,
    normalized.surveyId,
    normalized.eventId,
    normalized.eventName,
    normalized.lineUserId,
    normalized.displayName,
    normalized.residentNote,
    normalized.createdAt,
    JSON.stringify(normalized),
  );
}

export function normalizeWalkInAttendance(walkin) {
  return {
    ...walkin,
    attendanceId: text(walkin.attendanceId) || crypto.randomUUID(),
    surveyId: text(walkin.surveyId),
    eventId: text(walkin.eventId),
    eventName: text(walkin.eventName),
    lineUserId: text(walkin.lineUserId),
    displayName: text(walkin.displayName),
    residentNote: text(walkin.residentNote || walkin.note),
    createdAt: text(walkin.createdAt),
  };
}

// ── Resident notes ──────────────────────────────────────────────────────────

export function upsertResidentNoteStatement(env, note) {
  const normalized = normalizeResidentNote(note);
  return env.DB.prepare(
    `INSERT INTO resident_notes (line_user_id, display_name, note, updated_at, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(line_user_id) DO UPDATE SET
       display_name = excluded.display_name,
       note = excluded.note,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`,
  ).bind(
    normalized.lineUserId,
    normalized.displayName,
    normalized.note,
    normalized.updatedAt,
    JSON.stringify(normalized),
  );
}

export function normalizeResidentNote(note) {
  return {
    lineUserId: text(note.lineUserId),
    displayName: text(note.displayName),
    note: text(note.note),
    updatedAt: text(note.updatedAt) || new Date().toISOString(),
  };
}
