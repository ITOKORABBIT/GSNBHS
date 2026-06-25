/**
 * import-bulletins.mjs
 * 從 GAS 抓所有公告並匯入 bulletins-api Worker D1
 *
 * 使用方式（需先建好 D1 並部署 Worker）：
 *   node import-bulletins.mjs
 *
 * 需先在腳本頂部填入正確值：
 *   GAS_URL         = GAS 部署 URL
 *   WORKER_URL      = bulletins-api Worker URL
 *   IMPORT_TOKEN    = Worker 的 IMPORT_TOKEN secret
 *   ADMIN_SESSION   = 管理員 GAS sessionToken（由任一管理頁面 localStorage 取得）
 */

const GAS_URL      = "https://script.google.com/macros/s/AKfycbzrkTqHoddzXyCj5dlRlmZL2eAFrr8zeqJ9IiVIJnc59g7ibZjZ8wAxxGdrJnyQkaatTw/exec";
const WORKER_URL   = "https://hpnbhs-bulletins-api.ulch0709.workers.dev";
const IMPORT_TOKEN = ""; // 填入 CF Dashboard → bulletins-api → Settings → Variables → IMPORT_TOKEN
const ADMIN_SESSION = ""; // 從 localStorage.getItem("hpnbhs_admin") 取 sessionToken

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  if (!IMPORT_TOKEN) {
    console.error("請先填入 IMPORT_TOKEN");
    process.exit(1);
  }
  if (!ADMIN_SESSION) {
    console.error("請先填入 ADMIN_SESSION");
    process.exit(1);
  }

  console.log("1. 從 GAS 取得所有公告…");
  const gasRes = await post(GAS_URL, {
    action: "getBulletins",
    sessionToken: ADMIN_SESSION,
  });
  if (!gasRes.success) {
    console.error("GAS 回傳錯誤：", gasRes.error);
    process.exit(1);
  }
  const bulletins = gasRes.bulletins || [];
  console.log(`   取得 ${bulletins.length} 筆公告`);

  if (bulletins.length === 0) {
    console.log("GAS 無公告資料，結束。");
    return;
  }

  console.log("2. 匯入到 bulletins-api Worker…");
  const importRes = await post(WORKER_URL, {
    action: "importBulletins",
    importToken: IMPORT_TOKEN,
    bulletins,
  });

  if (!importRes.success) {
    console.error("匯入失敗：", importRes.error);
    process.exit(1);
  }
  console.log(`   匯入完成：${importRes.imported} 筆`);

  console.log("3. 驗證：從 Worker 讀取公告列表…");
  const checkRes = await post(WORKER_URL, { action: "getPublicBulletins" });
  console.log(`   Worker 公開公告筆數：${(checkRes.bulletins || []).length}`);
  console.log("完成！");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
