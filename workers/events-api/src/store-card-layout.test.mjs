import assert from "node:assert/strict";
import test from "node:test";

import { buildEvtListCarousel, buildEvtReminderBubble, buildStoreBubble, buildStoreCarousel, buildStoreItem } from "./line.js";

test("LINE store item keeps square media and a separate offer action row", () => {
  const item = buildStoreItem({
    storeId: "STORE-1",
    photo1: "https://example.com/store.jpg",
    pubName: "和平早餐",
    pubOffer: "消費滿百送小菜",
  });

  assert.equal(item.layout, "vertical");
  assert.equal(item.height, "128px");
  assert.equal(item.contents[0].layout, "horizontal");
  assert.equal(item.contents[0].height, "84px");
  assert.equal(item.contents[0].action.uri, "https://gsnbhs.pages.dev/storeopendetail.html?id=STORE-1");
  assert.equal(item.contents[0].contents[0].aspectRatio, "1:1");
  assert.equal(item.contents[0].contents[1].contents[1].text, "消費滿百送小菜");
  assert.equal(item.contents[0].contents[1].contents[1].maxLines, 4);
  assert.equal(item.contents[1].type, "button");
  assert.equal(item.contents[1].action.label, "品牌介紹");
});

test("LINE store bubble keeps store rows compact", () => {
  const bubble = buildStoreBubble({ title: "里內日常小吃", emoji: "🍱", color: "#F59E0B" }, [
    { storeId: "STORE-1", pubName: "早餐店" },
    { storeId: "STORE-2", pubName: "麵店" },
  ]);

  assert.equal(bubble.body.paddingAll, "12px");
  assert.equal(bubble.body.spacing, "sm");
  assert.equal(bubble.body.contents[1].type, "separator");
  assert.equal(bubble.body.contents[1].margin, "md");
});

test("LINE store carousel shows up to ten cards with three stores each", () => {
  const stores = Array.from({ length: 35 }, (_, index) => ({
    storeId: `STORE-${index + 1}`,
    pubName: `商家 ${index + 1}`,
  }));
  const carousel = buildStoreCarousel("美食地圖", stores);

  assert.equal(carousel.contents.contents.length, 10);
  for (const bubble of carousel.contents.contents) {
    const storeRows = bubble.body.contents.filter((item) => item.type === "box");
    assert.equal(storeRows.length, 3);
  }
});

test("LINE event reminder uses the friendly next-day message", () => {
  const bubble = buildEvtReminderBubble({
    eventName: "社區活動",
    eventStart: "2026-05-23T10:00:00+08:00",
    eventEnd: "2026-05-23T11:00:00+08:00",
  });
  const note = bubble.contents.body.contents.at(-1);

  assert.equal(note.text, "明天見唷！如有問題請聯繫我們。");
});

test("LINE event list card shows the full activity description", () => {
  const carousel = buildEvtListCarousel([{
    eventId: "EVT_1",
    eventName: "社區歌唱班",
    eventDate: "2026/07/21 14:00 - 2026/09/22 16:00",
    eventLocation: "活動中心",
    description: "開頭介紹\n學習亮點\n課程資訊\n聯絡方式",
  }]);
  const description = carousel.contents.contents[0].body.contents.find((item) => item.text?.startsWith("開頭介紹"));

  assert.equal(description.wrap, true);
  assert.equal(description.maxLines, undefined);
  assert.match(description.text, /聯絡方式/);
});
