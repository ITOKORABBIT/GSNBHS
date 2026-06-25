import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function page(name) {
  return fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
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
  assert.match(page("store.html"), /getPublicStoreTaxonomy/);
  assert.match(page("storedetail.html"), /getPublicStoreTaxonomy/);
});

test("public store detail returns to the store list without an apply action", () => {
  const html = page("storeopendetail.html");
  assert.match(html, /返回商家列表/);
  assert.match(html, /window\.location\.href='storeopenlist\.html'/);
  assert.doesNotMatch(html, /class="apply-btn"/);
});

test("public store list cards mirror the approved store card hierarchy", () => {
  const html = page("storeopenlist.html");
  assert.match(html, /thumb-view-badge/);
  assert.match(html, /card-offer-divider/);
  assert.match(html, /card-offer-label">優惠活動/);
  assert.match(html, /card-address/);
  assert.match(html, /<a href="' \+ esc\(d\.pubMapUrl\)[\s\S]*card-address-text/);
  assert.doesNotMatch(html, />地圖<\/a>/);
  assert.doesNotMatch(html, /if \(d\.pubDesc\) html \+= '<div class="card-desc">/);
});
