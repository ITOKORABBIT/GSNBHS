// ── Pure stateless utilities ─────────────────────────────────────────────────
// No imports — safe to import from anywhere.

export const CHECKIN_RADIUS_METERS = 100;

export function parseJson(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

export function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

export function parseBoolean(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

export function requireId(value, message) {
  const id = text(value);
  if (!id) throw httpError(400, message);
  return id;
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ── Taiwan-time helpers ──────────────────────────────────────────────────────

export function compactDate() {
  const ms = Date.now() + 8 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

// Parse a Taiwan-local ISO string (YYYY-MM-DDTHH:MM) to UTC ms.
export function parseTaiwanIsoToMs(value) {
  if (!value) return NaN;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]);
  const d = new Date(value);
  return isNaN(d) ? NaN : d.getTime();
}

// Current Taiwan time as YYYY-MM-DDTHH:MM (for D1 comparisons).
export function taiwanIsoNow() {
  const ms = Date.now() + 8 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 16);
}

export function taiwanIsoMinutesAgo(minutes) {
  const ms = Date.now() + 8 * 60 * 60 * 1000 - minutes * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 16);
}

export function getTaiwanDateStr(value) {
  if (!value) return "";
  const s = String(value);
  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (mIso) return mIso[1] + "/" + mIso[2] + "/" + mIso[3];
  const mSlash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (mSlash) return mSlash[1] + "/" + String(mSlash[2]).padStart(2, "0") + "/" + String(mSlash[3]).padStart(2, "0");
  const mDash = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mDash) return mDash[1] + "/" + mDash[2] + "/" + mDash[3];
  const d = new Date(s);
  if (isNaN(d)) return "";
  const twMs = d.getTime() + 8 * 60 * 60 * 1000;
  const tw = new Date(twMs);
  return [tw.getUTCFullYear(), String(tw.getUTCMonth() + 1).padStart(2, "0"), String(tw.getUTCDate()).padStart(2, "0")].join("/");
}

// ── Registration window check ────────────────────────────────────────────────

export function isWithinRegWindow(event) {
  const now = Date.now();
  const regStart = event.registrationStart ? parseTaiwanIsoToMs(event.registrationStart) : 0;
  const regEnd = event.registrationEnd ? parseTaiwanIsoToMs(event.registrationEnd) : Infinity;
  return now >= regStart && now <= regEnd;
}
