// ── LINE Webhook Handler, chatbot state machine, message builders ─────────────
import { text, parseJson, parseBoolean, parseTaiwanIsoToMs, taiwanIsoNow, isWithinRegWindow, CHECKIN_RADIUS_METERS } from "./utils.js";
import { forwardToGas } from "./auth.js";
import { getEventPayload, upsertRegistrationStatement, syncEventRegisteredCount } from "./db.js";
import { getEmergencyContactsForLine } from "./contacts.js";
import { insertChatMessage } from "./chat.js";

// ── Constants ────────────────────────────────────────────────────────────────

const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";
const LINE_MULTICAST_API = "https://api.line.me/v2/bot/message/multicast";
export const SURVEY_BASE_URL = "https://gsnbhs.pages.dev/survey";
const VOUCHER_URL = "https://gsnbhs.pages.dev/voucher.html";
const STORE_DETAIL_URL = "https://gsnbhs.pages.dev/storeopendetail.html?id=";
const STORE_LIST_URL = "https://gsnbhs.pages.dev/storeopenlist.html";
const STORE_IMG_FALLBACK = "https://lh3.googleusercontent.com/d/1GAb13SxqDBjTnnwZZjNubyJEWxqibs-Z";
const EVENT_IMG_FALLBACK = "https://gsnbhs.pages.dev/HP_logo.png";
const KV_SESSION_TTL = 6 * 60 * 60; // seconds

const EVT_START_RE = /^(我要報名|活動報名|報名活動|報名|活動查詢)$/;
const EVT_LOOKUP_RE = /^(查詢報名|報名查詢|查報名|有沒有報名成功)$/;
const EVT_CANCEL_RE = /^(取消|離開|結束|不報了|算了)$/;
const EVT_WALKIN_QR_RE = /^現場報名_(EVT[\w]+)$/;

const RPT_TYPES = ["道路及交通", "環境及衛生", "公共設施", "安全疑慮", "其他"];
const RPT_START_RE = /^(我要通報|通報問題|里民通報|問題通報)$/;
const RPT_CANCEL_RE_R = /^(取消|離開|結束|算了|不通報了)$/;

// 圖文選單噪音問題已用 postback 解決，AI 留言蒐集暫時停用（先掛著、保留程式碼，
// 之後若需要再開回 true 即可）。停用時點「只想聊聊」只會提示直接留言，
// 不會啟動 AI 對話、不會寫入 chat_messages。
const CHAT_FEATURE_ENABLED = false;
const CHAT_START_RE = /^(我要聊天)$/;
const CHAT_EXIT_RE = /^(結束聊天|不聊了|掰掰|再見|返回主選單|我要通報)$/;
const CHAT_MODEL = "claude-haiku-4-5";
const CHAT_MAX_HISTORY = 16; // 最多保留最近 16 則訊息（user+assistant）
const CHAT_SYSTEM_PROMPT =
  "你是「舊社里小幫手」LINE官方帳號裡的留言蒐集小助手，使用台灣繁體中文，個性親切、簡潔、口語化。" +
  "你的任務只有一件事：幫里長蒐集里民想說的話，完全不負責回答任何問題、不提供任何建議或資訊、不發表意見。" +
  "規則：" +
  "1. 不論里民問什麼問題（包括時間、地點、政策、活動、辦公處資訊等），都不要回答，只能親切地回應「已經幫您記錄下來了，會轉達給里長」，並視需要追問細節（例如地點、聯絡方式）讓留言更完整。" +
  "2. 絕對不要提供任何答案、知識、建議、評論或猜測，即使你知道答案也不能說。" +
  "3. 每次回覆都要簡短（1-2句話），只做「確認收到」與「追問細節」這兩件事。" +
  "4. 如果里民詢問緊急狀況（火警、意外、急病等），請提醒他直接撥打119/110，這是唯一的例外。" +
  "5. 不要說「我不知道」或長篇解釋你的限制，只要持續扮演「正在記錄留言的小幫手」即可。";

const LINE_CATEGORY_MAP = {
  美食地圖: ["美食地圖","美食","餐廳","吃的","飲食","早餐","午餐","晚餐","宵夜","點心"],
  飲料冰品: ["飲料冰品","飲料","冰品","手搖","咖啡"],
  健康醫療: ["健康醫療","醫療","診所","藥局","牙醫","中醫"],
  生活便利: ["生活便利","生活","美容","健身","攝影","維修"],
  住宅相關: ["住宅相關","住宅","居家","裝修","房屋"],
  寵物專區: ["寵物專區","寵物","毛孩","貓","狗"],
  其他: ["其他","其它"],
};
const LINE_CATEGORY_INFO = {
  美食地圖: { title: "美食地圖", emoji: "🍽", subtitle: "在地餐廳 / 小吃", color: "#10B981" },
  飲料冰品: { title: "飲料冰品", emoji: "🥤", subtitle: "手搖飲 / 咖啡 / 冰品", color: "#3B82F6" },
  健康醫療: { title: "健康醫療", emoji: "🏥", subtitle: "診所 / 藥局", color: "#8B5CF6" },
  生活便利: { title: "生活便利", emoji: "🧺", subtitle: "美容 / 健身 / 生活服務", color: "#0EA5E9" },
  住宅相關: { title: "住宅相關", emoji: "🏠", subtitle: "居家 / 裝修服務", color: "#F59E0B" },
  寵物專區: { title: "寵物專區", emoji: "🐾", subtitle: "毛孩相關服務", color: "#EC4899" },
  其他: { title: "其他", emoji: "✨", subtitle: "其他特約商家", color: "#64748B" },
};
const MENU_LABELS = {
  news: "最新消息",
  course: "教育課程",
  apply_event: "活動報名",
  apply_course: "課程報名",
};
const FOOD_MAP_MENU_ITEMS = [
  { title: "美食地圖", emoji: "🍽", text: "美食地圖", color: "#10B981", desc: "在地餐廳、小吃特約優惠。" },
  { title: "飲料冰品", emoji: "🥤", text: "飲料冰品", color: "#3B82F6", desc: "手搖飲、咖啡、冰品特約優惠。" },
  { title: "健康醫療", emoji: "🏥", text: "健康醫療", color: "#8B5CF6", desc: "診所、藥局特約優惠。" },
  { title: "生活便利", emoji: "🧺", text: "生活便利", color: "#0EA5E9", desc: "美容、健身等生活服務。" },
  { title: "住宅相關", emoji: "🏠", text: "住宅相關", color: "#F59E0B", desc: "居家、裝修相關服務。" },
  { title: "寵物專區", emoji: "🐾", text: "寵物專區", color: "#EC4899", desc: "毛孩美容、用品等服務。" },
  { title: "申請特約", emoji: "📝", text: "商家申請", color: "#94A3B8", desc: "開放後可由商家自行提出申請。" },
];

// ── Webhook entry point ───────────────────────────────────────────────────────

export async function handleLineWebhook(request, env, ctx) {
  const body = await request.text();
  if (!await verifyLineSignature(env, request.headers.get("x-line-signature") || "", body)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let data;
  try { data = JSON.parse(body); } catch { return new Response("Bad Request", { status: 400 }); }
  const events = Array.isArray(data.events) ? data.events : [];
  ctx.waitUntil(processLineEvents(env, ctx, events));
  return new Response("OK", { status: 200 });
}

async function verifyLineSignature(env, signature, body) {
  if (!signature || !env.LINE_CHANNEL_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.LINE_CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(raw))) === signature;
}

async function processLineEvents(env, ctx, events) {
  for (const event of events) {
    try { await processLineEvent(env, ctx, event); }
    catch (err) { console.error(JSON.stringify({ type: "line_event_error", error: err.message })); }
  }
}

async function processLineEvent(env, ctx, event) {
  if (!event?.source?.userId) return;
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  let handled = false;
  try {
    handled = await handleLineMenuEvent(env, userId, replyToken, event);
  } catch (err) {
    console.error(JSON.stringify({ fn: "handleLineMenuEvent", error: err.message }));
  }
  if (!handled) {
    try {
      handled = await handleLineRegEvent(env, ctx, userId, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineRegEvent", userId, error: err.message }));
    }
  }
  if (!handled) {
    try {
      handled = await handleLineReportEvent(env, userId, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineReportEvent", error: err.message }));
    }
  }
  if (!handled) {
    try {
      handled = await handleLineChatEvent(env, userId, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineChatEvent", error: err.message }));
    }
  }
  if (!handled) {
    try {
      handled = await handleLineKeywordEvent(env, replyToken, event);
    } catch (err) {
      console.error(JSON.stringify({ fn: "handleLineKeywordEvent", error: err.message }));
    }
  }
  if (!handled && env.GAS_SCRIPT_URL) {
    await forwardLineEventToGas(env, event);
  }
}

// ── Registration state machine ────────────────────────────────────────────────

async function handleLineRegEvent(env, ctx, userId, replyToken, event) {
  const state = await getEvtSession(env, userId);
  const hasSess = !!state.stage;

  if (event.type === "postback") {
    const pb = parsePostbackData(event.postback?.data || "");
    if (!hasSess && !(pb.action && pb.action.startsWith("evt:"))) return false;
    await handleEvtPostback(env, ctx, userId, replyToken, state, pb);
    return true;
  }

  if (event.type === "message" && event.message?.type === "location") {
    if (state.stage === "checkin_location") {
      await handleEvtCheckinLocation(env, userId, replyToken, state, event.message);
      return true;
    }
    return false;
  }

  if (event.type === "message" && event.message?.type === "text") {
    const msg = String(event.message.text || "").trim();
    if (hasSess) {
      await handleEvtText(env, userId, replyToken, state, msg);
      return true;
    }
    if (EVT_START_RE.test(msg)) {
      await handleEvtStart(env, userId, replyToken);
      return true;
    }
    if (EVT_LOOKUP_RE.test(msg)) {
      await lineReply(env, replyToken, [buildEvtDuplicateSubmitMessage(await findRecentLineRegistration(env, userId, 24 * 60))]);
      return true;
    }
    const walkInMatch = msg.match(EVT_WALKIN_QR_RE);
    if (walkInMatch) {
      await handleEvtWalkInQR(env, userId, replyToken, walkInMatch[1]);
      return true;
    }
    if (/^\d{4}$/.test(msg)) {
      await handleWalkInPin(env, userId, replyToken, msg);
      return true;
    }
  }
  return false;
}

async function handleEvtStart(env, userId, replyToken) {
  const events = await getActiveEventsForLine(env);
  if (!events.length) return lineReply(env, replyToken, [{ type: "text", text: "目前沒有開放報名的活動，請稍後再查詢。" }]);
  return lineReply(env, replyToken, [buildEvtListCarousel(events)]);
}

async function handleEvtWalkInQR(env, userId, replyToken, eventId) {
  const event = await getEventPayload(env, eventId);
  if (!event || !event.eventId) {
    return lineReply(env, replyToken, [{ type: "text", text: "找不到此活動，請向現場工作人員確認。" }]);
  }
  const status = text(event.status);
  if (status === "已結束" || status === "已取消") {
    return lineReply(env, replyToken, [{ type: "text", text: `「${text(event.eventName)}」已結束，無法報名。` }]);
  }
  const requireConsent = parseBoolean(event.requireConsent);
  const questions = Array.isArray(event.questions) ? event.questions : [];
  const sessionData = {
    stage: requireConsent ? "consent" : "answering",
    eventId,
    eventName: text(event.eventName),
    requireConsent,
    reminderTime: text(event.reminderTime) || "",
    questions,
    qIdx: 0, answers: [], multiBuffer: [],
    consentGiven: false,
    walkIn: true,
  };
  await saveEvtSession(env, userId, sessionData);
  const greeting = { type: "text", text: `歡迎參加「${text(event.eventName)}」！\n接下來請填寫報名資料 👇` };
  if (requireConsent) {
    return lineReply(env, replyToken, [greeting, buildEvtConsentBubble()]);
  }
  if (!questions.length) return advanceAfterAnswering(env, userId, replyToken, sessionData);
  return lineReply(env, replyToken, [greeting, ...buildEvtQuestionMsgs(questions[0], 0, questions.length)]);
}

async function handleWalkInPin(env, userId, replyToken, pin) {
  const row = await env.DB.prepare(
    `SELECT payload_json FROM events
     WHERE event_id LIKE ?
       AND (json_extract(payload_json,'$.status') IS NULL
            OR json_extract(payload_json,'$.status') NOT IN ('已結束','已取消'))
     ORDER BY json_extract(payload_json,'$.eventStart') DESC
     LIMIT 1`
  ).bind(`%_${pin}`).first();
  if (!row) {
    return lineReply(env, replyToken, [{ type: "text", text: `找不到報名碼「${pin}」對應的活動，請向現場工作人員確認。` }]);
  }
  const event = parseJson(row.payload_json);
  const eventId = event.eventId;
  const eventName = text(event.eventName);

  const regRows = await env.DB.prepare(
    `SELECT reg_id, display_name, checked_in FROM event_registrations
     WHERE event_id = ? AND line_user_id = ?`
  ).bind(eventId, userId).all();

  if (!regRows.results.length) {
    return handleEvtWalkInQR(env, userId, replyToken, eventId);
  }

  const regs = regRows.results;
  const allChecked = regs.every(r => r.checked_in === "TRUE");
  const nameList = regs.map(r =>
    `・${r.display_name || "（未取得名稱）"}${r.checked_in === "TRUE" ? " ✅" : ""}`
  ).join("\n");

  const footerBtns = [];
  if (!allChecked) {
    footerBtns.push({
      type: "button", style: "primary", color: "#1565c0", height: "sm",
      action: { type: "postback", label: "✅ 我要簽到", data: `action=evt:walkin_checkin&eventId=${eventId}` },
    });
  }
  footerBtns.push({
    type: "button", style: allChecked ? "primary" : "secondary", height: "sm",
    action: { type: "postback", label: "📝 幫別人報名", data: `action=evt:walkin_register&eventId=${eventId}` },
  });

  const bubble = {
    type: "flex", altText: "請選擇操作",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: "#1565c0", paddingAll: "14px",
        contents: [{ type: "text", text: `📋 ${eventName}`, color: "#ffffff", weight: "bold", size: "sm", wrap: true }] },
      body: { type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: "您已有以下報名記錄：", size: "sm", color: "#4b5563" },
          { type: "text", text: nameList, size: "sm", color: "#1f2937", wrap: true },
          ...(allChecked ? [{ type: "text", text: "已全部完成簽到 ✅", size: "sm", color: "#2f6836", margin: "md", wrap: true }] : []),
        ],
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: footerBtns },
    },
  };
  return lineReply(env, replyToken, [bubble]);
}

async function handleEvtText(env, userId, replyToken, state, msg) {
  if (EVT_CANCEL_RE.test(msg)) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "已取消報名流程。若需要再次報名請輸入「我要報名」。" }]);
  }
  if (state.stage === "answering") {
    const q = (state.questions || [])[state.qIdx];
    if (q && (q.type === "text" || q.type === "number")) {
      state.answers = state.answers || [];
      state.answers.push({ qIdx: state.qIdx, type: q.type, label: q.label, value: msg.substring(0, q.maxLength || 100) });
      state.qIdx++;
      await saveEvtSession(env, userId, state);
      if (state.qIdx >= (state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
      return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[state.qIdx], state.qIdx, state.questions.length));
    }
  }
  return lineReply(env, replyToken, [{ type: "text", text: "請依提示操作，或輸入「取消」結束報名。" }]);
}

async function handleEvtPostback(env, ctx, userId, replyToken, state, pb) {
  const action = pb.action || "";

  if (action === "evt:start") return handleEvtStart(env, userId, replyToken);

  if (action === "evt:select") {
    const events = await getActiveEventsForLine(env);
    const ev = events.find((e) => e.eventId === pb.eventId);
    if (!ev) return lineReply(env, replyToken, [{ type: "text", text: "找不到此活動，請重新輸入「我要報名」。" }]);
    if (ev.isFull) return lineReply(env, replyToken, [{ type: "text", text: `「${ev.eventName}」名額已滿，無法報名。` }]);
    const eventData = await getEventPayload(env, pb.eventId);
    if (!eventData) return lineReply(env, replyToken, [{ type: "text", text: "找不到此活動，請重新輸入「我要報名」。" }]);
    await saveEvtSession(env, userId, {
      stage: "confirm_event",
      eventId: pb.eventId,
      eventName: ev.eventName,
      requireConsent: ev.requireConsent,
      reminderTime: text(ev.reminderTime) || "",
      questions: eventData.questions || [],
      qIdx: 0, answers: [], multiBuffer: [],
    });
    const msgs = [];
    if (ev.imageUrl) msgs.push({ type: "image", originalContentUrl: ev.imageUrl, previewImageUrl: ev.imageUrl });
    msgs.push(buildEvtConfirmBubble(ev));
    return lineReply(env, replyToken, msgs);
  }

  if (action === "evt:confirm_yes") {
    if (!state.stage) return lineReply(env, replyToken, [{ type: "text", text: "操作逾時，請重新輸入「我要報名」。" }]);
    if (state.stage !== "confirm_event") return; // duplicate postback, already past this step
    if (state.requireConsent) {
      state.stage = "consent";
      await saveEvtSession(env, userId, state);
      return lineReply(env, replyToken, [buildEvtConsentBubble()]);
    }
    state.stage = "answering";
    await saveEvtSession(env, userId, state);
    if (!(state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[0], 0, state.questions.length));
  }

  if (action === "evt:confirm_no") {
    await clearEvtSession(env, userId);
    const events = await getActiveEventsForLine(env);
    return events.length
      ? lineReply(env, replyToken, [{ type: "text", text: "沒關係！請從下方選擇其他活動：" }, buildEvtListCarousel(events)])
      : lineReply(env, replyToken, [{ type: "text", text: "好的，已取消。若需要報名請輸入「我要報名」。" }]);
  }

  if (action === "evt:consent_yes") {
    if (state.stage !== "consent") {
      if (!state.stage) return lineReply(env, replyToken, [{ type: "text", text: "操作逾時，請重新輸入「我要報名」。" }]);
      return; // duplicate postback mid-flow
    }
    state.stage = "answering";
    state.consentGiven = true;
    await saveEvtSession(env, userId, state);
    if (!(state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[0], 0, state.questions.length));
  }

  if (action === "evt:consent_no") {
    if (state.stage !== "consent") {
      if (!state.stage) return lineReply(env, replyToken, [{ type: "text", text: "操作逾時，請重新輸入「我要報名」。" }]);
      return; // duplicate postback mid-flow
    }
    state.stage = "answering";
    state.consentGiven = false;
    await saveEvtSession(env, userId, state);
    if (!(state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, [
      { type: "text", text: "了解！報名仍可繼續，活動拍攝時工作人員會留意避開。" },
      ...buildEvtQuestionMsgs(state.questions[0], 0, state.questions.length),
    ]);
  }

  if (action === "evt:remind_yes") {
    if (state.stage !== "reminder_opt_in") return lineReply(env, replyToken, await buildEvtStaleReminderMessages(env, userId, state));
    state.wantsReminder = true;
    await saveEvtSession(env, userId, state);
    return sendEvtSummary(env, userId, replyToken, state);
  }

  if (action === "evt:remind_no") {
    if (state.stage !== "reminder_opt_in") return lineReply(env, replyToken, await buildEvtStaleReminderMessages(env, userId, state));
    state.wantsReminder = false;
    await saveEvtSession(env, userId, state);
    return sendEvtSummary(env, userId, replyToken, state);
  }

  if (action === "evt:answer") {
    if (state.stage !== "answering") {
      if (!state.stage) return lineReply(env, replyToken, [{ type: "text", text: "操作逾時，請重新輸入「我要報名」。" }]);
      return; // duplicate postback mid-flow
    }
    const q = (state.questions || [])[state.qIdx];
    if (!q) return;
    if (q.type === "single" || q.type === "scale" || q.type === "headcount") {
      state.answers.push({ qIdx: state.qIdx, type: q.type, label: q.label, value: pb.value });
      state.qIdx++;
      await saveEvtSession(env, userId, state);
      if (state.qIdx >= state.questions.length) return advanceAfterAnswering(env, userId, replyToken, state);
      return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[state.qIdx], state.qIdx, state.questions.length));
    }
    if (q.type === "multi") {
      state.multiBuffer = state.multiBuffer || [];
      const idx = state.multiBuffer.indexOf(pb.value);
      if (idx >= 0) state.multiBuffer.splice(idx, 1);
      else state.multiBuffer.push(pb.value);
      await saveEvtSession(env, userId, state);
      return lineReply(env, replyToken, [{ type: "text", text: buildMultiStatusText(state.multiBuffer) }]);
    }
    return;
  }

  if (action === "evt:multi_done") {
    if (state.stage !== "answering") return;
    const q2 = (state.questions || [])[state.qIdx];
    const sel = state.multiBuffer || [];
    if (q2?.required && !sel.length) return lineReply(env, replyToken, [{ type: "text", text: "此題為必填，請至少選一個選項。" }]);
    state.answers.push({ qIdx: state.qIdx, type: "multi", label: q2?.label || "", value: sel });
    state.multiBuffer = [];
    state.qIdx++;
    await saveEvtSession(env, userId, state);
    if (state.qIdx >= (state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[state.qIdx], state.qIdx, state.questions.length));
  }

  if (action === "evt:skip") {
    if (state.stage !== "answering") return;
    const q3 = (state.questions || [])[state.qIdx];
    state.answers.push({ qIdx: state.qIdx, type: q3?.type || "text", label: q3?.label || "", value: "（略過）" });
    state.multiBuffer = [];
    state.qIdx++;
    await saveEvtSession(env, userId, state);
    if (state.qIdx >= (state.questions || []).length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, buildEvtQuestionMsgs(state.questions[state.qIdx], state.qIdx, state.questions.length));
  }

  if (action === "evt:submit") {
    if (state.stage !== "summary") return;
    const result = await submitRegistrationFromLine(env, ctx, userId, state);
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, result.success
      ? [buildEvtSuccessBubble(state)]
      : [{ type: "text", text: "⚠️ " + (result.error || "報名失敗，請稍後再試") }],
    );
  }

  if (action === "evt:edit") {
    if (state.stage !== "summary") return;
    state.stage = "answering";
    state.qIdx = 0;
    state.answers = [];
    state.multiBuffer = [];
    await saveEvtSession(env, userId, state);
    const qs = state.questions || [];
    if (!qs.length) return advanceAfterAnswering(env, userId, replyToken, state);
    return lineReply(env, replyToken, [
      { type: "text", text: "請重新回答以下問題：" },
      ...buildEvtQuestionMsgs(qs[0], 0, qs.length),
    ]);
  }

  if (action === "evt:walkin_checkin") {
    const eventId = text(pb.eventId);
    if (!eventId) return lineReply(env, replyToken, [{ type: "text", text: "操作逾時，請重新輸入報名碼。" }]);
    const event = await getEventPayload(env, eventId);
    if (!event) return lineReply(env, replyToken, [{ type: "text", text: "找不到此活動，請重新輸入報名碼。" }]);
    const uncheckedRows = await getUncheckedRegistrationsForLine(env, eventId, userId);
    if (!uncheckedRows.length) {
      return lineReply(env, replyToken, [{ type: "text", text: `您的報名已完成簽到 ✅` }]);
    }
    if (parseBoolean(event.checkinLocationRequired)) {
      const center = getEventCheckinCenter(event);
      if (!center) {
        return lineReply(env, replyToken, [{ type: "text", text: "此活動尚未設定有效的簽到中心點，請洽現場工作人員。" }]);
      }
      await saveEvtSession(env, userId, {
        stage: "checkin_location",
        eventId,
        eventName: text(event.eventName),
      });
      return lineReply(env, replyToken, [buildCheckinLocationRequestMessage(event)]);
    }
    await completeLineCheckin(env, eventId, userId, uncheckedRows);
    return lineReply(env, replyToken, [{ type: "text", text: `✅ 簽到完成！\n感謝您參加「${text(event.eventName) || eventId}」！` }]);
  }

  if (action === "evt:walkin_register") {
    const eventId = text(pb.eventId);
    if (!eventId) return lineReply(env, replyToken, [{ type: "text", text: "操作逾時，請重新輸入報名碼。" }]);
    return handleEvtWalkInQR(env, userId, replyToken, eventId);
  }
}

async function handleEvtCheckinLocation(env, userId, replyToken, state, message) {
  const eventId = text(state.eventId);
  if (!eventId) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "簽到流程已逾時，請重新輸入報名碼。" }]);
  }
  const event = await getEventPayload(env, eventId);
  if (!event) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "找不到此活動，請向現場工作人員確認。" }]);
  }
  const uncheckedRows = await getUncheckedRegistrationsForLine(env, eventId, userId);
  if (!uncheckedRows.length) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "您的報名已完成簽到 ✅" }]);
  }
  const center = getEventCheckinCenter(event);
  if (!center) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "此活動尚未設定有效的簽到中心點，請洽現場工作人員。" }]);
  }
  const lat = Number(message.latitude);
  const lng = Number(message.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return lineReply(env, replyToken, [buildCheckinLocationRequestMessage(event, "沒有取得有效定位，請再傳送一次目前位置。")]);
  }
  const distanceMeters = Math.round(distanceMetersBetween(lat, lng, center.lat, center.lng));
  if (distanceMeters > CHECKIN_RADIUS_METERS) {
    await clearEvtSession(env, userId);
    return lineReply(env, replyToken, [{ type: "text", text: "需在活動場地範圍內才能簽到，如有問題請找里長手動簽到。" }]);
  }
  await completeLineCheckin(env, eventId, userId, uncheckedRows, { lat, lng, distanceMeters });
  await clearEvtSession(env, userId);
  return lineReply(env, replyToken, [{ type: "text", text: `✅ 簽到完成！\n目前距離活動地點約 ${distanceMeters} 公尺。\n感謝您參加「${text(event.eventName) || eventId}」！` }]);
}

async function getUncheckedRegistrationsForLine(env, eventId, userId) {
  const rows = await env.DB.prepare(
    "SELECT reg_id FROM event_registrations WHERE event_id = ? AND line_user_id = ? AND checked_in != 'TRUE'",
  ).bind(eventId, userId).all();
  return rows.results || [];
}

async function completeLineCheckin(env, eventId, userId, uncheckedRows, location) {
  const now = new Date().toISOString();
  const rows = Array.isArray(uncheckedRows) ? uncheckedRows : [];
  if (!rows.length) return;
  const statements = rows.map((row) => {
    if (location) {
      return env.DB.prepare(
        `UPDATE event_registrations
            SET checked_in = 'TRUE',
                payload_json = json_set(payload_json,
                  '$.checkedIn', 'TRUE',
                  '$.checkinAt', ?,
                  '$.checkinLat', ?,
                  '$.checkinLng', ?,
                  '$.checkinDistanceMeters', ?)
          WHERE event_id = ? AND reg_id = ? AND line_user_id = ?`,
      ).bind(now, location.lat, location.lng, location.distanceMeters, eventId, row.reg_id, userId);
    }
    return env.DB.prepare(
      `UPDATE event_registrations
          SET checked_in = 'TRUE',
              payload_json = json_set(payload_json,'$.checkedIn','TRUE','$.checkinAt',?)
        WHERE event_id = ? AND reg_id = ? AND line_user_id = ?`,
    ).bind(now, eventId, row.reg_id, userId);
  });
  await env.DB.batch(statements);
}

function getEventCheckinCenter(event) {
  const lat = Number(event.checkinLatitude);
  const lng = Number(event.checkinLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function distanceMetersBetween(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => deg * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildCheckinLocationRequestMessage(event, prefix) {
  const textLines = [];
  if (prefix) textLines.push(prefix);
  textLines.push("請點選下方按鈕傳送目前位置，並按右上角「分享」，已完成自動簽到。");
  return {
    type: "text",
    text: textLines.join("\n"),
    quickReply: {
      items: [{
        type: "action",
        action: { type: "location", label: "傳送目前位置" },
      }],
    },
  };
}

async function advanceAfterAnswering(env, userId, replyToken, state) {
  const hasReminder = state.reminderTime && state.reminderTime !== "none";
  if (hasReminder && state.wantsReminder == null) {
    state.stage = "reminder_opt_in";
    await saveEvtSession(env, userId, state);
    return lineReply(env, replyToken, [buildEvtReminderOptInBubble(state)]);
  }
  return sendEvtSummary(env, userId, replyToken, state);
}

async function sendEvtSummary(env, userId, replyToken, state) {
  state.stage = "summary";
  if (!state.summaryIssuedAt) state.summaryIssuedAt = new Date().toISOString();
  ensureEvtSubmissionId(state, userId);
  await saveEvtSession(env, userId, state);
  return lineReply(env, replyToken, [buildEvtSummaryBubble(state)]);
}

async function submitRegistrationFromLine(env, ctx, userId, state) {
  try {
    const event = await getEventPayload(env, state.eventId);
    if (!event) return { success: false, error: "找不到活動" };
    if (text(event.status) !== "報名中") return { success: false, error: "此活動報名已截止" };
    if (!isWithinRegWindow(event)) return { success: false, error: "此活動目前不在開放報名期間" };

    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ?",
    ).bind(state.eventId).first();
    const regCount = Number(countRow?.cnt || 0);
    const quota = parseInt(text(event.quota)) || 0;
    if (quota > 0 && regCount >= quota) return { success: false, error: "此活動名額已滿" };

    let displayName = "";
    if (env.LINE_CHANNEL_ACCESS_TOKEN) {
      try {
        const profileResp = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
          headers: { Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN },
        });
        const profile = await profileResp.json();
        displayName = text(profile.displayName);
      } catch {}
    }

    const now = new Date();
    const regId = ensureEvtSubmissionId(state, userId);
    const answerMap = {};
    const sessionQuestions = state.questions || [];
    for (const a of state.answers || []) {
      const q = sessionQuestions[a.qIdx];
      const key = q?.id || text(a.label);
      if (key) answerMap[key] = Array.isArray(a.value) ? a.value.join("、") : text(a.value);
    }

    const reg = {
      regId, eventId: state.eventId, lineUserId: userId, displayName,
      consentGiven: state.consentGiven !== false ? "TRUE" : "FALSE",
      lineReminderOptIn: state.wantsReminder === true ? "TRUE" : "FALSE",
      submittedAt: now.toISOString(), headcount: "1", checkedIn: state.walkIn ? "TRUE" : "FALSE",
      ...answerMap,
    };
    await upsertRegistrationStatement(env, state.eventId, reg).run();
    await syncEventRegisteredCount(env, state.eventId);

    ctx.waitUntil(
      forwardToGas(env, {
        action: "submitRegistration",
        eventId: state.eventId,
        lineUserId: userId,
        displayName,
        answers: state.answers || [],
        consentGiven: state.consentGiven !== false,
      }).catch((err) => {
        console.error(JSON.stringify({ action: "submitRegistration_line", lineUserId: userId, syncTarget: "gas", error: err.message }));
      }),
    );

    return { success: true, regId, displayName };
  } catch (err) {
    return { success: false, error: err.message || "系統錯誤，請稍後再試" };
  }
}

// ── KV session helpers ────────────────────────────────────────────────────────

function lineSessionKey(kind, userId) {
  return `${kind}:${userId}`;
}

async function parseSessionJson(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function getLineSession(env, kind, userId) {
  const key = lineSessionKey(kind, userId);
  if (env.DB) {
    try {
      const now = new Date().toISOString();
      const row = await env.DB.prepare(
        "SELECT state_json FROM line_sessions WHERE session_key = ? AND expires_at > ?",
      ).bind(key, now).first();
      if (row?.state_json) return parseSessionJson(row.state_json);
    } catch {}
  }
  if (!env.SESSIONS) return {};
  const raw = await env.SESSIONS.get(key);
  if (!raw) return {};
  return parseSessionJson(raw);
}

export async function saveLineSession(env, kind, userId, state) {
  state.updatedAt = Date.now();
  const key = lineSessionKey(kind, userId);
  const stateJson = JSON.stringify(state);
  if (env.DB) {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + KV_SESSION_TTL * 1000).toISOString();
      await env.DB.prepare(
        `INSERT INTO line_sessions (session_key, kind, user_id, state_json, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_key) DO UPDATE SET
           kind = excluded.kind,
           user_id = excluded.user_id,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
      ).bind(key, kind, userId, stateJson, now.toISOString(), expiresAt).run();
      if (env.SESSIONS) await env.SESSIONS.delete(key).catch(() => {});
      return;
    } catch {}
  }
  if (env.SESSIONS) {
    await env.SESSIONS.put(key, stateJson, { expirationTtl: KV_SESSION_TTL });
  }
}

export async function clearLineSession(env, kind, userId) {
  const key = lineSessionKey(kind, userId);
  if (env.DB) {
    try {
      await env.DB.prepare("DELETE FROM line_sessions WHERE session_key = ?").bind(key).run();
    } catch {}
  }
  if (env.SESSIONS) await env.SESSIONS.delete(key);
}

async function getEvtSession(env, userId) {
  return getLineSession(env, "evt", userId);
}

async function saveEvtSession(env, userId, state) {
  return saveLineSession(env, "evt", userId, state);
}

async function clearEvtSession(env, userId) {
  return clearLineSession(env, "evt", userId);
}

async function getRptSession(env, userId) {
  return getLineSession(env, "rpt", userId);
}

async function saveRptSession(env, userId, state) {
  return saveLineSession(env, "rpt", userId, state);
}

async function clearRptSession(env, userId) {
  return clearLineSession(env, "rpt", userId);
}

export async function findRecentLineRegistration(env, userId, minutes = 30) {
  if (!env.DB || !userId) return null;
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = await env.DB.prepare(
    `SELECT event_id, display_name, submitted_at, payload_json
       FROM event_registrations
      WHERE line_user_id = ? AND submitted_at >= ?
      ORDER BY submitted_at DESC
      LIMIT 1`,
  ).bind(userId, cutoff).first();
  if (!row) return null;
  const payload = parseJson(row.payload_json);
  return {
    eventId: text(row.event_id),
    eventName: text(payload.eventName),
    displayName: text(row.display_name || payload.displayName),
    attendeeName: findRegistrationAttendeeName(payload) || text(row.display_name || payload.displayName),
    phone: findRegistrationPhone(payload),
    submittedAt: text(row.submitted_at || payload.submittedAt),
  };
}

function findRegistrationAttendeeName(payload) {
  for (const key of Object.keys(payload || {})) {
    if (key.includes("報名者姓名") || key === "姓名" || key.includes("姓名")) {
      const value = text(payload[key]);
      if (value) return value;
    }
  }
  return "";
}

function findRegistrationPhone(payload) {
  for (const key of Object.keys(payload || {})) {
    if (key.includes("電話") || key.includes("手機")) {
      const value = text(payload[key]);
      if (value) return value;
    }
  }
  return "";
}

export function buildEvtDuplicateSubmitMessage(registration) {
  if (!registration) {
    return {
      type: "text",
      text: "目前還查不到您最近的報名資料。\n若剛剛才送出，請稍等一下再輸入「查詢報名」；若要重新操作，請輸入「我要報名」。",
    };
  }
  const lines = ["已收到您的報名，不需要重複送出。"];
  if (registration?.eventName) lines.push(`活動：${registration.eventName}`);
  if (registration?.attendeeName) lines.push(`報名者：${registration.attendeeName}`);
  if (registration?.phone) lines.push(`電話：${registration.phone}`);
  lines.push("若要幫其他人報名，請重新輸入「我要報名」。");
  return { type: "text", text: lines.join("\n") };
}

export function buildEvtReminderAlreadyHandledMessage() {
  return {
    type: "text",
    text: "已收到您的提醒設定，請繼續確認報名資料；資料無誤後請點「確認送出」。",
  };
}

async function buildEvtStaleReminderMessages(env, userId, state) {
  if (state.stage === "summary") {
    return [buildEvtReminderAlreadyHandledMessage(), buildEvtSummaryBubble(state)];
  }
  const recent = await findRecentLineRegistration(env, userId);
  return [recent
    ? buildEvtDuplicateSubmitMessage(recent)
    : buildEvtExpiredCardMessage()];
}

function buildEvtExpiredCardMessage() {
  return {
    type: "text",
    text: "這張確認卡片已失效，請稍等一下再按一次；若還是不行，請重新輸入「我要報名」。",
  };
}

export function ensureEvtSubmissionId(state, userId = "") {
  if (!state.submissionId) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    state.submissionId = `REG_${dateStr}_${stableSubmissionSuffix(state, userId)}`;
  }
  return state.submissionId;
}

function stableSubmissionSuffix(state, userId) {
  const seed = JSON.stringify({
    reservationId: text(state.reservationId),
    summaryIssuedAt: text(state.summaryIssuedAt),
    eventId: text(state.eventId),
    userId: text(userId),
    answers: state.answers || [],
  });
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

// ── D1 event queries ──────────────────────────────────────────────────────────

async function getActiveEventsForLine(env) {
  const now = taiwanIsoNow();
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM events
     WHERE status = '報名中'
       AND (registration_start = '' OR registration_start IS NULL OR registration_start <= ?)
       AND (registration_end = '' OR registration_end IS NULL OR registration_end >= ?)
     ORDER BY CASE WHEN sort_order > 0 THEN sort_order ELSE 999999 END ASC,
              event_start ASC, event_id ASC LIMIT 12`,
  ).bind(now, now).all();
  return rows.results.map((row) => {
    const ev = parseJson(row.payload_json);
    const quota = parseInt(text(ev.quota)) || 0;
    const regCount = Number(ev.registeredCount || 0);
    const remaining = quota > 0 ? Math.max(0, quota - regCount) : -1;
    return {
      ...ev,
      eventDate: fmtEventDateRange(text(ev.eventStart), text(ev.eventEnd)),
      quota, remaining,
      isFull: quota > 0 && regCount >= quota,
      isAlmostFull: quota > 0 && remaining > 0 && remaining < 10,
    };
  });
}

// ── LINE API ──────────────────────────────────────────────────────────────────

async function lineReply(env, replyToken, messages) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !replyToken) {
    console.error(JSON.stringify({ fn: "lineReply", error: "missing token or replyToken" }));
    return;
  }
  const resp = await fetch(LINE_REPLY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(JSON.stringify({ fn: "lineReply", status: resp.status, body: errText }));
  }
}

export async function lineMulticast(env, userIds, messages) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !userIds.length) return;
  try {
    const resp = await fetch(LINE_MULTICAST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN },
      body: JSON.stringify({ to: userIds, messages }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(JSON.stringify({ fn: "lineMulticast", status: resp.status, body }));
    }
  } catch (err) {
    console.error(JSON.stringify({ fn: "lineMulticast", error: err.message }));
  }
}

async function forwardLineEventToGas(env, event) {
  const token = env.GAS_LINE_TOKEN || "";
  const url = env.GAS_SCRIPT_URL + (token ? "?lineToken=" + encodeURIComponent(token) : "");
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ events: [event] }),
    });
    const respText = await resp.text().catch(() => "");
    console.log(JSON.stringify({ fn: "forwardLineEventToGas", status: resp.status, body: respText.slice(0, 200), eventType: event.type, msgType: event.message?.type, msgText: event.message?.text?.slice(0, 30) }));
  } catch (err) {
    console.error(JSON.stringify({ fn: "forwardLineEventToGas", error: err.message }));
  }
}

async function getLineProfile(env, userId) {
  try {
    const resp = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── AI 客服聊天（只想聊聊）────────────────────────────────────────────────────

async function startChatFlow(env, userId, replyToken) {
  if (!CHAT_FEATURE_ENABLED) {
    await lineReply(env, replyToken, [
      { type: "text", text: "請直接在這裡留言，里長會親自看到並回覆您 😊" },
    ]);
    return;
  }
  const profile = await getLineProfile(env, userId);
  await saveLineSession(env, "chat", userId, {
    active: true,
    messages: [],
    displayName: profile?.displayName || "",
  });
  await lineReply(env, replyToken, [
    { type: "text", text: "您好，這裡是舊社里小幫手留言區 📝 有任何想跟里長說的話都可以直接打字，我會幫您記錄下來轉達給里長。（輸入「返回主選單」可以隨時離開）" },
  ]);
}

async function handleLineChatEvent(env, userId, replyToken, event) {
  if (!CHAT_FEATURE_ENABLED) return false;
  if (event.type !== "message" || event.message?.type !== "text" || !replyToken) return false;
  const msg = String(event.message.text || "").trim();
  if (!msg) return false;

  const state = await getLineSession(env, "chat", userId);
  const active = !!state.active;

  if (!active && !CHAT_START_RE.test(msg)) return false;

  if (CHAT_START_RE.test(msg)) {
    await startChatFlow(env, userId, replyToken);
    return true;
  }

  if (CHAT_EXIT_RE.test(msg)) {
    await clearLineSession(env, "chat", userId);
    return false; // 讓 handleLineKeywordEvent / handleLineReportEvent 接手處理離開訊息
  }

  await insertChatMessage(env, { lineUserId: userId, displayName: state.displayName, role: "user", content: msg });

  if (!env.ANTHROPIC_API_KEY) {
    await lineReply(env, replyToken, [{ type: "text", text: "已經幫您記錄下來了，會轉達給里長。" }]);
    return true;
  }

  const history = Array.isArray(state.messages) ? state.messages : [];
  history.push({ role: "user", content: msg });

  let replyText;
  try {
    replyText = await callClaudeChat(env, history);
  } catch (err) {
    console.error(JSON.stringify({ fn: "callClaudeChat", error: err.message }));
    replyText = "已經幫您記錄下來了，會轉達給里長。";
  }

  history.push({ role: "assistant", content: replyText });
  await saveLineSession(env, "chat", userId, {
    active: true,
    displayName: state.displayName,
    messages: history.slice(-CHAT_MAX_HISTORY),
  });
  await insertChatMessage(env, { lineUserId: userId, displayName: state.displayName, role: "assistant", content: replyText });
  await lineReply(env, replyToken, [{ type: "text", text: replyText }]);
  return true;
}

async function callClaudeChat(env, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: 512,
      system: CHAT_SYSTEM_PROMPT,
      messages,
    }),
  });
  if (!res.ok) {
    throw new Error("Claude API HTTP " + res.status + " " + (await res.text()));
  }
  const data = await res.json();
  if (data.stop_reason === "refusal" || !data.content?.length) {
    return "這個問題我不方便回答，建議直接使用「我要通報」或聯絡里辦公處。";
  }
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock?.text || "嗯嗯，我在聽，可以再說清楚一點嗎？";
}

// ── LINE Keyword Handlers ─────────────────────────────────────────────────────

// ── Rich Menu dispatch（最新消息/教育課程/商圈優惠/我要找里長/我要報名/緊急通話）─────

async function handleLineMenuEvent(env, userId, replyToken, event) {
  if (event.type !== "postback" || !replyToken) return false;
  const pb = parsePostbackData(event.postback?.data || "");
  if (pb.action !== "menu") return false;

  if (pb.menu === "store") {
    await lineReply(env, replyToken, [await buildFoodMapMenu(env)]);
    return true;
  }
  if (pb.menu === "store_cate") {
    const cate = pb.cate || "";
    const stores = await fetchStoresByCategory(env, cate);
    if (!stores.length) {
      await lineReply(env, replyToken, [{ type: "text", text: `目前「${cate}」分類尚無特約商家。` }]);
      return true;
    }
    await lineReply(env, replyToken, [buildStoreCarousel(cate, stores)]);
    return true;
  }
  if (pb.menu === "emergency") {
    await lineReply(env, replyToken, [await buildEmergencyContactFlex(env)]);
    return true;
  }
  if (pb.menu === "chat_start") {
    await startChatFlow(env, userId, replyToken);
    return true;
  }
  // findchief / apply / backmain 是 richmenuswitch 按鈕，畫面已經由 LINE
  // 平台自動切到對應子選單，這裡只需吞掉 postback，不用再回訊息。
  if (pb.menu === "findchief" || pb.menu === "apply" || pb.menu === "backmain") {
    return true;
  }
  if (MENU_LABELS[pb.menu]) {
    await lineReply(env, replyToken, [{ type: "text", text: "「" + MENU_LABELS[pb.menu] + "」功能準備中，敬請期待！" }]);
    return true;
  }
  return false;
}

async function handleLineKeywordEvent(env, replyToken, event) {
  if (event.type !== "message" || event.message?.type !== "text") return false;
  const msg = String(event.message.text || "").trim();
  if (!msg || !replyToken) return false;

  if (/^(美食地圖|特約商店|特約商家|商家清單|店家清單|查商家|找商家|找店家|商家|店家)$/.test(msg)) {
    await lineReply(env, replyToken, [await buildFoodMapMenu(env)]);
    return true;
  }
  if (/^(我想免費通話)$/.test(msg)) {
    await lineReply(env, replyToken, [{ type: "text", text: "請點擊與本帳號對話框右上角的「📞 通話」圖示，即可發起免費通話 📞" }]);
    return true;
  }
  if (/^(返回主選單)$/.test(msg)) {
    await lineReply(env, replyToken, [{ type: "text", text: "好的，請點擊下方選單按鈕繼續使用其他功能 😊" }]);
    return true;
  }
  if (/^(商家申請|店家申請|我要申請|申請商家|申請特約)$/.test(msg)) {
    await lineReply(env, replyToken, [{ type: "text", text: "特約商家申請請點此填寫：\nhttps://gsnbhs.pages.dev/store" }]);
    return true;
  }
  if (/^(里民憑證|出示憑證|憑證|出示里民憑證)$/.test(msg)) {
    await lineReply(env, replyToken, [{ type: "text", text: "點此出示里民憑證：\n" + VOUCHER_URL }]);
    return true;
  }
  if (msg === "生活情報") {
    await lineReply(env, replyToken, [buildLifeInfoFlex()]);
    return true;
  }
  if (msg === "緊急聯絡") {
    await lineReply(env, replyToken, [await buildEmergencyContactFlex(env)]);
    return true;
  }

  const surveyMatch = msg.match(/^(?:text=)?問券_(EVT[\w]*)_(SRV[\w]*)$/);
  if (surveyMatch) {
    const [, eventId, surveyId] = surveyMatch;
    const userId = event.source?.userId;
    if (!userId) return false;
    try {
      const [eventRow, surveyRow] = await Promise.all([
        env.DB.prepare("SELECT payload_json FROM events WHERE event_id = ?").bind(eventId).first(),
        env.DB.prepare("SELECT payload_json FROM surveys WHERE survey_id = ?").bind(surveyId).first(),
      ]);
      if (!eventRow || !surveyRow) {
        await lineReply(env, replyToken, [{ type: "text", text: "找不到問券，請確認 QR Code 是否正確。" }]);
        return true;
      }
      const ev = parseJson(eventRow.payload_json);
      const survey = parseJson(surveyRow.payload_json);
      const profile = await getLineProfile(env, userId);
      const displayName = profile?.displayName || "";
      const surveyUrl = SURVEY_BASE_URL +
        "?eventId=" + encodeURIComponent(eventId) +
        "&surveyId=" + encodeURIComponent(surveyId) +
        "&lineUserId=" + encodeURIComponent(userId) +
        (displayName ? "&displayName=" + encodeURIComponent(displayName) : "");
      await lineReply(env, replyToken, [buildSurveyInviteBubble(text(ev.eventName), survey, surveyUrl)]);
    } catch (err) {
      console.error(JSON.stringify({ fn: "surveyQrKeyword", eventId, surveyId, error: err.message }));
      await lineReply(env, replyToken, [{ type: "text", text: "問券載入失敗：" + err.message }]);
    }
    return true;
  }

  const cate = matchLineCategory(msg);
  if (!cate) return false;
  const stores = await fetchStoresByCategory(env, cate);
  if (!stores.length) {
    await lineReply(env, replyToken, [{ type: "text", text: `目前「${cate}」分類尚無美食地圖商家。\n輸入「美食地圖」可查看其他分類。` }]);
    return true;
  }
  await lineReply(env, replyToken, [buildStoreCarousel(cate, stores)]);
  return true;
}

function matchLineCategory(msg) {
  for (const [k, arr] of Object.entries(LINE_CATEGORY_MAP)) {
    if (arr.includes(msg)) return k;
  }
  return null;
}

async function fetchStoresByCategory(env, cate) {
  try {
    const rows = await queryStoresDb(env).prepare(
      "SELECT public_payload_json FROM stores WHERE status = '已公開'"
    ).all();
    const all = rows.results.map((r) => parseJson(r.public_payload_json));
    const stores = all.filter((s) => s.pubCate === cate);
    return shuffleStores(stores).slice(0, 12);
  } catch (err) {
    console.error(JSON.stringify({ fn: "fetchStoresByCategory", cate, error: err.message }));
    return [];
  }
}

function queryStoresDb(env) {
  return env.DB;
}

function shuffleStores(stores) {
  const copy = stores.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ── Report flow ───────────────────────────────────────────────────────────────

async function startReportFlow(env, userId, replyToken) {
  await clearRptSession(env, userId);
  await saveRptSession(env, userId, { stage: "select_type" });
  await lineReply(env, replyToken, [buildRptTypeFlex()]);
}

async function handleLineReportEvent(env, userId, replyToken, event) {
  const state = await getRptSession(env, userId);
  const hasSess = !!state.stage;

  if (event.type === "message" && event.message?.type === "text") {
    const msg = String(event.message.text || "").trim();

    if (RPT_START_RE.test(msg)) {
      await startReportFlow(env, userId, replyToken);
      return true;
    }

    if (!hasSess) return false;

    if (RPT_CANCEL_RE_R.test(msg)) {
      await clearRptSession(env, userId);
      await lineReply(env, replyToken, [{ type: "text", text: "已取消通報流程。需要通報時請輸入「我要通報」。" }]);
      return true;
    }

    if (state.stage === "select_type") {
      await lineReply(env, replyToken, [{ type: "text", text: "請點選上方的類別按鈕選擇通報類別。\n若要取消請輸入「取消」。" }]);
      return true;
    }

    if (state.stage === "input_location") {
      await lineReply(env, replyToken, [{
        type: "text",
        text: "請點選「傳送位置」分享位置，或點選「略過位置」跳過。\n若要取消請輸入「取消」。",
        quickReply: {
          items: [
            { type: "action", action: { type: "location", label: "傳送位置" } },
            { type: "action", action: { type: "postback", label: "略過位置", data: "rpt:skip_location" } },
          ],
        },
      }]);
      return true;
    }

    if (state.stage === "input_more_photo") {
      await lineReply(env, replyToken, [buildRptMorePhotoMsg(state.photoCount || 1)]);
      return true;
    }

    if (state.stage === "input_desc") {
      state.description = msg.substring(0, 200);
      state.stage = "input_photo";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [{
        type: "text",
        text: "收到說明！\n\n是否要附上照片？\n請直接傳送照片，或點選「略過」繼續。",
        quickReply: {
          items: [
            { type: "action", action: { type: "postback", label: "略過照片", data: "rpt:skip_photo" } },
            { type: "action", action: { type: "camera", label: "拍照" } },
            { type: "action", action: { type: "cameraRoll", label: "從相簿選" } },
          ],
        },
      }]);
      return true;
    }

    return false;
  }

  if (event.type === "message" && event.message?.type === "image") {
    if (!hasSess) return false;
    if (state.stage === "input_location") {
      await lineReply(env, replyToken, [{
        type: "text",
        text: "📸 照片稍後還可以附上！\n\n現在請先分享問題的位置給里長參考，讓里長能快速找到現場。",
        quickReply: {
          items: [
            { type: "action", action: { type: "location", label: "傳送位置" } },
            { type: "action", action: { type: "postback", label: "略過位置", data: "rpt:skip_location" } },
          ],
        },
      }]);
      return true;
    }
    if (state.stage === "input_photo") {
      state.hasPhoto = true;
      state.photoCount = 1;
      state.stage = "input_more_photo";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [buildRptMorePhotoMsg(1)]);
      return true;
    }
    if (state.stage === "input_more_photo") {
      state.photoCount = (state.photoCount || 1) + 1;
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [buildRptMorePhotoMsg(state.photoCount)]);
      return true;
    }
    return false;
  }

  if (event.type === "message" && event.message?.type === "location") {
    if (!hasSess || state.stage !== "input_location") return false;
    state.latitude = event.message.latitude;
    state.longitude = event.message.longitude;
    state.address = event.message.address || "";
    state.stage = "input_desc";
    await saveRptSession(env, userId, state);
    await lineReply(env, replyToken, [{ type: "text", text: "📍 位置已收到！\n\n請用文字描述問題狀況，最多 200 字：" }]);
    return true;
  }

  if (event.type === "postback") {
    const data = String(event.postback?.data || "");
    if (!data.startsWith("rpt:")) return false;

    if (data.startsWith("rpt:type:")) {
      const type = data.slice("rpt:type:".length);
      await saveRptSession(env, userId, { stage: "input_location", type });
      await lineReply(env, replyToken, [{
        type: "text",
        text: `✅ 類別：${type}\n\n請傳送問題發生的位置，讓里長能快速前往現場。`,
        quickReply: {
          items: [
            { type: "action", action: { type: "location", label: "傳送位置" } },
            { type: "action", action: { type: "postback", label: "略過位置", data: "rpt:skip_location" } },
          ],
        },
      }]);
      return true;
    }

    if (data === "rpt:skip_location") {
      if (!hasSess) return false;
      state.latitude = null;
      state.longitude = null;
      state.address = "";
      state.stage = "input_desc";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [{ type: "text", text: "請用文字描述問題（可在說明中加入位置資訊），最多 200 字：" }]);
      return true;
    }

    if (data === "rpt:no_more_photo") {
      if (!hasSess) return false;
      state.stage = "confirm";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [buildRptConfirmBubble(state)]);
      return true;
    }

    if (data === "rpt:skip_photo") {
      if (!hasSess) return false;
      state.hasPhoto = false;
      state.stage = "confirm";
      await saveRptSession(env, userId, state);
      await lineReply(env, replyToken, [buildRptConfirmBubble(state)]);
      return true;
    }

    if (data === "rpt:submit") {
      if (!hasSess) return false;
      const saved = { ...state };
      await clearRptSession(env, userId);
      await lineReply(env, replyToken, [buildRptThankYouBubble(saved)]);
      return true;
    }

    if (data === "rpt:cancel") {
      await clearRptSession(env, userId);
      await lineReply(env, replyToken, [{ type: "text", text: "已取消通報。需要通報時請再輸入「我要通報」。" }]);
      return true;
    }

    return false;
  }

  return false;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function parsePostbackData(data) {
  const result = {};
  if (!data) return result;
  for (const part of data.split("&")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    result[decodeURIComponent(part.slice(0, eqIdx))] = decodeURIComponent(part.slice(eqIdx + 1));
  }
  return result;
}

function fmtEventDateRange(start, end) {
  const toTW = (iso) => {
    if (!iso) return "";
    const ms = parseTaiwanIsoToMs(iso);
    const d = isNaN(ms) ? new Date(iso) : new Date(ms);
    if (isNaN(d.getTime())) return String(iso);
    const p = new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t)?.value ?? "";
    return `${g("year")}/${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`;
  };
  const s = toTW(start);
  const e = toTW(end);
  if (s && e) return s.slice(0, 10) === e.slice(0, 10) ? `${s.slice(0, 10)} ${s.slice(11)}-${e.slice(11)}` : `${s} - ${e}`;
  return s || e || "";
}

function buildMultiStatusText(selected) {
  if (!selected?.length) return "目前尚未選取。選好後請按「選好了，下一題」。";
  return "目前已選：" + selected.join("、") + "\n選好後請按「選好了，下一題」。";
}

function fmtReminderTime(reminderTime) {
  if (!reminderTime) return "";
  const m = String(reminderTime).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
  return reminderTime;
}

// ── Message builders ──────────────────────────────────────────────────────────

async function getCategoriesWithStores(env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT DISTINCT pub_cate FROM stores WHERE status = '已公開'",
    ).all();
    return new Set(rows.results.map((r) => r.pub_cate));
  } catch (err) {
    console.error(JSON.stringify({ fn: "getCategoriesWithStores", error: err.message }));
    return null; // 查詢失敗時不過濾，避免整個選單消失
  }
}

async function buildFoodMapMenu(env) {
  const activeCategories = await getCategoriesWithStores(env);
  const items = activeCategories
    ? FOOD_MAP_MENU_ITEMS.filter((item) => item.text === "商家申請" || activeCategories.has(item.text))
    : FOOD_MAP_MENU_ITEMS;
  const bubbles = items.map((item) => ({
    type: "bubble",
    size: "micro",
    header: {
      type: "box", layout: "vertical", backgroundColor: item.color, paddingAll: "12px",
      contents: [
        { type: "text", text: item.emoji, size: "xl", align: "center" },
        { type: "text", text: item.title, size: "md", color: "#FFFFFF", weight: "bold", align: "center", wrap: true, margin: "sm" },
      ],
    },
    body: {
      type: "box", layout: "vertical", paddingAll: "12px",
      contents: [{ type: "text", text: item.desc, size: "xs", color: "#5A7090", wrap: true, maxLines: 3 }],
    },
    footer: {
      type: "box", layout: "vertical", paddingAll: "8px",
      contents: [{
        type: "button",
        style: item.text === "商家申請" ? "secondary" : "primary",
        height: "sm",
        color: item.text === "商家申請" ? undefined : item.color,
        action: item.text === "商家申請"
          ? { type: "uri", label: "我要申請", uri: "https://gsnbhs.pages.dev/store" }
          : { type: "postback", label: "查看商家", data: "action=menu&menu=store_cate&cate=" + encodeURIComponent(item.text) },
      }],
    },
  }));
  return { type: "flex", altText: "舊社里美食地圖分類", contents: { type: "carousel", contents: bubbles } };
}

function buildLifeInfoFlex() {
  return {
    type: "flex",
    altText: "生活情報",
    contents: {
      type: "bubble", size: "giga",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#A3C0D1", paddingAll: "16px",
        contents: [
          { type: "text", text: "🏡 舊社里大小事", color: "#FFFFFF", weight: "bold", size: "xl" },
          { type: "text", text: "一步一來到，共為改善生活環境", color: "#DCEBFA", size: "sm", margin: "sm" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "md",
        contents: [
          { type: "text", text: "💡 鄰里建設", weight: "bold", size: "md", color: "#444444" },
          { type: "button", style: "primary", height: "sm", color: "#737A46", action: { type: "uri", label: "🌳 校舍建設", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#737A46", action: { type: "uri", label: "🏢 等候空間", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#737A46", action: { type: "uri", label: "🏫 等候側小建設", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#737A46", action: { type: "uri", label: "🚌 候車亭建設", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#E69583", action: { type: "uri", label: "🌳 寵物公園", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "primary", height: "sm", color: "#E69583", action: { type: "uri", label: "🌳 景觀地設置", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "separator", margin: "md" },
          { type: "text", text: "🛣 道路與水利", weight: "bold", size: "md", color: "#444444", margin: "md" },
          { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: "🛣 XX路拓寬", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: "💡 展地小設施規畫", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: "🌱 定期路橋相利添新設施", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
          { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: "🏣 XX街道路翻新", uri: "https://www.facebook.com/profile.php?id=61588593610574" } },
        ],
      },
      footer: {
        type: "box", layout: "horizontal", spacing: "md",
        contents: [
          { type: "button", style: "link", action: { type: "uri", label: "線上陳情", uri: "https://forms.fillout.com/t/eniXfoCyTeus" } },
          { type: "button", style: "link", action: { type: "uri", label: "案件總覽", uri: "https://delaine19093.softr.app/" } },
        ],
      },
    },
  };
}

async function buildEmergencyContactFlex(env) {
  const contacts = await getEmergencyContactsForLine(env);
  const buttons = contacts.length
    ? contacts.map((c) => {
        if (c.kind === "hint") {
          return { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "message", label: c.name, text: "我想免費通話" } };
        }
        if (c.kind === "url") {
          return { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: c.name, uri: c.phone } };
        }
        return { type: "button", style: "secondary", height: "sm", color: "#D9DEE5", action: { type: "uri", label: (c.org ? c.org + " " : "") + c.name, uri: "tel:" + c.phone } };
      })
    : [{ type: "text", text: "目前尚未設定聯絡電話", color: "#94A3B8", size: "sm" }];
  return {
    type: "flex",
    altText: "聯絡電話",
    contents: {
      type: "bubble", size: "giga",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#0B5EA8", paddingAll: "16px",
        contents: [
          { type: "text", text: "重要聯絡電話", color: "#FFFFFF", weight: "bold", size: "xl" },
          { type: "text", text: "點選後可以直接電話", color: "#DCEBFA", size: "sm", margin: "sm" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "md",
        contents: buttons,
      },
    },
  };
}

function buildStoreCarousel(category, stores) {
  const info = LINE_CATEGORY_INFO[category] || { title: category, emoji: "🏪", subtitle: "", color: "#3B82F6" };
  const bubbles = [];
  for (let i = 0; i < stores.length; i += 3) {
    bubbles.push(buildStoreBubble(info, stores.slice(i, i + 3)));
    if (bubbles.length >= 4) break;
  }
  return {
    type: "flex",
    altText: `${info.title}：美食地圖商家清單（${stores.length} 間）`,
    contents: { type: "carousel", contents: bubbles },
  };
}

export function buildStoreBubble(info, stores) {
  const bodyContents = [];
  stores.forEach((s, idx) => {
    if (idx > 0) bodyContents.push({ type: "separator", margin: "md" });
    bodyContents.push(buildStoreItem(s));
  });
  return {
    type: "bubble", size: "mega",
    header: {
      type: "box", layout: "vertical", backgroundColor: info.color || "#3B82F6", paddingAll: "16px",
      contents: [
        { type: "text", text: info.title + " " + info.emoji, size: "xl", color: "#FFFFFF", weight: "bold" },
        { type: "text", text: "優惠內容依各店家實際活動辦法為準，使用前請先向店家確認。", size: "xxs", color: "#FFFFFFE6", wrap: true, margin: "md" },
      ],
    },
    body: { type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm", contents: bodyContents },
    footer: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "button", style: "primary", color: "#5B9B7B", action: { type: "uri", label: "出示里民憑證", uri: VOUCHER_URL } },
        { type: "button", style: "secondary", action: { type: "uri", label: "更多商家", uri: STORE_LIST_URL } },
      ],
    },
  };
}

export function buildStoreItem(s) {
  const img = s.photo1 || STORE_IMG_FALLBACK;
  const brandUrl = String(s.brandUrl || "").trim();
  const detailUrl = STORE_DETAIL_URL + encodeURIComponent(s.storeId);
  const btnUrl = /^https?:\/\//i.test(brandUrl) ? brandUrl : detailUrl;
  return {
    type: "box", layout: "vertical", spacing: "sm", height: "128px",
    contents: [
      {
        type: "box", layout: "horizontal", spacing: "md", height: "84px",
        action: { type: "uri", label: "查看商家", uri: detailUrl },
        contents: [
          { type: "image", url: img, flex: 2, size: "full", aspectRatio: "1:1", aspectMode: "cover" },
          {
            type: "box", layout: "vertical", flex: 5, spacing: "xs",
            contents: [
              { type: "text", text: s.pubName || "(未命名)", weight: "bold", size: "md", wrap: true, maxLines: 2 },
              { type: "text", text: s.pubOffer || "（請洽店家）", size: "sm", color: "#5A7090", wrap: true, maxLines: 4 },
            ],
          },
        ],
      },
      { type: "button", style: "primary", color: "#3B82F6", height: "sm", action: { type: "uri", label: "品牌介紹", uri: btnUrl } },
    ],
  };
}

function buildEvtListCarousel(events) {
  const bubbles = events.slice(0, 12).map((ev) => {
    const statusText = ev.isFull ? "🔴 名額已滿" : ev.isAlmostFull ? `⚠️ 剩餘 ${ev.remaining} 個名額` : "🟢 報名中";
    const statusColor = ev.isFull ? "#cc0000" : ev.isAlmostFull ? "#e37400" : "#00aa44";
    const bodyContents = [
      { type: "text", text: ev.eventName, weight: "bold", size: "md", wrap: true },
      ev.eventDate ? { type: "text", text: "📅 " + ev.eventDate, size: "sm", color: "#555555", wrap: true } : null,
      ev.eventLocation ? buildEvtLocationText(ev) : null,
      { type: "text", text: statusText, size: "sm", color: statusColor },
    ].filter(Boolean);
    const btnAction = ev.isFull
      ? { type: "message", label: "名額已滿", text: "此活動名額已滿" }
      : { type: "postback", label: "選擇此活動", data: `action=evt:select&eventId=${ev.eventId}` };
    const bubble = {
      type: "bubble", size: "giga",
      body: { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents },
      footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: ev.isFull ? "secondary" : "primary", color: ev.isFull ? undefined : "#1a73e8", height: "sm", action: btnAction }] },
    };
    const heroUrl = ev.imageUrl || EVENT_IMG_FALLBACK;
    bubble.hero = { type: "image", url: heroUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover", gravity: "top" };
    return bubble;
  });
  return { type: "flex", altText: "目前可報名的活動", contents: { type: "carousel", contents: bubbles } };
}

function buildEvtLocationText(ev) {
  const loc = { type: "text", text: ev.eventLocation, size: "sm", color: ev.mapUrl ? "#1a73e8" : "#555555", wrap: true, flex: 1 };
  if (ev.mapUrl) { loc.decoration = "underline"; loc.action = { type: "uri", uri: ev.mapUrl }; }
  return { type: "box", layout: "horizontal", spacing: "xs", contents: [{ type: "text", text: "📍", size: "sm", flex: 0 }, loc] };
}

function buildEvtConfirmBubble(ev) {
  const bodyContents = [
    { type: "text", text: "您選擇的活動：", size: "sm", color: "#666666" },
    { type: "text", text: ev.eventName, weight: "bold", size: "lg", wrap: true },
    ev.eventDate ? { type: "text", text: "📅 " + ev.eventDate, size: "sm", color: "#555555" } : null,
    ev.eventLocation ? buildEvtLocationText(ev) : null,
    ev.isAlmostFull ? { type: "text", text: `⚠️ 本活動目前剩餘 ${ev.remaining} 個名額，請把握機會！`, size: "sm", color: "#e37400", wrap: true, margin: "sm" } : null,
    { type: "separator", margin: "md" },
    { type: "text", text: "是這個活動嗎？", size: "md", weight: "bold", margin: "md" },
  ].filter(Boolean);
  const heroUrl = ev.imageUrl || EVENT_IMG_FALLBACK;
  return {
    type: "flex", altText: "確認報名活動？",
    contents: { type: "bubble",
      hero: { type: "image", url: heroUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover", gravity: "top" },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
        { type: "button", style: "secondary", height: "sm", flex: 1, action: { type: "postback", label: "不是", data: "action=evt:confirm_no" } },
        { type: "button", style: "primary", height: "sm", flex: 2, color: "#1a73e8", action: { type: "postback", label: "是，我要報名", data: "action=evt:confirm_yes" } },
      ] },
    },
  };
}

function buildEvtConsentBubble() {
  return {
    type: "flex", altText: "📸 活動照片拍攝告知",
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: "#1a73e8", contents: [{ type: "text", text: "📸 活動照片拍攝告知", color: "#ffffff", weight: "bold", size: "md" }] },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "text", text: "本活動進行期間可能進行攝影記錄。", wrap: true, size: "sm" },
        { type: "text", text: "照片可能用於里辦公室社群媒體、宣傳資料。", wrap: true, size: "sm" },
        { type: "text", text: "如不同意，仍可繼續報名，活動拍攝時工作人員會留意避開。", wrap: true, size: "sm", color: "#666666" },
        { type: "separator", margin: "md" },
        { type: "text", text: "選「我同意」即視為已閱讀並接受上述說明。", wrap: true, size: "xs", color: "#999999", margin: "md" },
      ] },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
        { type: "button", style: "secondary", height: "sm", flex: 1, action: { type: "postback", label: "不同意", data: "action=evt:consent_no" } },
        { type: "button", style: "primary", height: "sm", flex: 1, color: "#1a73e8", action: { type: "postback", label: "我同意", data: "action=evt:consent_yes" } },
      ] },
    },
  };
}

function buildEvtQuestionHeader(headerText, progress) {
  return {
    type: "box", layout: "horizontal", backgroundColor: "#1a73e8", paddingAll: "16px",
    contents: [
      { type: "text", text: "🎪 " + headerText, color: "#ffffff", weight: "bold", size: "sm", flex: 1 },
      progress ? { type: "text", text: progress, color: "#ffffff", weight: "bold", size: "sm", align: "end", flex: 0 } : null,
    ].filter(Boolean),
  };
}

function buildEvtQuestionMsgs(q, qIdx, total) {
  if (!q) return [];
  const progress = `(${qIdx + 1}/${total})`;
  if (q.type === "text") {
    const contents = [
      { type: "text", text: q.label, weight: "bold", size: "md", wrap: true },
      { type: "text", text: "請直接在聊天室輸入答案後送出。", size: "sm", color: "#666666", wrap: true, margin: "md" },
      q.required ? null : { type: "text", text: "此題非必填，也可以略過。", size: "xs", color: "#999999", wrap: true, margin: "sm" },
    ].filter(Boolean);
    const footer = q.required ? [] : [{ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "略過此題", data: "action=evt:skip" } }];
    return [{ type: "flex", altText: q.label, contents: { type: "bubble",
      header: buildEvtQuestionHeader("請回答問題", progress),
      body: { type: "box", layout: "vertical", spacing: "sm", contents },
      footer: footer.length ? { type: "box", layout: "vertical", spacing: "sm", contents: footer } : undefined,
    } }];
  }
  const buildOptionBubble = (label, opts, isHeadcount) => {
    const buttons = (opts || []).slice(0, isHeadcount ? 13 : 10).map((opt) => {
      const value = isHeadcount ? String(opt).replace(/\D/g, "") : opt;
      return { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: String(opt).substring(0, 20), data: `action=evt:answer&value=${encodeURIComponent(value)}` } };
    });
    if (q.allowOther && !isHeadcount) buttons.push({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "其他", data: "action=evt:answer&value=__OTHER__" } });
    if (!q.required) buttons.push({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "略過此題", data: "action=evt:skip" } });
    return [{ type: "flex", altText: label, contents: { type: "bubble",
      header: buildEvtQuestionHeader(isHeadcount ? "報名人數" : "請選擇答案", progress),
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: label, weight: "bold", size: "md", wrap: true },
        { type: "text", text: isHeadcount ? "系統會依此計算剩餘名額。" : "請點選下方選項。", size: "xs", color: "#888888", wrap: true },
      ] },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons },
    } }];
  };
  if (q.type === "number") {
    const contents = [
      { type: "text", text: q.label, weight: "bold", size: "md", wrap: true },
      { type: "text", text: "請直接在聊天室輸入數字後送出。", size: "sm", color: "#666666", wrap: true, margin: "md" },
      q.required ? null : { type: "text", text: "此題非必填，也可以略過。", size: "xs", color: "#999999", wrap: true, margin: "sm" },
    ].filter(Boolean);
    const footer = q.required ? [] : [{ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "略過此題", data: "action=evt:skip" } }];
    return [{ type: "flex", altText: q.label, contents: { type: "bubble",
      header: buildEvtQuestionHeader("請回答問題", progress),
      body: { type: "box", layout: "vertical", spacing: "sm", contents },
      footer: footer.length ? { type: "box", layout: "vertical", spacing: "sm", contents: footer } : undefined,
    } }];
  }
  if (q.type === "single") return buildOptionBubble(q.label, q.options, false);
  if (q.type === "scale") return buildOptionBubble(q.label, ["1", "2", "3", "4", "5"], false);
  if (q.type === "headcount") {
    const maxN = Math.min(Math.max(parseInt((q.options || [])[0]) || 10, 1), 13);
    return buildOptionBubble(q.label, Array.from({ length: maxN }, (_, i) => `${i + 1} 人`), true);
  }
  if (q.type === "multi") {
    const buttons = (q.options || []).slice(0, 10).map((opt) => ({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: String(opt).substring(0, 18), data: `action=evt:answer&value=${encodeURIComponent(opt)}` } }));
    if (q.allowOther) buttons.push({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "其他", data: "action=evt:answer&value=__OTHER__" } });
    buttons.push({ type: "button", style: "primary", color: "#1a73e8", height: "sm", action: { type: "postback", label: "選好了，下一題", data: "action=evt:multi_done" } });
    if (!q.required) buttons.push({ type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "略過此題", data: "action=evt:skip" } });
    return [{ type: "flex", altText: q.label, contents: { type: "bubble",
      header: buildEvtQuestionHeader("可複選", progress),
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: q.label, weight: "bold", size: "md", wrap: true },
        { type: "text", text: "可複選，點選後會標記為已選。", size: "xs", color: "#888888", wrap: true },
      ] },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons },
    } }];
  }
  return [];
}

function buildEvtReminderOptInBubble(state) {
  const timeText = fmtReminderTime(state.reminderTime);
  return {
    type: "flex", altText: "🔔 活動提醒設定",
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "🔔 活動提醒", weight: "bold", size: "lg", color: "#1f2937" },
          { type: "separator", margin: "md" },
          { type: "text", text: `此活動預計於 ${timeText} 發送 LINE 提醒。`, size: "sm", wrap: true, color: "#4b5563", margin: "md" },
          { type: "text", text: "請問您是否想在活動前收到提醒通知？", size: "sm", wrap: true, color: "#4b5563", margin: "sm" },
        ],
      },
      footer: {
        type: "box", layout: "horizontal", spacing: "sm",
        contents: [
          { type: "button", style: "secondary", height: "sm", flex: 1, action: { type: "postback", label: "不用了", data: "action=evt:remind_no" } },
          { type: "button", style: "primary", height: "sm", flex: 2, color: "#1a73e8", action: { type: "postback", label: "好，提醒我", data: "action=evt:remind_yes" } },
        ],
      },
    },
  };
}

export function buildEvtReminderBubble(event) {
  const timeText = fmtEventDateRange(text(event.eventStart), text(event.eventEnd));
  const loc = text(event.eventLocation);
  const bodyContents = [
    { type: "text", text: text(event.eventName), weight: "bold", size: "lg", color: "#1f2937", wrap: true },
    { type: "separator", margin: "md" },
  ];
  if (timeText) bodyContents.push({
    type: "box", layout: "horizontal", margin: "md",
    contents: [
      { type: "text", text: "📅", size: "sm", flex: 0 },
      { type: "text", text: timeText, size: "sm", flex: 1, wrap: true, margin: "sm", color: "#4b5563" },
    ],
  });
  if (loc) bodyContents.push({
    type: "box", layout: "horizontal",
    contents: [
      { type: "text", text: "📍", size: "sm", flex: 0 },
      { type: "text", text: loc, size: "sm", flex: 1, wrap: true, margin: "sm", color: "#4b5563" },
    ],
  });
  bodyContents.push({ type: "separator", margin: "md" });
  bodyContents.push({ type: "text", text: "明天見唷！如有問題請聯繫我們。", size: "xs", color: "#6b7280", wrap: true, margin: "md" });
  return {
    type: "flex", altText: "🔔 活動提醒：" + text(event.eventName),
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1a73e8", paddingAll: "16px",
        contents: [{ type: "text", text: "🔔 活動提醒", color: "#ffffff", weight: "bold", size: "md" }],
      },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents },
    },
  };
}

export function buildEvtReminderMessages(event) {
  const messages = [];
  const imageUrl = text(event.imageUrl);
  if (/^https:\/\//i.test(imageUrl)) {
    messages.push({
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    });
  }
  messages.push(buildEvtReminderBubble(event));
  return messages;
}

export function buildEvtSummaryBubble(state) {
  const answers = state.answers || [];
  const contents = [
    { type: "text", text: "📋 報名資料確認", weight: "bold", size: "lg" },
    { type: "text", text: "活動：" + (state.eventName || ""), size: "sm", color: "#1a73e8", wrap: true },
    { type: "separator", margin: "md" },
    ...answers.map((a) => {
      const val = Array.isArray(a.value) ? a.value.join("、") : a.value;
      return { type: "text", text: a.label + "：" + val, size: "sm", wrap: true, margin: "sm" };
    }),
    ...(!answers.length ? [{ type: "text", text: "（此活動無需填寫問題）", size: "sm", color: "#999999" }] : []),
    { type: "separator", margin: "md" },
    { type: "text", text: "資料確認無誤後請點「確認送出」。點一次即可，請稍候系統回覆。", size: "xs", color: "#999999", wrap: true, margin: "sm" },
  ];
  return {
    type: "flex", altText: "📋 報名確認",
    contents: { type: "bubble",
      body: { type: "box", layout: "vertical", spacing: "sm", contents },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
        { type: "button", style: "secondary", height: "sm", flex: 1, action: { type: "postback", label: "修改", data: "action=evt:edit" } },
        { type: "button", style: "primary", height: "sm", flex: 2, color: "#1a73e8", action: { type: "postback", label: "確認送出", data: "action=evt:submit" } },
      ] },
    },
  };
}

function buildEvtSuccessBubble(state) {
  const isWalkIn = !!state.walkIn;
  let reminderLine = "";
  const hasReminder = state.reminderTime && state.reminderTime !== "none";
  if (hasReminder && !isWalkIn) {
    const timeText = fmtReminderTime(state.reminderTime);
    reminderLine = state.wantsReminder === true
      ? `🔔 已設定提醒，將於 ${timeText} 傳送 LINE 通知。`
      : "您選擇不接收 LINE 提醒。";
  }
  const bodyContents = [
    { type: "text", text: state.eventName || "活動報名", weight: "bold", size: "lg", color: "#1f2937", wrap: true },
    { type: "separator", margin: "md" },
    { type: "text", text: isWalkIn ? "報名完成，您已自動完成簽到！" : "感謝您報名參加此活動！", size: "sm", color: "#4b5563", wrap: true, margin: "md" },
    ...(reminderLine ? [{ type: "text", text: reminderLine, size: "sm", color: "#4b5563", wrap: true }] : []),
    { type: "text", text: "如需修改報名內容，請直接和我們說即可。", size: "sm", color: "#4b5563", wrap: true },
    { type: "text", text: "📌 我們已為您保留報名資料", size: "xs", color: "#6b7280", wrap: true, margin: "md" },
    { type: "separator", margin: "md" },
    { type: "text", text: isWalkIn ? "若要幫其他人報名，請再次輸入報名碼，每人填一份即可。" : "若要幫家人或朋友報名，請再次輸入「我要報名」重複操作，每人填一份即可。", size: "xs", color: "#6b7280", wrap: true, margin: "md" },
  ];
  return {
    type: "flex", altText: isWalkIn ? "報名並簽到完成" : "報名成功",
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: isWalkIn ? "#1565c0" : "#2f6836", paddingAll: "16px", contents: [{ type: "text", text: isWalkIn ? "✅ 報名並簽到完成" : "✅ 報名成功", color: "#ffffff", weight: "bold", size: "md" }] },
      body: { type: "box", layout: "vertical", spacing: "md", contents: bodyContents },
    },
  };
}

export function buildSurveyInviteBubble(eventName, survey, surveyUrl) {
  const surveyName = text(survey.surveyName);
  const title = text(survey.introTitle) || surveyName || "活動意見調查";
  const desc = text(survey.introDescription) || "您的意見將幫助我們規劃更好的活動。";
  return {
    type: "flex",
    altText: "📝 活動後問券：" + surveyName,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#6d42c7", paddingAll: "16px",
        contents: [{ type: "text", text: title, color: "#ffffff", weight: "bold", size: "md", wrap: true }],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: String(eventName), weight: "bold", size: "lg", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: desc, size: "sm", color: "#555555", wrap: true, margin: "md" },
          { type: "text", text: "按下方按鈕後在瀏覽器頁面填寫問券。", size: "xs", color: "#888888", wrap: true },
        ],
      },
      footer: {
        type: "box", layout: "vertical",
        contents: [{ type: "button", style: "primary", color: "#1a73e8", height: "sm", action: { type: "uri", label: "開始填寫", uri: surveyUrl } }],
      },
    },
  };
}

// ── Report message builders ───────────────────────────────────────────────────

function buildRptTypeFlex() {
  return {
    type: "flex",
    altText: "請選擇通報類別",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#27AE60", paddingAll: "14px",
        contents: [
          { type: "text", text: "📝 里民通報", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: "請選擇通報類別", color: "#d4f5d4", size: "sm", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: RPT_TYPES.map((t) => ({
          type: "button", style: "secondary", height: "sm",
          action: { type: "postback", label: t, data: `rpt:type:${t}` },
        })),
      },
    },
  };
}

function buildRptMorePhotoMsg(count) {
  const msg = count === 1
    ? "📸 收到第 1 張照片！\n\n要再附一張嗎？"
    : `📸 已收到第 ${count} 張照片！\n\n要再附一張嗎？`;
  return {
    type: "text",
    text: msg,
    quickReply: {
      items: [
        { type: "action", action: { type: "camera", label: "再拍一張" } },
        { type: "action", action: { type: "cameraRoll", label: "從相簿選" } },
        { type: "action", action: { type: "postback", label: "略過，確認送出", data: "rpt:no_more_photo" } },
      ],
    },
  };
}

function buildMapButton(lat, lng) {
  return {
    type: "button", style: "link", height: "sm",
    action: {
      type: "uri", label: "📍 在 Google 地圖上查看",
      uri: `https://www.google.com/maps?q=${lat},${lng}`,
    },
  };
}

function buildRptConfirmBubble(state) {
  const locStr = state.address ||
    (state.latitude != null ? `${state.latitude.toFixed(5)}, ${state.longitude.toFixed(5)}` : "未提供");
  const photoText = state.hasPhoto
    ? (state.photoCount > 1 ? `✅ ${state.photoCount} 張` : "✅ 1 張")
    : "— 未附";
  const bodyContents = [
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "類別", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: state.type || "—", size: "sm", flex: 5, wrap: true, weight: "bold" },
    ]},
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "位置", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: locStr, size: "sm", flex: 5, wrap: true },
    ]},
  ];
  if (state.latitude != null) bodyContents.push(buildMapButton(state.latitude, state.longitude));
  bodyContents.push(
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "說明", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: state.description || "—", size: "sm", flex: 5, wrap: true },
    ]},
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "照片", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: photoText, size: "sm", flex: 5 },
    ]},
    { type: "separator" },
    { type: "text", text: "內容正確嗎？", size: "sm", color: "#555555", margin: "sm" }
  );
  return {
    type: "flex",
    altText: "確認通報內容",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#2980B9", paddingAll: "14px",
        contents: [{ type: "text", text: "📋 確認通報內容", color: "#FFFFFF", weight: "bold", size: "md" }],
      },
      body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "14px", contents: bodyContents },
      footer: {
        type: "box", layout: "horizontal", spacing: "sm",
        contents: [
          { type: "button", style: "secondary", height: "sm", flex: 1,
            action: { type: "postback", label: "取消", data: "rpt:cancel" } },
          { type: "button", style: "primary", height: "sm", flex: 2, color: "#27AE60",
            action: { type: "postback", label: "確認送出", data: "rpt:submit" } },
        ],
      },
    },
  };
}

function buildRptThankYouBubble(state) {
  const locStr = state.address ||
    (state.latitude != null ? `${state.latitude.toFixed(5)}, ${state.longitude.toFixed(5)}` : "未提供");
  const photoText = state.hasPhoto
    ? (state.photoCount > 1 ? `✅ ${state.photoCount} 張` : "✅ 1 張")
    : "— 未附";
  const bodyContents = [
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "類別", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: state.type || "—", size: "sm", flex: 5, wrap: true, weight: "bold" },
    ]},
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "位置", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: locStr, size: "sm", flex: 5, wrap: true },
    ]},
  ];
  if (state.latitude != null) bodyContents.push(buildMapButton(state.latitude, state.longitude));
  bodyContents.push(
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "說明", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: state.description || "—", size: "sm", flex: 5, wrap: true },
    ]},
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "照片", size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: photoText, size: "sm", flex: 5 },
    ]},
  );
  return {
    type: "flex",
    altText: "✅ 通報已送出",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#27AE60", paddingAll: "14px",
        contents: [
          { type: "text", text: "✅ 通報已送出", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: "感謝您的通報，我們將盡快處理！", color: "#d4f5d4", size: "sm", margin: "xs", wrap: true },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "md", paddingAll: "14px",
        contents: bodyContents,
      },
    },
  };
}
