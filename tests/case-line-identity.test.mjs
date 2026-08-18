import assert from "node:assert/strict";
import test from "node:test";

import worker from "../workers/cases-api/src/index.js";

// 從 LINE（LIFF）進來的通報要把通報人的 LINE 身分一路帶到 D1 與里長群組卡片；
// 用瀏覽器直接開表單的通報沒有這兩個值，行為必須完全不變。
function createHarness() {
  const caseInserts = [];
  const hubRequests = [];
  const waits = [];

  const env = {
    ALLOWED_ORIGIN: "https://gsnbhs.pages.dev",
    NOTIFY_HUB_URL: "https://village-notify-hub.example/notify",
    NOTIFY_HUB_SECRET: "test-secret",
    NOTIFY_HUB_VILLAGE_CODE: "GSNBHS",
    NOTIFY_HUB: {
      async fetch(request) {
        hubRequests.push(JSON.parse(await request.text()));
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() {
                if (sql.includes("report_dedupe")) return null;
                if (sql.includes("MAX(CAST")) return { maxSeq: 0 };
                return null;
              },
              async run() {
                // generateCaseId 也會 INSERT INTO cases 佔號，只收完整的案件寫入那一句
                if (sql.includes("line_display_name")) caseInserts.push({ sql, values });
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  return { env, ctx: { waitUntil: (p) => waits.push(p) }, waits, caseInserts, hubRequests };
}

function reportRequest(extra) {
  return new Request("https://gsnbhs-cases-api.example", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "submitReport",
      formTs: Date.now() - 5000,
      website: "",
      name: "測試里民",
      phone: "0912345678",
      cate: "交通",
      title: "測試案件",
      desc: "路面需要處理",
      addr: "測試路段",
      map: "https://maps.example/test",
      ...extra,
    }),
  });
}

function flexRowValue(message, label) {
  const rows = message.contents.body.contents;
  const hit = rows.find((r) => r.contents?.[0]?.text === label);
  return hit ? hit.contents[1].text : undefined;
}

test("從 LINE 進來的通報會存下 LINE 名稱與 userId，群組卡片也看得到", async () => {
  const h = createHarness();
  const response = await worker.fetch(
    reportRequest({ lineUserId: "U1234567890abcdef", lineDisplayName: "王小明" }),
    h.env,
    h.ctx,
  );
  await Promise.all(h.waits);
  const body = await response.json();
  assert.equal(body.success, true);

  // 專屬欄位有寫進 D1
  assert.equal(h.caseInserts.length, 1);
  const insert = h.caseInserts[0];
  assert.match(insert.sql, /line_user_id/);
  assert.ok(insert.values.includes("U1234567890abcdef"));
  assert.ok(insert.values.includes("王小明"));

  // payload_json 也要有，因為後台詳情頁是讀這一份
  const payload = JSON.parse(insert.values[insert.values.length - 1]);
  assert.equal(payload.lineUserId, "U1234567890abcdef");
  assert.equal(payload.lineDisplayName, "王小明");

  // 里長群組卡片多一列 LINE 名稱，且原有欄位沒被擠掉
  const [message] = h.hubRequests[0].messages;
  assert.equal(flexRowValue(message, "LINE 名稱"), "王小明");
  assert.equal(flexRowValue(message, "通報人"), "測試里民（0912345678）");
  assert.equal(flexRowValue(message, "編號"), body.caseId);
});

test("瀏覽器直接開表單的通報照常成立，卡片不會多出空的 LINE 名稱列", async () => {
  const h = createHarness();
  const response = await worker.fetch(reportRequest(), h.env, h.ctx);
  await Promise.all(h.waits);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.notificationSent, true);

  const payload = JSON.parse(h.caseInserts[0].values[h.caseInserts[0].values.length - 1]);
  assert.equal(payload.lineUserId, "");
  assert.equal(payload.lineDisplayName, "");

  const [message] = h.hubRequests[0].messages;
  assert.equal(flexRowValue(message, "LINE 名稱"), undefined);
  assert.equal(flexRowValue(message, "通報人"), "測試里民（0912345678）");
});
