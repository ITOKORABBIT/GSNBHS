import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const adminPage = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const redirects = readFileSync(new URL("../_redirects", import.meta.url), "utf8");
const lineCaseUrl = "https://line.me/R/oaMessage/%40900rucza/?%E6%82%A8%E5%A5%BD%EF%BC%8C%E6%88%91%E6%83%B3%E8%A9%A2%E5%95%8F%E6%A1%88%E4%BB%B6%E9%80%B2%E5%BA%A6";

test("homepage uses the official aggregate case stats without synthetic growth", () => {
  assert.match(page, /action:'getPublicStats'/);
  assert.match(page, /typeof CONFIG==='undefined'/);
  assert.match(page, /案件處理概況/);
  assert.match(page, /目前尚無案件/);
  assert.doesNotMatch(page, /Math\.random|setInterval/);
  assert.doesNotMatch(page, /資料來源|統計口徑|正式案件系統|SERVICE PROGRESS|DIGITAL CIVIC SERVICE|SYSTEM ONLINE|PUBLIC SERVICES|HOW IT WORKS/);
});

test("homepage uses the GSNBHS logo instead of the HPNBHS dove", () => {
  assert.match(page, /圖庫\/S__27246628_0\.jpg/);
  assert.doesNotMatch(page, /HP_logo\.png/);
});

test("demo mode uses labeled sample progress without changing the default data path", () => {
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\('demo'\)==='1'/);
  assert.match(page, /DEMO 示意資料/);
  assert.match(page, /total:68/);
  assert.match(page, /completed:46/);
  assert.match(page, /completionRate:68/);
  assert.match(page, /if\(isDemo\)[\s\S]*renderStats\(demoStats\)[\s\S]*else[\s\S]*loadStats\(\)/);
});

test("case lookup uses the official LINE while other homepage services stay local", () => {
  for (const path of ["report.html", "bulletin.html", "storeopenlist.html", "consult.html"]) {
    assert.match(page, new RegExp(`href="\\./${path}"`));
  }
  assert.equal(page.split(`href="${lineCaseUrl}"`).length - 1, 3);
  assert.match(page, /<span class="service-name">案件查詢<\/span>/);
  assert.match(page, />查看進度<\/a>/);
  assert.match(page, /由里長親自回覆/);
  assert.match(page, /由里長親自協助/);
  assert.doesNotMatch(page, /HPNBHS/);
  assert.doesNotMatch(page, /href="\.\/openlist\.html"|公開頁面會更新/);
});

test("public case pages are retired and admin no longer links to them", () => {
  const redirectLines = new Set(redirects.trim().split(/\r?\n/));
  for (const path of ["/openlist", "/openlist.html", "/opendetail", "/opendetail.html"]) {
    assert.ok(redirectLines.has(`${path} ${lineCaseUrl} 302`));
  }
  assert.doesNotMatch(adminPage, /href="openlist\.html"|href="opendetail\.html/);
});
