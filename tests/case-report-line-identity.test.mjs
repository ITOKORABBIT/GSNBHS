import assert from "node:assert/strict";
import test from "node:test";

import { buildReportUrl, buildReportInviteBubble } from "../workers/events-api/src/line.js";

// 圖文選單「案件通報」改成 postback 之後，機器人要回一張帶身分的卡片，
// 里長才知道案件是哪個 LINE 帳號通報的。
const env = { LINE_CHANNEL_ACCESS_TOKEN: "test-token" };

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

test("通報連結會帶上通報人的 LINE userId 與顯示名稱", async () => {
  const stub = stubProfile("王小明");
  try {
    const url = await buildReportUrl(env, "U-abc");
    assert.equal(stub.calls[0].url, "https://api.line.me/v2/bot/profile/U-abc");
    assert.equal(stub.calls[0].auth, "Bearer test-token");

    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://gsnbhs.pages.dev/report");
    assert.equal(parsed.searchParams.get("lineUserId"), "U-abc");
    assert.equal(parsed.searchParams.get("displayName"), "王小明");
  } finally {
    stub.restore();
  }
});

test("名稱含 & 或空白也不會把連結拆壞", async () => {
  const stub = stubProfile("A&B 里民");
  try {
    const parsed = new URL(await buildReportUrl(env, "U-abc"));
    assert.equal(parsed.searchParams.get("displayName"), "A&B 里民");
    assert.equal(parsed.searchParams.get("lineUserId"), "U-abc");
  } finally {
    stub.restore();
  }
});

test("拿不到身分時仍給得出可用的通報連結", async () => {
  assert.equal(await buildReportUrl(env, ""), "https://gsnbhs.pages.dev/report");

  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 401 });
  try {
    // 取 profile 失敗時至少要留住 userId，不能整個連結壞掉
    const parsed = new URL(await buildReportUrl(env, "U-abc"));
    assert.equal(parsed.searchParams.get("lineUserId"), "U-abc");
    assert.equal(parsed.searchParams.get("displayName"), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("卡片按鈕直接指向帶身分的通報連結", () => {
  const url = "https://gsnbhs.pages.dev/report?lineUserId=U-abc&displayName=%E7%8E%8B%E5%B0%8F%E6%98%8E";
  const bubble = buildReportInviteBubble(url);

  assert.equal(bubble.type, "flex");
  assert.equal(bubble.altText, "案件通報");
  const button = bubble.contents.footer.contents[0];
  assert.equal(button.action.type, "uri");
  assert.equal(button.action.uri, url);
  assert.equal(button.action.label, "開始填寫通報");
});
