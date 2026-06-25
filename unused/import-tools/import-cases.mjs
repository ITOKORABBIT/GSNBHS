// 資料遷移：從 GAS Sheets 匯入案件到 D1
// 使用方式：node import-cases.mjs
//
// 前置作業：
//   1. 在 apps-script.gs 加入 exportCasesForD1 action 並重新部署
//   2. 在 CF Dashboard 建立 D1 hpnbhs-cases-db 並執行 schema.sql
//   3. 部署 hpnbhs-cases-api Worker

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbzrkTqHoddzXyCj5dlRlmZL2eAFrr8zeqJ9IiVIJnc59g7ibZjZ8wAxxGdrJnyQkaatTw/exec";
const WORKER_URL = "https://hpnbhs-cases-api.ulch0709.workers.dev";
const IMPORT_TOKEN = process.env.IMPORT_TOKEN || ""; // 從環境變數讀取，勿寫死

async function main() {
  if (!IMPORT_TOKEN) {
    console.error("請先設定環境變數 IMPORT_TOKEN");
    process.exit(1);
  }

  console.log("Step 1: 從 GAS 匯出案件資料...");
  const gasResp = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "exportCasesForD1", importToken: IMPORT_TOKEN }),
  });
  const gasData = await gasResp.json();
  if (!gasData.success) {
    console.error("GAS 匯出失敗：", gasData.error);
    process.exit(1);
  }
  const cases = gasData.cases || [];
  console.log(`  取得 ${cases.length} 筆案件`);

  if (cases.length === 0) {
    console.log("沒有案件需要匯入");
    return;
  }

  console.log("Step 2: 匯入到 D1 Worker...");
  const workerResp = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "importCases", importToken: IMPORT_TOKEN, cases }),
  });
  const workerData = await workerResp.json();
  if (!workerData.success) {
    console.error("Worker 匯入失敗：", workerData.error);
    process.exit(1);
  }
  console.log(`  成功匯入 ${workerData.imported} 筆`);
  console.log("完成！importId:", workerData.importId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
