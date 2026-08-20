import assert from "node:assert/strict";
import test from "node:test";

import worker from "../workers/cases-api/src/index.js";

// 里長在後台回覆案件後，用 LINE 通知通報人本人。
// 里民的 userId 只有 events-api 那支 Worker 的 token 推得動，所以走 service binding。
function createHarness({ existingCase, pushOk = true, withBinding = true }) {
  const pushes = [];
  const writes = [];
  const waits = [];

  const env = {
    ALLOWED_ORIGIN: "https://gsnbhs.pages.dev",
    INTERNAL_PUSH_TOKEN: withBinding ? "internal-secret" : "",
    GAS_SCRIPT_URL: "https://gas.example/exec",
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() {
                if (sql.includes("SELECT payload_json")) {
                  return { payload_json: JSON.stringify(existingCase) };
                }
                return null;
              },
              async run() {
                if (sql.includes("line_display_name")) writes.push(values);
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  if (withBinding) {
    env.EVENTS_API = {
      async fetch(url, init) {
        pushes.push({
          url: String(url),
          token: init.headers["X-Internal-Token"],
          body: JSON.parse(init.body),
        });
        return new Response(JSON.stringify({ success: pushOk }), {
          status: pushOk ? 200 : 502,
          headers: { "content-type": "application/json" },
        });
      },
    };
  }

  return { env, ctx: { waitUntil: (p) => waits.push(p) }, waits, pushes, writes };
}

// requireAdmin 會拿 sessionToken 去 GAS 驗；測試裡讓它通過即可
function stubGas(ok = true) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: ok }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  return () => { globalThis.fetch = original; };
}

const LINE_CASE = {
  caseId: "GS260818003",
  status: "3.已轉交相關單位",
  title: "敦富二街坑洞",
  name: "測試",
  lineUserId: "U50ac077c7e5ea8ba1dc0ce83dab008d6",
  lineDisplayName: "Ommi Chi",
};

function replyRequest(extra) {
  return new Request("https://gsnbhs-cases-api.example", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "updateReply",
      sessionToken: "test-session",
      caseId: "GS260818003",
      status: "4.已結案",
      reply_content: "已請市府修復完成",
      handler: "SO",
      ...extra,
    }),
  });
}

function lastPayload(writes) {
  return JSON.parse(writes[writes.length - 1][writes[writes.length - 1].length - 1]);
}

test("勾選通知時，通報人會收到里長第一人稱的案件回覆", async () => {
  const restore = stubGas();
  const h = createHarness({ existingCase: LINE_CASE });
  await worker.fetch(replyRequest({ notifyReporter: true }), h.env, h.ctx);
  await Promise.all(h.waits);

  assert.equal(h.pushes.length, 1);
  assert.equal(h.pushes[0].token, "internal-secret");
  assert.match(h.pushes[0].url, /\/internal\/line-push$/);
  assert.equal(h.pushes[0].body.to, LINE_CASE.lineUserId);

  const sent = h.pushes[0].body.messages[0].text;
  assert.match(sent, /GS260818003/);
  assert.match(sent, /已請市府修復完成/);
  assert.match(sent, /我的回覆/);
  // 狀態要拿掉後台用的編號前綴
  assert.match(sent, /目前狀態：已結案/);
  assert.doesNotMatch(sent, /4\.已結案/);
  // 不能出現把自己當第三方的說法
  assert.doesNotMatch(sent, /里長會|轉達給里長/);

  assert.equal(lastPayload(h.writes).replyNotify.status, "sent");
  restore();
});

test("沒勾選就不推播", async () => {
  const restore = stubGas();
  const h = createHarness({ existingCase: LINE_CASE });
  await worker.fetch(replyRequest({ notifyReporter: false }), h.env, h.ctx);
  await Promise.all(h.waits);

  assert.equal(h.pushes.length, 0);
  assert.equal(lastPayload(h.writes).replyNotify, undefined);
  restore();
});

test("瀏覽器通報的案件沒有 LINE 身分，記為 skipped 而不是假裝成功", async () => {
  const restore = stubGas();
  const h = createHarness({
    existingCase: { ...LINE_CASE, lineUserId: "", lineDisplayName: "" },
  });
  await worker.fetch(replyRequest({ notifyReporter: true }), h.env, h.ctx);
  await Promise.all(h.waits);

  assert.equal(h.pushes.length, 0);
  const notify = lastPayload(h.writes).replyNotify;
  assert.equal(notify.status, "skipped");
  assert.match(notify.error, /沒有通報人的 LINE 身分/);
  restore();
});

test("推播失敗要誠實記錄，案件回覆本身仍然成功", async () => {
  const restore = stubGas();
  const h = createHarness({ existingCase: LINE_CASE, pushOk: false });
  const res = await worker.fetch(replyRequest({ notifyReporter: true }), h.env, h.ctx);
  await Promise.all(h.waits);

  assert.equal((await res.json()).success, true);
  assert.equal(lastPayload(h.writes).replyNotify.status, "failed");
  restore();
});

test("沒有有效登入時，案件不會被改，也不會發 LINE 給里民", async () => {
  const restore = stubGas(false);
  const h = createHarness({ existingCase: LINE_CASE });
  const res = await worker.fetch(
    replyRequest({ notifyReporter: true, sessionToken: "bogus" }),
    h.env,
    h.ctx,
  );
  await Promise.all(h.waits);

  assert.equal(res.status, 401);
  assert.equal(h.pushes.length, 0);
  assert.equal(h.writes.length, 0);
  restore();
});
