// ── 里民諮詢服務預約 ───────────────────────────────────────────────────────────
// 取代舊系統那份把回覆公開在網頁上的 Notion 表單：資料只進 D1，
// 並透過通報中心（village-notify-hub）推播到里長群組。
import { text, taiwanIsoNow } from "./utils.js";
import { notifyHub } from "./line.js";
import {
  claimPublicDedupe,
  enforcePublicRateLimit,
  httpError,
  validatePublicFormEnvelope,
} from "./public-guard.js";

const CATEGORIES = ["法律諮詢", "清寒協助", "其它"];
const TIME_SLOTS = [
  "(吳秉翰 律師)週一 18:00~20:00",
  "(陳宗翰 律師)週二 18:00~20:00",
  "(王東元 律師)週五 18:00~20:00",
  "上午 08:00~12:00",
  "下午 14:00~17:00",
  "晚上 19:00~22:00",
];

export async function submitConsult(env, ctx, data, request) {
  const envelopeError = validatePublicFormEnvelope(data);
  if (envelopeError) throw httpError(400, "表單已失效，請重新整理後再試");
  await enforcePublicRateLimit(env, request, "consult-submit", 5, 60 * 60);

  const name = text(data.name).slice(0, 50);
  const phone = text(data.phone).slice(0, 30);
  const category = CATEGORIES.includes(text(data.category)) ? text(data.category) : "";
  const detail = text(data.detail).slice(0, 1000);
  const timeSlot = TIME_SLOTS.includes(text(data.timeSlot)) ? text(data.timeSlot) : "";
  const note = text(data.note).slice(0, 500);

  const normalizedPhone = phone.replace(/[^\d]/g, "");
  if (normalizedPhone.length < 8) return { success: false, error: "請留下正確的聯絡電話" };
  if (!category) return { success: false, error: "請選擇諮詢類別" };
  if (!detail) return { success: false, error: "請填寫諮詢事項說明" };
  if (!timeSlot) return { success: false, error: "請選擇預約時段" };

  const claimed = await claimPublicDedupe(
    env,
    "consult",
    [normalizedPhone, category, detail, timeSlot],
    5 * 60,
  );
  if (!claimed) throw httpError(429, "這份預約剛剛已送出，請勿重複送出");

  const consultId = "CSL" + Date.now().toString(36).toUpperCase() + crypto.randomUUID().slice(0, 4).toUpperCase();
  const submittedAt = taiwanIsoNow();

  await env.DB.prepare(
    `INSERT INTO consult_requests
       (consult_id, name, phone, category, detail, time_slot, note, line_user_id, display_name, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '待處理', ?)`,
  ).bind(
    consultId, name, phone, category, detail, timeSlot, note,
    text(data.lineUserId), text(data.lineDisplayName), submittedAt,
  ).run();

  const consult = { consultId, name, phone, category, detail, timeSlot, note, submittedAt };
  const push = deliverConsultNotification(env, consult);
  if (ctx?.waitUntil) ctx.waitUntil(push); else await push;

  return { success: true, consultId };
}

export async function getConsultRequests(env, data = {}) {
  const status = text(data.status);
  const rows = status
    ? await env.DB.prepare(
        `SELECT * FROM consult_requests WHERE status = ? ORDER BY submitted_at DESC LIMIT 200`,
      ).bind(status).all()
    : await env.DB.prepare(
        `SELECT * FROM consult_requests ORDER BY submitted_at DESC LIMIT 200`,
      ).all();
  return { success: true, consults: rows.results.map(mapConsultRow) };
}

export async function retryConsultNotification(env, data) {
  const consultId = text(data.consultId);
  if (!consultId) throw httpError(400, "Missing consultId");
  const row = await env.DB.prepare("SELECT * FROM consult_requests WHERE consult_id = ?")
    .bind(consultId).first();
  if (!row) throw httpError(404, "找不到這筆諮詢預約");
  const delivered = await deliverConsultNotification(env, mapConsultRow(row));
  if (!delivered) throw httpError(502, "通知送出失敗，請稍後再試");
  return { success: true, consultId };
}

export async function updateConsultStatus(env, data) {
  const consultId = text(data.consultId);
  const status = text(data.status);
  if (!consultId) throw httpError(400, "Missing consultId");
  if (!["待處理", "已聯繫", "已結案"].includes(status)) throw httpError(400, "Invalid status");
  const result = await env.DB.prepare("UPDATE consult_requests SET status = ? WHERE consult_id = ?")
    .bind(status, consultId).run();
  if (!Number(result.meta?.changes || 0)) throw httpError(404, "找不到這筆諮詢預約");
  return { success: true, consultId, status };
}

async function deliverConsultNotification(env, consult) {
  const delivered = await notifyHub(env, [buildConsultCard(consult)]);
  const notifiedAt = delivered ? taiwanIsoNow() : "";
  const error = delivered ? "" : "hub notify failed";
  await env.DB.prepare(
    `UPDATE consult_requests
        SET notify_status = ?, notify_error = ?, notify_attempts = notify_attempts + 1,
            notified_at = CASE WHEN ? <> '' THEN ? ELSE notified_at END
      WHERE consult_id = ?`,
  ).bind(delivered ? "sent" : "failed", error, notifiedAt, notifiedAt, consult.consultId).run();
  if (!delivered) console.error(JSON.stringify({ fn: "deliverConsultNotification", error, consultId: consult.consultId }));
  return delivered;
}

function mapConsultRow(row) {
  return {
    consultId: text(row.consult_id || row.consultId),
    name: text(row.name),
    phone: text(row.phone),
    category: text(row.category),
    detail: text(row.detail),
    timeSlot: text(row.time_slot || row.timeSlot),
    note: text(row.note),
    lineUserId: text(row.line_user_id || row.lineUserId),
    displayName: text(row.display_name || row.displayName),
    status: text(row.status),
    submittedAt: text(row.submitted_at || row.submittedAt),
    notifyStatus: text(row.notify_status || row.notifyStatus),
    notifyError: text(row.notify_error || row.notifyError),
    notifyAttempts: Number(row.notify_attempts || row.notifyAttempts || 0),
    notifiedAt: text(row.notified_at || row.notifiedAt),
  };
}

function buildConsultCard(c) {
  const row = (label, value) => ({
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#8C8C8C", flex: 2 },
      { type: "text", text: value || "—", size: "sm", color: "#111111", flex: 5, wrap: true },
    ],
  });
  const colors = { 法律諮詢: "#1D4ED8", 清寒協助: "#B45309", 其它: "#4B5563" };

  return {
    type: "flex",
    altText: `諮詢預約：${c.category}／${c.name || "里民"}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "12px",
        backgroundColor: colors[c.category] || "#4B5563",
        contents: [
          { type: "text", text: "📋 里民諮詢預約", color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: c.consultId, color: "#FFFFFFCC", size: "xs", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: c.category, weight: "bold", size: "lg", wrap: true },
          { type: "separator" },
          {
            type: "box", layout: "vertical", spacing: "sm",
            contents: [
              row("姓名", c.name),
              row("電話", c.phone),
              row("預約時段", c.timeSlot),
              row("諮詢事項", c.detail.length > 60 ? c.detail.slice(0, 60) + "…" : c.detail),
              ...(c.note ? [row("備註", c.note)] : []),
              row("送出時間", c.submittedAt),
            ],
          },
        ],
      },
      footer: {
        type: "box", layout: "vertical",
        contents: [
          {
            type: "button", style: "primary", color: "#1D4ED8", height: "sm",
            action: { type: "uri", label: "撥號給里民", uri: "tel:" + c.phone.replace(/[^\d+]/g, "") },
          },
        ],
      },
    },
  };
}
