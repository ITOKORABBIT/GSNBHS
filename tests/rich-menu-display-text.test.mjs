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
