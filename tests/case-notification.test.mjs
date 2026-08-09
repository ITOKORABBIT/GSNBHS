import assert from "node:assert/strict";
import test from "node:test";

import worker from "../workers/cases-api/src/index.js";

function createReportHarness({ hubOk }) {
  const hubRequests = [];
  const notificationWrites = [];
  const waits = [];

  const env = {
    ALLOWED_ORIGIN: "https://gsnbhs.pages.dev",
    NOTIFY_HUB_URL: "https://village-notify-hub.example/notify",
    NOTIFY_HUB_SECRET: "test-secret",
    NOTIFY_HUB_VILLAGE_CODE: "GSNBHS",
    NOTIFY_HUB: {
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
                if (sql.includes("INSERT INTO case_notifications")) {
                  notificationWrites.push(values);
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  const ctx = {
    waitUntil(promise) {
      waits.push(promise);
    },
  };

  return { env, ctx, waits, hubRequests, notificationWrites };
}

function reportRequest() {
  return new Request("https://gsnbhs-cases-api.example", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "submitReport",
      formTs: Date.now() - 5000,
      website: "",
      name: "測試里民",
      phone: "0912345678",
      cate: "道路問題",
      title: "測試案件",
      desc: "路面需要處理",
      addr: "測試路段",
      map: "https://maps.example/test",
    }),
  });
}

test("public report sends a truthful Flex notification through the village hub", async () => {
  const harness = createReportHarness({ hubOk: true });
  const response = await worker.fetch(reportRequest(), harness.env, harness.ctx);
  await Promise.all(harness.waits);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.notificationSent, true);
  assert.match(body.caseId, /^GS\d{6}001$/);

  assert.equal(harness.hubRequests.length, 1);
  assert.equal(harness.hubRequests[0].authorization, "Bearer test-secret");
  assert.equal(harness.hubRequests[0].body.villageCode, "GSNBHS");
  const [message] = harness.hubRequests[0].body.messages;
  assert.equal(message.type, "flex");
  assert.match(message.altText, new RegExp(body.caseId));
  assert.equal(message.contents.footer.contents[0].action.uri, `https://gsnbhs.pages.dev/detail.html?id=${body.caseId}`);

  assert.equal(harness.notificationWrites.length, 1);
  assert.equal(harness.notificationWrites[0][0], body.caseId);
  assert.equal(harness.notificationWrites[0][1], "sent");
  assert.equal(harness.notificationWrites[0][2], "");
});

test("report remains accepted while a failed group notification is recorded honestly", async () => {
  const harness = createReportHarness({ hubOk: false });
  const response = await worker.fetch(reportRequest(), harness.env, harness.ctx);
  await Promise.all(harness.waits);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.notificationSent, false);
  assert.equal(harness.notificationWrites.length, 1);
  assert.equal(harness.notificationWrites[0][1], "failed");
  assert.equal(harness.notificationWrites[0][2], "hub notify failed");
});
