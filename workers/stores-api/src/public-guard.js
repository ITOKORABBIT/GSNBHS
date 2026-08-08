export const PUBLIC_FORM_MIN_MS = 3000;
export const PUBLIC_FORM_MAX_MS = 2 * 60 * 60 * 1000;

export function validatePublicFormEnvelope(data, now = Date.now()) {
  if (cleanText(data.website)) return "bot_rejected";
  const formTs = Number.parseInt(data.formTs || "0", 10);
  const elapsed = now - formTs;
  if (!formTs || elapsed < PUBLIC_FORM_MIN_MS || elapsed > PUBLIC_FORM_MAX_MS) {
    return "form_expired";
  }
  return "";
}

export async function enforcePublicRateLimit(env, request, scope, limit, windowSeconds) {
  const subjectKey = await publicSubjectKey(request, scope);
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO public_rate_limits(scope, subject_key, window_start, request_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(scope, subject_key) DO UPDATE SET
       window_start = CASE WHEN public_rate_limits.window_start <= ? THEN excluded.window_start ELSE public_rate_limits.window_start END,
       request_count = CASE WHEN public_rate_limits.window_start <= ? THEN 1 ELSE public_rate_limits.request_count + 1 END
     RETURNING request_count`,
  ).bind(scope, subjectKey, now, cutoff, cutoff).first();
  if (Number(row?.request_count || 0) > limit) {
    throw httpError(429, "操作過於頻繁，請稍後再試");
  }
}

export async function claimPublicDedupe(env, scope, parts, ttlSeconds) {
  const dedupeKey = await sha256Key([scope, ...parts.map(cleanText)].join("|"));
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO public_submission_dedupe(dedupe_key, expires_at)
     VALUES (?, ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET expires_at = excluded.expires_at
       WHERE public_submission_dedupe.expires_at <= ?
     RETURNING dedupe_key`,
  ).bind(dedupeKey, expiresAt, now).first();
  return !!row;
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function publicSubjectKey(request, scope) {
  const forwarded = cleanText(request?.headers?.get("CF-Connecting-IP") || request?.headers?.get("X-Forwarded-For"));
  const ip = forwarded.split(",")[0].trim() || "unknown";
  return sha256Key(`${scope}|${ip}`);
}

async function sha256Key(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanText(value) {
  return String(value == null ? "" : value).trim();
}
