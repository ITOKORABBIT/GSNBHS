/**
 * import-from-hpnbhs.mjs
 * 從和平里 Worker 公開端點複製資料到歐米里 D1（DEMO 用）
 *
 * 使用方式：
 *   $env:IMPORT_TOKEN="omnbhs-cases-419511c1c308"; node import-from-hpnbhs.mjs
 *
 * 資料來源：和平里公開 Worker API（不含個資，sanitizePublic 已過濾）
 * 資料目的：歐米里各 Worker import 端點
 */

const IMPORT_TOKEN = process.env.IMPORT_TOKEN || "";

// 和平里（來源）
const HP = {
  cases:     "https://hpnbhs-cases-api.ulch0709.workers.dev",
  bulletins: "https://hpnbhs-bulletins-api.ulch0709.workers.dev",
  stores:    "https://hpnbhs-stores-api.ulch0709.workers.dev",
};

// 歐米里（目的地）
const OM = {
  cases:     "https://omnbhs-cases-api.ulch0709.workers.dev",
  bulletins: "https://omnbhs-bulletins-api.ulch0709.workers.dev",
  stores:    "https://omnbhs-stores-api.ulch0709.workers.dev",
  events:    "https://omnbhs-events-api.ulch0709.workers.dev",
};

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}

async function importCases() {
  console.log("\n📋 案件");
  const src = await post(HP.cases, { action: "getPublicCases" });
  const cases = src.cases || [];
  console.log(`  和平里取得 ${cases.length} 筆公開案件`);
  if (!cases.length) return;

  const res = await post(OM.cases, { action: "importCases", importToken: IMPORT_TOKEN, cases });
  if (!res.success) throw new Error(`importCases 失敗：${res.error}`);
  console.log(`  ✅ 匯入 ${res.imported} 筆`);
}

async function importBulletins() {
  console.log("\n📢 公告");
  const src = await post(HP.bulletins, { action: "getPublicBulletins" });
  const bulletins = src.bulletins || [];
  console.log(`  和平里取得 ${bulletins.length} 筆公告`);
  if (!bulletins.length) return;

  const res = await post(OM.bulletins, { action: "importBulletins", importToken: IMPORT_TOKEN, bulletins });
  if (!res.success) throw new Error(`importBulletins 失敗：${res.error}`);
  console.log(`  ✅ 匯入 ${res.imported} 筆`);
}

async function importStores() {
  console.log("\n🍜 商家");
  const src = await post(HP.stores, { action: "getPublicStores" });
  const stores = src.stores || [];
  console.log(`  和平里取得 ${stores.length} 筆商家`);
  if (!stores.length) return;

  const res = await post(OM.stores, { action: "importStores", importToken: IMPORT_TOKEN, stores });
  if (!res.success) throw new Error(`importStores 失敗：${res.error}`);
  console.log(`  ✅ 匯入 ${res.imported} 筆`);
}

// 活動報名無公開 API，直接嵌入歐米里 DEMO 事件
const DEMO_EVENTS = [
  {
    eventId: "EVT_20260620_0001",
    eventName: "歐米里端午慶典暨鄰里聚餐",
    status: "報名中",
    eventLocation: "歐米里活動中心",
    description: "一年一度的端午慶典，邀請歐米里全體里民共同參與！活動包含包粽子示範、鄰里聚餐、端午文化分享，歡迎闔家大小共同參加。",
    imageUrl: "",
    quota: 80,
    registeredCount: 23,
    requireConsent: false,
    questions: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "phone", label: "聯絡電話", type: "text", required: true },
      { key: "headcount", label: "參加人數（含本人）", type: "number", required: true },
    ],
    registrationSheet: "REG_EVT_20260620_0001",
    registrationStart: "2026-05-29T00:00:00+08:00",
    registrationEnd: "2026-06-17T23:59:00+08:00",
    eventStart: "2026-06-20T10:00:00+08:00",
    eventEnd: "2026-06-20T14:00:00+08:00",
    eventDate: "2026/06/20 上午 10:00 – 下午 2:00",
    mapUrl: "", surveyId: "", surveyTarget: "全部報名",
    createdAt: "2026-05-29T10:00:00+08:00", updatedAt: "2026-05-29T10:00:00+08:00",
    reminderSentAt: "", reminderSentLineIds: [],
  },
  {
    eventId: "EVT_20260705_0002",
    eventName: "里民健康篩檢服務",
    status: "報名中",
    eventLocation: "歐米里里民活動中心 一樓大廳",
    description: "台中市衛生局與本里合作，提供免費健康篩檢服務，包含血壓、血糖、BMI、視力等基本項目。本活動採預約制，名額有限，歡迎里民踴躍報名。",
    imageUrl: "",
    quota: 50,
    registeredCount: 12,
    requireConsent: true,
    questions: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "phone", label: "聯絡電話", type: "text", required: true },
      { key: "birthYear", label: "出生年次（民國）", type: "text", required: true },
    ],
    registrationSheet: "REG_EVT_20260705_0002",
    registrationStart: "2026-05-29T00:00:00+08:00",
    registrationEnd: "2026-07-03T23:59:00+08:00",
    eventStart: "2026-07-05T09:00:00+08:00",
    eventEnd: "2026-07-05T12:00:00+08:00",
    eventDate: "2026/07/05 上午 9:00 – 12:00",
    mapUrl: "", surveyId: "", surveyTarget: "全部報名",
    createdAt: "2026-05-29T10:00:00+08:00", updatedAt: "2026-05-29T10:00:00+08:00",
    reminderSentAt: "", reminderSentLineIds: [],
  },
  {
    eventId: "EVT_20260614_0003",
    eventName: "大坑步道環境清潔日",
    status: "報名中",
    eventLocation: "大坑風景區 第一登山步道入口",
    description: "響應環保！本次清潔活動將清掃大坑第一步道沿途垃圾，清潔工具由里辦公室提供，完成後提供點心飲料。歡迎闔家大小、親子同行！",
    imageUrl: "",
    quota: 40,
    registeredCount: 8,
    requireConsent: false,
    questions: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "phone", label: "聯絡電話", type: "text", required: true },
      { key: "headcount", label: "參加人數（含本人）", type: "number", required: false },
    ],
    registrationSheet: "REG_EVT_20260614_0003",
    registrationStart: "2026-05-29T00:00:00+08:00",
    registrationEnd: "2026-06-12T23:59:00+08:00",
    eventStart: "2026-06-14T07:30:00+08:00",
    eventEnd: "2026-06-14T11:00:00+08:00",
    eventDate: "2026/06/14 上午 7:30 – 11:00",
    mapUrl: "", surveyId: "", surveyTarget: "全部報名",
    createdAt: "2026-05-29T10:00:00+08:00", updatedAt: "2026-05-29T10:00:00+08:00",
    reminderSentAt: "", reminderSentLineIds: [],
  },
];

async function importDemoEvents() {
  console.log("\n🎪 活動（DEMO）");
  const res = await post(OM.events, {
    action: "importBundle",
    importToken: IMPORT_TOKEN,
    bundle: { events: DEMO_EVENTS },
  });
  if (!res.success) throw new Error(`importBundle 失敗：${res.error}`);
  console.log(`  ✅ 匯入 ${res.imported?.events ?? 0} 筆 DEMO 活動`);
}

async function main() {
  if (!IMPORT_TOKEN) {
    console.error("請先設定環境變數 IMPORT_TOKEN");
    console.error("PowerShell: $env:IMPORT_TOKEN=\"omnbhs-cases-419511c1c308\"; node import-from-hpnbhs.mjs");
    process.exit(1);
  }

  console.log("=== 從和平里複製 DEMO 資料到歐米里 ===");
  await importCases();
  await importBulletins();
  await importStores();
  await importDemoEvents();
  console.log("\n🎉 完成！");
}

main().catch((err) => {
  console.error("\n❌ 錯誤：", err.message);
  process.exit(1);
});
