import assert from "node:assert/strict";
import test from "node:test";

import { buildReportUrl, buildReportInviteBubble } from "../workers/events-api/src/line.js";

// 圖文選單「案件通報」改成 postback 之後，機器人要回一張帶身分的卡片，
// 里長才知道案件是哪個 LINE 帳號通報的。
function createEnv() {
  const writes = [];
  return {
    writes,
    LINE_CHANNEL_ACCESS_TOKEN: "test-token",
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return { async run() { writes.push({ sql, values }); return { success: true }; } };
          },
        };
      },
    },
  };
}

function stubProfile(displayName) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    return new Response(JSON.stringify({ userId: "U-abc", displayName }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("通報連結只帶短效 token，LINE 身分留在 D1", async () => {
  const stub = stubProfile("王小明");
  const env = createEnv();
  try {
    const url = await buildReportUrl(env, "U-abc");
    assert.equal(stub.calls[0].url, "https://api.line.me/v2/bot/profile/U-abc");
    assert.equal(stub.calls[0].auth, "Bearer test-token");

    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://gsnbhs.pages.dev/report");
    assert.match(parsed.searchParams.get("reportToken"), /^[0-9a-f-]{36}$/);
    assert.equal(parsed.searchParams.get("lineUserId"), null);
    assert.equal(parsed.searchParams.get("displayName"), null);
    assert.deepEqual(env.writes[0].values.slice(1), ["U-abc", "王小明"]);
  } finally {
    stub.restore();
  }
});

test("名稱含 & 或空白也能安全存進 token 資料列", async () => {
  const stub = stubProfile("A&B 里民");
  const env = createEnv();
  try {
    const parsed = new URL(await buildReportUrl(env, "U-abc"));
    assert.equal(parsed.searchParams.get("displayName"), null);
    assert.equal(parsed.searchParams.get("lineUserId"), null);
    assert.deepEqual(env.writes[0].values.slice(1), ["U-abc", "A&B 里民"]);
  } finally {
    stub.restore();
  }
});

test("拿不到身分時仍給得出可用的通報連結", async () => {
  const env = createEnv();
  assert.equal(await buildReportUrl(env, ""), "https://gsnbhs.pages.dev/report");

  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 401 });
  try {
    // 取 profile 失敗時仍把 userId 安全存在 D1，網址只帶 token。
    const parsed = new URL(await buildReportUrl(env, "U-abc"));
    assert.match(parsed.searchParams.get("reportToken"), /^[0-9a-f-]{36}$/);
    assert.equal(parsed.searchParams.get("lineUserId"), null);
    assert.equal(parsed.searchParams.get("displayName"), null);
    assert.deepEqual(env.writes[0].values.slice(1), ["U-abc", ""]);
  } finally {
    globalThis.fetch = original;
  }
});

test("卡片按鈕只帶短效 token，不帶 LINE 身分", () => {
  const url = "https://gsnbhs.pages.dev/report?reportToken=123e4567-e89b-12d3-a456-426614174000";
  const bubble = buildReportInviteBubble(url);

  assert.equal(bubble.type, "flex");
  assert.equal(bubble.altText, "案件通報");
  const button = bubble.contents.footer.contents[0];
  assert.equal(button.action.type, "uri");
  assert.equal(button.action.uri, url);
  assert.equal(button.action.label, "開始填寫通報");
});
