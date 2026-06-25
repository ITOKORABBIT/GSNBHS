// ── Google Drive upload helpers ───────────────────────────────────────────────
import { text, compactDate } from "./utils.js";

// Per-isolate access token cache.
let driveTokenCache = null;
let driveTokenExpiry = 0;

export async function getGoogleAccessToken(env) {
  if (driveTokenCache && Date.now() < driveTokenExpiry) return driveTokenCache;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("無法取得 Drive access token: " + JSON.stringify(json));
  driveTokenCache = json.access_token;
  driveTokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return driveTokenCache;
}

export async function uploadToDrive(env, b64, mimeType, fileName) {
  const accessToken = await getGoogleAccessToken(env);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  const boundary = `----Boundary${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: fileName, parents: [env.GOOGLE_DRIVE_FOLDER_ID] });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
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
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const file = await uploadRes.json();
  if (!file.id) throw new Error("Drive 上傳失敗: " + JSON.stringify(file));

  // Make file publicly readable so it can be displayed in the app.
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return `https://lh3.googleusercontent.com/d/${file.id}`;
}

export async function uploadEventImage(env, data, request) {
  const b64 = text(data.imageBase64);
  if (!b64) return { success: false, error: "Missing imageBase64" };
  if (b64.length * 0.75 > 2 * 1024 * 1024) return { success: false, error: "圖片過大，請壓縮至 2MB 以下" };
  const mimeType = text(data.mimeType) || "image/jpeg";

  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN && env.GOOGLE_DRIVE_FOLDER_ID) {
    const ext = mimeType.split("/")[1] || "jpg";
    const url = await uploadToDrive(env, b64, mimeType, `event_${compactDate()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
    return { success: true, url };
  }

  // Fallback: store in D1 (used before Drive credentials are configured).
  const imageId = `img_${compactDate()}_${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(
    "INSERT INTO image_uploads (image_id, mime_type, data_base64, uploaded_at) VALUES (?, ?, ?, ?)"
  ).bind(imageId, mimeType, b64, new Date().toISOString()).run();
  const origin = new URL(request.url).origin;
  return { success: true, url: `${origin}/img/${imageId}` };
}

export async function uploadPublicPhoto(env, data, request) {
  let b64 = text(data.imageBase64 || data.base64);
  if (!b64) return { success: false, error: "Missing imageBase64" };
  const commaIdx = b64.indexOf(",");
  if (commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
  if (b64.length * 0.75 > 2 * 1024 * 1024) return { success: false, error: "圖片過大，請壓縮至 2MB 以下" };
  const mimeType = text(data.mimeType) || "image/jpeg";

  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN && env.GOOGLE_DRIVE_FOLDER_ID) {
    const ext = mimeType.split("/")[1] || "jpg";
    const url = await uploadToDrive(env, b64, mimeType, `report_${compactDate()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
    return { success: true, url };
  }

  // Fallback: store in D1.
  const imageId = `img_${compactDate()}_${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(
    "INSERT INTO image_uploads (image_id, mime_type, data_base64, uploaded_at) VALUES (?, ?, ?, ?)"
  ).bind(imageId, mimeType, b64, new Date().toISOString()).run();
  const origin = new URL(request.url).origin;
  return { success: true, url: `${origin}/img/${imageId}` };
}
