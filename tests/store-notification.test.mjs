import assert from "node:assert/strict";
import test from "node:test";

import worker from "../workers/stores-api/src/index.js";

function createSubmitHarness({ hubOk, hubConfigured = true }) {
  const hubRequests = [];

  const env = {
    ALLOWED_ORIGIN: "https://gsnbhs.pages.dev",
    NOTIFY_HUB_VILLAGE_CODE: "GSNBHS",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes("public_rate_limits")) return { request_count: 1 };
                if (sql.includes("public_submission_dedupe")) return { dedupe_key: "dedupe" };
                if (sql.includes("public_sequences")) return { value: 1 };
                return null;
              },
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  if (hubConfigured) {
    env.NOTIFY_HUB_URL = "https://village-notify-hub.example/notify";
    env.NOTIFY_HUB_SECRET = "test-secret";
    env.NOTIFY_HUB = {
      async fetch(request) {
        hubRequests.push({
          authorization: request.headers.get("authorization"),
          body: JSON.parse(await request.text()),
        });
        return new Response(
          JSON.stringify(hubOk ? { success: true } : { success: false, error: "LINE unavailable" }),
          { status: hubOk ? 200 : 502, headers: { "content-type": "application/json" } },
        );
      },
    };
  }

  return { env, hubRequests };
}

function submitRequest() {
  return new Request("https://gsnbhs-stores-api.example", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "submitStore",
      formTs: Date.now() - 5000,
      website: "",
      name: "測試申請人",
      phone: "0912345678",
      title: "測試小吃店",
      storephone: "04-22223333",
      cate: "里內日常小吃",
      addr: "臺中市北屯區舊社里測試路1號",
      desc: "測試用的店家介紹",
      offer: "出示里民身分免費加湯",
      photo1: "https://lh3.googleusercontent.com/d/test",
    }),
  });
}

test("商家申請會把 Flex 卡片送到里的 LINE 群組", async () => {
  const harness = createSubmitHarness({ hubOk: true });
  const response = await worker.fetch(submitRequest(), harness.env, {});
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.notificationSent, true);
  assert.match(body.storeId, /^STOR\d{6}001$/);

  assert.equal(harness.hubRequests.length, 1);
  assert.equal(harness.hubRequests[0].authorization, "Bearer test-secret");
  assert.equal(harness.hubRequests[0].body.villageCode, "GSNBHS");

  const [message] = harness.hubRequests[0].body.messages;
  assert.equal(message.type, "flex");
  assert.match(message.altText, /新商家申請/);
  assert.match(message.altText, /測試小吃店/);
  assert.equal(message.contents.hero.url, "https://lh3.googleusercontent.com/d/test");
  // 卡片網址一定要帶 openExternalBrowser=1，否則里長在 LINE 內建瀏覽器登不進後台。
  assert.equal(
    message.contents.footer.contents[0].action.uri,
    `https://gsnbhs.pages.dev/storedetail.html?id=${body.storeId}&openExternalBrowser=1`,
  );

  const rowText = JSON.stringify(message.contents.body.contents);
  assert.match(rowText, /測試申請人/);
  assert.match(rowText, /臺中市北屯區舊社里測試路1號/);
  assert.match(rowText, /出示里民身分免費加湯/);
});

test("群組推播失敗時，商家的申請仍然照常送出", async () => {
  const harness = createSubmitHarness({ hubOk: false });
  const response = await worker.fetch(submitRequest(), harness.env, {});
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.notificationSent, false);
  assert.match(body.storeId, /^STOR\d{6}001$/);
});

test("通報中心未設定時不會擋住申請", async () => {
  const harness = createSubmitHarness({ hubOk: true, hubConfigured: false });
  const response = await worker.fetch(submitRequest(), harness.env, {});
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.notificationSent, false);
  assert.equal(harness.hubRequests.length, 0);
});
