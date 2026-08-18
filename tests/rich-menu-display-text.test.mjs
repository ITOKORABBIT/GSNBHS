import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../apps-script.gs", import.meta.url), "utf8");

test("every rich-menu postback shows immediate display text", () => {
  const actions = new Map([
    ["action=menu&menu=news", "最新消息"],
    ["action=menu&menu=course", "教育課程"],
    ["action=menu&menu=store", "商圈優惠"],
    ["action=menu&menu=emergency", "緊急聯絡"],
    ["action=menu&menu=chat_start", "只想聊聊"],
    ["action=menu&menu=case_report", "案件通報"],
    ["action=menu&menu=apply_event", "活動報名"],
    ["action=menu&menu=apply_course", "課程報名"],
  ]);

  for (const [data, displayText] of actions) {
    const definition = source.split(/\r?\n/).find((line) => line.includes(`data: "${data}"`));
    assert.ok(definition, `missing rich-menu action ${data}`);
    assert.match(definition, new RegExp(`displayText: "${displayText}"`));
  }
});

test("main rich-menu logo has no tap action", () => {
  assert.doesNotMatch(source, /label: "舊社里首頁"/);
  assert.doesNotMatch(source, /bounds: \{ x: 0, y: 0, width: 2500, height: LOGO_BAND_H_ \}/);
});

test("main rich menu opens automatically when the chat is entered", () => {
  const mainStart = source.indexOf("main: {");
  const findChiefStart = source.indexOf("findchief: {", mainStart);
  const mainDefinition = source.slice(mainStart, findChiefStart);

  assert.ok(mainStart >= 0 && findChiefStart > mainStart, "missing main rich-menu definition");
  assert.match(mainDefinition, /selected: true/);
  assert.match(source, /selected: def\.selected === true/);
});

test("圖文選單的憑證不會連帶喚醒共用腳本裡的伯瑞里回訊息流程", () => {
  // replyLine_ 仍然只看 LINE_CHANNEL_ACCESS_TOKEN_；沒設就維持沉睡，
  // 否則舊社里的里民打「通報」會同時收到兩套機器人的回覆。
  assert.match(source, /function replyLine_\(replyToken, messages\) \{\s*\n\s*var token = LINE_CHANNEL_ACCESS_TOKEN_;/);

  // 圖文選單改走自己的 token，來源是 Channel ID／Secret
  assert.match(source, /function richMenuAuthHeader_\(\) \{\s*\n\s*return \{ Authorization: "Bearer " \+ richMenuAccessToken_\(\) \};/);
  assert.match(source, /grant_type: "client_credentials"/);
  assert.doesNotMatch(source, /SCRIPT_PROPS_\.setProperty\("LINE_CHANNEL_ACCESS_TOKEN"/);
});

test("找里長選單重建在讀不到現有選單時直接失敗，不會假裝有回復點", () => {
  const start = source.indexOf("function rebuildFindchiefMenu()");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.ok(start > 0, "missing rebuildFindchiefMenu");
  assert.match(body, /讀取現有圖文選單失敗/);
});
