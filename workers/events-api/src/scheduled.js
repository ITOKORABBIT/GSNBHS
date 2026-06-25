// ── Cron jobs — called from Cloudflare Cron Triggers ─────────────────────────
import { text, requireId, parseJson, parseTaiwanIsoToMs, taiwanIsoNow, taiwanIsoMinutesAgo } from "./utils.js";
import { lineMulticast, buildSurveyInviteBubble, buildEvtReminderMessages, SURVEY_BASE_URL } from "./line.js";

const SURVEY_GRACE_DAYS = 14;

export async function closeEndedEvents(env) {
  const now = taiwanIsoNow();
  const endedAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE events
        SET status = '已結束',
            updated_at = ?,
            payload_json = json_set(payload_json,
              '$.status', '已結束',
              '$.updatedAt', ?)
      WHERE status NOT IN ('已結束', '已取消')
        AND event_end != ''
        AND event_end <= ?`,
  ).bind(endedAt, endedAt, now).run();
  if (result.meta?.changes) {
    console.log(JSON.stringify({ fn: "closeEndedEvents", closed: result.meta.changes }));
  }
}

export async function sendEventReminders(env) {
  const nowMs = Date.now();
  const now = taiwanIsoNow();

  const rows = await env.DB.prepare(
    `SELECT payload_json FROM events
     WHERE status NOT IN ('已結束', '已取消')
       AND event_end != ''
       AND event_end >= ?
       AND json_extract(payload_json, '$.reminderTime') IS NOT NULL
       AND json_extract(payload_json, '$.reminderTime') != ''
       AND json_extract(payload_json, '$.reminderTime') != 'none'`,
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

    // 已送過的 LINE ID 清單（防止同一人重複收到）
    const sentIds = new Set(
      Array.isArray(event.reminderSentLineIds) ? event.reminderSentLineIds : [],
    );

    const regRows = await env.DB.prepare(
      `SELECT line_user_id FROM event_registrations
       WHERE event_id = ? AND line_user_id != ''
         AND json_extract(payload_json, '$.lineReminderOptIn') = 'TRUE'`,
    ).bind(eventId).all();
    const allIds = [...new Set(regRows.results.map((r) => r.line_user_id).filter(Boolean))];
    const newIds = allIds.filter((id) => !sentIds.has(id));

    if (!newIds.length) continue;

    // 先寫入已送清單再推播（防止 cron 重疊時重複送）
    const updatedSentIds = [...sentIds, ...newIds];
    await env.DB.prepare(
      `UPDATE events SET payload_json =
        json_set(json_set(payload_json, '$.reminderSentLineIds', json(?)), '$.reminderSentAt', ?)
       WHERE event_id = ?`,
    ).bind(JSON.stringify(updatedSentIds), new Date().toISOString(), eventId).run();

    const reminderMessages = buildEvtReminderMessages(event);
    for (let k = 0; k < newIds.length; k += 500) {
      await lineMulticast(env, newIds.slice(k, k + 500), reminderMessages);
    }
    console.log(JSON.stringify({ fn: "sendEventReminders", event: event.eventName, recipients: newIds.length }));
  }
}

export async function resetReminderSent(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  await env.DB.prepare(
    `UPDATE events SET payload_json =
      json_set(json_set(payload_json, '$.reminderSentAt', ''), '$.reminderSentLineIds', json('[]'))
     WHERE event_id = ?`,
  ).bind(eventId).run();
  return { success: true };
}

export async function resetSurveySentAt(env, data) {
  const eventId = requireId(data.eventId, "Missing eventId");
  await env.DB.prepare(
    `UPDATE events SET payload_json = json_set(payload_json, '$.surveySentAt', '') WHERE event_id = ?`,
  ).bind(eventId).run();
  return { success: true };
}

export async function sendPostEventSurveys(env) {
  const nowMs = Date.now();
  const graceMs = SURVEY_GRACE_DAYS * 24 * 60 * 60 * 1000;
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
       )`,
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
    const delayMs = parseSurveyDelayMinutes(text(event.surveyDelay)) * 60 * 1000;
    const sendAtMs = eventEndMs + delayMs;
    if (sendAtMs > nowMs) continue;
    if (sendAtMs < nowMs - graceMs) {
      console.log(JSON.stringify({ fn: "sendPostEventSurveys", skip: "overdue", eventId }));
      continue;
    }

    const surveyRow = await env.DB.prepare(
      "SELECT payload_json FROM surveys WHERE survey_id = ?",
    ).bind(surveyId).first();
    if (!surveyRow) continue;
    const survey = parseJson(surveyRow.payload_json);

    const surveyTarget = text(event.surveyTarget) || "全部報名";
    let regQuery;
    if (surveyTarget === "已簽到") {
      regQuery = await env.DB.prepare(
        "SELECT line_user_id FROM event_registrations WHERE event_id = ? AND checked_in = 'TRUE' AND line_user_id != ''",
      ).bind(eventId).all();
    } else {
      regQuery = await env.DB.prepare(
        "SELECT line_user_id FROM event_registrations WHERE event_id = ? AND line_user_id != ''",
      ).bind(eventId).all();
    }
    const userIds = [...new Set(regQuery.results.map((r) => r.line_user_id).filter(Boolean))];
    if (!userIds.length) continue;

    const sentAt = new Date().toISOString();
    for (const uid of userIds) {
      const surveyUrl = SURVEY_BASE_URL +
        "?eventId=" + encodeURIComponent(eventId) +
        "&surveyId=" + encodeURIComponent(surveyId) +
        "&lineUserId=" + encodeURIComponent(uid);
      await lineMulticast(env, [uid], [buildSurveyInviteBubble(text(event.eventName), survey, surveyUrl)]);
    }
    await env.DB.prepare(
      "UPDATE events SET payload_json = json_set(payload_json, '$.surveySentAt', ?) WHERE event_id = ?",
    ).bind(sentAt, eventId).run();
    console.log(JSON.stringify({ fn: "sendPostEventSurveys", survey: survey.surveyName, event: event.eventName, recipients: userIds.length }));
  }
}

export function parseSurveyDelayMinutes(value) {
  if (value === 0 || value === "0") return 0;
  if (!value) return 60;
  const m = parseInt(value, 10);
  if (isNaN(m) || m < 0) return 60;
  return m;
}
