import { text, parseJson } from "./utils.js";

export const ACTIVE_RESERVATION_MINUTES = 10;
export const REGISTRATION_FULL_MESSAGE = "目前沒有名額釋出，請稍後再試";
export const RESERVATION_EXPIRED_MESSAGE = "您的報名保留時間已超過 10 分鐘，名額已釋出。若仍要報名，請重新輸入「我要報名」。";

export async function getActiveReservationCount(env, eventId, nowIso = new Date().toISOString()) {
  if (!env.DB || !eventId) return 0;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM event_reservations
      WHERE event_id = ? AND status = 'active' AND expires_at > ?`,
  ).bind(eventId, nowIso).first();
  return Number(row?.count || 0);
}

export async function reserveRegistrationSlot(env, { eventId, userId }) {
  if (!env.DB || !eventId || !userId) return { success: true, reservationId: "", expiresAt: "" };
  const now = new Date();
  const nowIso = now.toISOString();
  const existing = await env.DB.prepare(
    `SELECT reservation_id, expires_at FROM event_reservations
      WHERE event_id = ? AND user_id = ? AND status = 'active' AND expires_at > ?`,
  ).bind(eventId, userId, nowIso).first();
  if (existing) return { success: true, reservationId: text(existing.reservation_id), expiresAt: text(existing.expires_at) };
  const eventRow = await env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first();
  if (!eventRow) return { success: false, error: "找不到活動" };
  const quota = parseInt(text(parseJson(eventRow.payload_json).quota), 10) || 0;
  const expiresAt = new Date(now.getTime() + ACTIVE_RESERVATION_MINUTES * 60 * 1000).toISOString();
  const reservationId = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT INTO event_reservations (reservation_id, event_id, user_id, status, created_at, expires_at)
     SELECT ?, ?, ?, 'active', ?, ?
      WHERE ? <= 0 OR (
        (SELECT COALESCE(SUM(headcount), 0) FROM event_registrations WHERE event_id = ?)
        + (SELECT COUNT(*) FROM event_reservations WHERE event_id = ? AND status = 'active' AND expires_at > ?)
      ) < ?`,
  ).bind(reservationId, eventId, userId, nowIso, expiresAt, quota, eventId, eventId, nowIso, quota).run();
  return result?.meta?.changes ? { success: true, reservationId, expiresAt } : { success: false, error: REGISTRATION_FULL_MESSAGE };
}

export async function releaseRegistrationSlot(env, reservationId) {
  if (!env.DB || !reservationId) return;
  await env.DB.prepare("UPDATE event_reservations SET status = 'released' WHERE reservation_id = ? AND status = 'active'").bind(reservationId).run();
}

export async function consumeRegistrationSlot(env, reservationId) {
  if (!env.DB || !reservationId) return;
  await env.DB.prepare("UPDATE event_reservations SET status = 'consumed' WHERE reservation_id = ? AND status = 'active'").bind(reservationId).run();
}

export function isReservationExpired(state, nowMs = Date.now()) {
  return !!state?.reservationExpiresAt && Date.parse(state.reservationExpiresAt) <= nowMs;
}
