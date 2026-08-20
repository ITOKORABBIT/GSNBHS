// ── Router entry point ────────────────────────────────────────────────────────
import { handleLineWebhook, handleHubCallback, linePush, getLineQuota } from "./line.js";
import { getConsultRequests, retryConsultNotification, submitConsult, updateConsultStatus } from "./consult.js";
import { closeEndedEvents, sendEventReminders, sendPostEventSurveys, resetReminderSent, resetSurveySentAt } from "./scheduled.js";
import { getEvents, getEvent, createEvent, updateEvent, updateEventStatus, deleteEvent, reorderEvents } from "./events.js";
import { getRegistrations, getEventStats, checkInRegistration, updateRegistration, deleteRegistration } from "./registrations.js";
import {
  getSurveys, getSurvey, createSurvey, updateSurvey, deleteSurvey,
  getSurveyPublic, submitSurveyResponse, submitRegistration,
  getSurveyResponses, deleteSurveyEntry, updateSurveyResidentNote,
  addSurveyWalkInAttendance, addWalkInRegistration, getLineUserRegistrationHistory,
} from "./survey.js";
import { uploadEventImage, uploadPublicPhoto } from "./upload.js";
import { getEmergencyContacts, addEmergencyContact, updateEmergencyContact, deleteEmergencyContact } from "./contacts.js";
import { getChatThreads, getChatMessages } from "./chat.js";
import { loginAdmin, requireAdmin, requireImporter, corsJson, corsResponse } from "./auth.js";
import { text } from "./utils.js";
import { normalizeEvent, upsertEventStatement, upsertRegistrationStatement, upsertSurveyStatement } from "./db.js";

const ACTIONS = new Set([
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
  "getChatMessages",
  "submitConsult",
  "getConsultRequests",
  "retryConsultNotification",
  "updateConsultStatus",
]);

const PUBLIC_ACTIONS = new Set(["getSurveyPublic", "submitSurveyResponse", "submitRegistration", "uploadPublicPhoto", "submitConsult"]);

export default {
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

    // 給 cases-api 用的內部推播入口。里民的 LINE userId 屬於本頻道的命名空間，
    // 只有這支 Worker 手上的 token 推得動，所以案件回覆通知要繞到這裡來。
    // 走 service binding 呼叫（同帳號 Worker 用公開網址互打會被擋，見 line.js）。
    if (request.method === "POST" && new URL(request.url).pathname === "/internal/line-push") {
      if (!isInternalPushAuthorized(request, env)) {
        return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }
      let payload;
      try {
        payload = JSON.parse((await request.text()) || "{}");
      } catch {
        return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
      }
      if (text(payload.action) === "quota") {
        return jsonResponse(await getLineQuota(env));
      }
      const to = text(payload.to);
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      if (!to || !messages.length) {
        return jsonResponse({ success: false, error: "to and messages are required" }, 400);
      }
      const pushed = await linePush(env, to, messages);
      return jsonResponse({ success: pushed }, pushed ? 200 : 502);
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

    // Serve uploaded images (no auth required — image_id is unguessable)
    if (request.method === "GET") {
      const imgPath = new URL(request.url).pathname;
      if (imgPath.startsWith("/img/")) {
        const imageId = decodeURIComponent(imgPath.slice(5));
        const row = await env.DB.prepare(
          "SELECT mime_type, data_base64 FROM image_uploads WHERE image_id = ?",
        ).bind(imageId).first();
        if (!row) return new Response("Not Found", { status: 404 });
        const bytes = Uint8Array.from(atob(row.data_base64), (c) => c.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            "Content-Type": row.mime_type,
            "Cache-Control": "public, max-age=31536000",
            "Access-Control-Allow-Origin": "*",
          },
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
        return corsJson(env, { success: true, service: "events-api" });
      }

      if (action === "login") {
        return corsJson(env, await loginAdmin(env, text(data.id_token)));
      }

      if (action === "importBundle") {
        await requireImporter(env, data);
        return corsJson(env, await importBundle(env, data.bundle || {}));
      }

      if (PUBLIC_ACTIONS.has(action)) {
        if (action === "getSurveyPublic") return corsJson(env, await getSurveyPublic(env, data));
        if (action === "submitSurveyResponse") {
          if (!(await checkRateLimit(env, request))) {
            return corsJson(env, { success: false, error: "操作過於頻繁，請稍後再試" }, 429);
          }
          return corsJson(env, await submitSurveyResponse(env, ctx, data));
        }
        if (action === "submitRegistration") {
          if (!(await checkRateLimit(env, request))) {
            return corsJson(env, { success: false, error: "操作過於頻繁，請稍後再試" }, 429);
          }
          return corsJson(env, await submitRegistration(env, ctx, data));
        }
        if (action === "uploadPublicPhoto") {
          if (!(await checkRateLimit(env, request))) {
            return corsJson(env, { success: false, error: "操作過於頻繁，請稍後再試" }, 429);
          }
          return corsJson(env, await uploadPublicPhoto(env, data, request));
        }
        if (action === "submitConsult") {
          if (!(await checkRateLimit(env, request))) {
            return corsJson(env, { success: false, error: "操作過於頻繁，請稍後再試" }, 429);
          }
          return corsJson(env, await submitConsult(env, ctx, data, request));
        }
      }

      // For read-only bundle requests, run auth + D1 reads in parallel so
      // JWKS fetch (cold-start cost) doesn't block the database queries.
      if (action === "getEventDetailBundle") {
        const eventId = text(data.eventId);
        if (!eventId) return corsJson(env, { success: false, error: "Missing eventId" }, 400);
        const [, eventResult, statsResult, surveysResult] = await Promise.all([
          requireAdmin(env, data),
          getEvent(env, { eventId }),
          getEventStats(env, { eventId }),
          getSurveys(env),
        ]);
        return corsJson(env, {
          success: eventResult.success,
          error: eventResult.error,
          event: eventResult.event,
          stats: statsResult.stats,
          surveys: surveysResult.surveys,
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
      if (action === "getConsultRequests") return corsJson(env, await getConsultRequests(env, data));
      if (action === "retryConsultNotification") return corsJson(env, await retryConsultNotification(env, data));
      if (action === "updateConsultStatus") return corsJson(env, await updateConsultStatus(env, data));
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
      return corsJson(env, { success: false, error: status < 500 ? error.message : "伺服器錯誤", code: status }, status);
    }
  },
};

async function runScheduledJobs(env, source) {
  await closeEndedEvents(env);
  await sendEventReminders(env);
  await sendPostEventSurveys(env);
  return { success: true, source };
}

function isInternalPushAuthorized(request, env) {
  const token = text(env.INTERNAL_PUSH_TOKEN);
  if (!token) return false;
  return text(request.headers.get("X-Internal-Token")) === token;
}

function isSchedulerAuthorized(request, env) {
  const token = text(env.SCHEDULER_TOKEN);
  if (!token) return false;
  const auth = text(request.headers.get("Authorization"));
  const headerToken = text(request.headers.get("X-Scheduler-Token"));
  return auth === `Bearer ${token}` || headerToken === token;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8" },
  });
}

// ── importBundle ──────────────────────────────────────────────────────────────

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
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(importId, new Date().toISOString(), events.length, registrationCount, surveys.length).run();

  return {
    success: true,
    importId,
    imported: {
      events: events.length,
      registrations: registrationCount,
      surveys: surveys.length,
    },
  };
}

async function checkRateLimit(env, request) {
  if (!env.PUBLIC_RATE_LIMITER) return true;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: ip });
  return success;
}
