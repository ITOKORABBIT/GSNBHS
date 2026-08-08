// ── 里民諮詢服務預約 ───────────────────────────────────────────────────────────
// 取代舊系統那份把回覆公開在網頁上的 Notion 表單：資料只進 D1，
// 並透過通報中心（village-notify-hub）推播到里長群組。
import { text, taiwanIsoNow } from "./utils.js";
import { notifyHub } from "./line.js";

const CATEGORIES = ["法律諮詢", "清寒協助", "其它"];
const TIME_SLOTS = [
  "(吳秉翰 律師)週一 18:00~20:00",
  "(陳宗翰 律師)週二 18:00~20:00",
  "(王東元 律師)週五 18:00~20:00",
  "上午 08:00~12:00",
  "下午 14:00~17:00",
  "晚上 19:00~22:00",
];

export async function submitConsult(env, ctx, data) {
  const name = text(data.name).slice(0, 50);
  const phone = text(data.phone).slice(0, 30);
  const category = CATEGORIES.includes(text(data.category)) ? text(data.category) : "";
  const detail = text(data.detail).slice(0, 1000);
  const timeSlot = TIME_SLOTS.includes(text(data.timeSlot)) ? text(data.timeSlot) : "";
  const note = text(data.note).slice(0, 500);

  if (!phone) return { success: false, error: "請留下聯絡電話" };
  if (!category) return { success: false, error: "請選擇諮詢類別" };
  if (!detail) return { success: false, error: "請填寫諮詢事項說明" };
  if (!timeSlot) return { success: false, error: "請選擇預約時段" };

  const consultId = "CSL" + Date.now().toString(36).toUpperCase();
  const submittedAt = taiwanIsoNow();

  await env.DB.prepare(
    `INSERT INTO consult_requests
       (consult_id, name, phone, category, detail, time_slot, note, line_user_id, display_name, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '待處理', ?)`,
  ).bind(
    consultId, name, phone, category, detail, timeSlot, note,
    text(data.lineUserId), text(data.lineDisplayName), submittedAt,
  ).run();

  // 推播給里長群組；失敗不影響里民端，但要留下明確錯誤記錄
  const push = notifyHub(env, [buildConsultCard({ consultId, name, phone, category, detail, timeSlot, note, submittedAt })])
    .then((ok) => {
      if (!ok) console.error(JSON.stringify({ fn: "submitConsult", error: "hub notify failed", consultId }));
    });
  if (ctx?.waitUntil) ctx.waitUntil(push); else await push;

  return { success: true, consultId };
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
