import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../eventopenlist.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../assets/eventopenlist.js", import.meta.url), "utf8");
const page = html + "\n" + script;

test("public event page reads only the public endpoint", () => {
  assert.match(script, /action: 'getPublicEvents'/);
  // 後台專用的查詢不該出現在公開頁
  for (const adminAction of ["getEvents", "getRegistrations", "getEventStats", "getEventDetailBundle"]) {
    assert.doesNotMatch(script, new RegExp(`action:\\s*['"]${adminAction}['"]`), adminAction);
  }
  assert.doesNotMatch(page, /sessionToken|id_token/);
});

test("registration is handed off to the official LINE account, not collected on the page", () => {
  assert.match(script, /line\.me\/R\/oaMessage/);
  assert.match(script, /我要報名/);
  assert.doesNotMatch(script, /submitRegistration/);
  assert.doesNotMatch(html, /<form/i);
  assert.doesNotMatch(html, /<input/i);
});

test("event page shows the fields the village chief asked for", () => {
  for (const label of ["活動時間", "報名期間", "報名開始", "報名截止", "已報名"]) {
    assert.ok(page.includes(label), `缺少 ${label}`);
  }
  assert.match(script, /registeredCount/);
  assert.match(script, /isFull/);
});

test("event page reuses the shared bulletin layout stylesheet", () => {
  assert.match(html, /assets\/bulletin-news\.css/);
  assert.match(html, /assets\/theme\.css/);
});
