import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function page(name, extraScript) {
  const html = fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script\s+src=["'](\.\/shared\/[^"']+)["'][^>]*><\/script>/g)]
    .map((match) => fs.readFileSync(new URL("../" + match[1], import.meta.url), "utf8"));
  // 版面各里不同的頁面用自己的 assets/ 腳本，測試要一起讀進來
  if (extraScript) scripts.push(fs.readFileSync(new URL("../" + extraScript, import.meta.url), "utf8"));
  return [html, ...scripts].join("\n");
}

test("store admin list exposes taxonomy manager controls", () => {
  const html = page("storelist.html");
  assert.match(html, /管理類別與標籤/);
  assert.match(html, /page-header[\s\S]*taxonomy-btn[\s\S]*apply-btn/);
  assert.doesNotMatch(html, /<div class="filter-bar">[\s\S]*taxonomy-btn[\s\S]*search-wrap/);
  assert.match(html, /updateStoreTaxonomy/);
  assert.match(html, /effectiveTaxonomy/);
  assert.match(html, /brandTagRenames/);
  assert.match(html, /taxonomy-swatch/);
});

test("store admin cards split metadata from labeled offer content", () => {
  const html = page("storelist.html");
  assert.match(html, /card-date/);
  assert.match(html, /thumb-view-badge/);
  assert.match(html, /getViewStats/);
  assert.match(html, /card-phone/);
  assert.match(html, /d\.storePhone/);
  assert.match(html, /card-address/);
  assert.match(html, /card-offer-divider/);
  assert.match(html, /card-offer-label">優惠活動/);
  assert.match(html, /if \(d\.offer\) html \+= '<div class="card-offer-label">優惠活動/);
});

test("store application and review pages read shared store taxonomy", () => {
  const storeHtml = page("store.html");
  assert.match(storeHtml, /getPublicStoreTaxonomy/);
  assert.match(storeHtml, /uploadedMimeType = \(dataUrl\.match/);
  assert.match(storeHtml, /mimeType: uploadedMimeType/);
  assert.doesNotMatch(storeHtml, /mimeType: file\.type/);
  assert.match(page("storedetail.html"), /getPublicStoreTaxonomy/);
});

test("public store detail returns to the store list without an apply action", () => {
  const html = page("storeopendetail.html");
  assert.match(html, /返回商家列表/);
  assert.match(html, /window\.location\.href='storeopenlist\.html'/);
  assert.doesNotMatch(html, /class="apply-btn"/);
});

test("public store list is the storefront directory layout", () => {
  const html = page("storeopenlist.html", "assets/storefront-map.js");
  assert.match(html, /舊社商圈/);
  assert.match(html, /class="tile"/);                       // 分類導覽磚
  assert.match(html, /shop-views/);                         // 瀏覽數
  assert.match(html, /shop-offer"><b>里民優惠/);             // 優惠區塊
  assert.match(html, /esc\(d\.pubAddr\)/);                   // 地址
  assert.match(html, /esc\(d\.pubMapUrl\)[\s\S]{0,120}導航/); // 導航連 Google Map
  assert.match(html, /tel:' \+ esc\(d\.pubPhone\)/);          // 撥號
  assert.doesNotMatch(html, /pubDesc[\s\S]{0,60}card-desc/);  // 卡片不露出長介紹
});
