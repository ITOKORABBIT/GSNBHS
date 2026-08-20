import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const adminPage = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const redirects = readFileSync(new URL("../_redirects", import.meta.url), "utf8");
const lineCaseUrl = "https://line.me/R/oaMessage/%40900rucza/?%E6%82%A8%E5%A5%BD%EF%BC%8C%E6%88%91%E6%83%B3%E8%A9%A2%E5%95%8F%E6%A1%88%E4%BB%B6%E9%80%B2%E5%BA%A6";
const officialLineUrl = "https://line.me/R/oaMessage/%40900rucza";

test("homepage uses the official aggregate case stats without synthetic growth", () => {
  assert.match(page, /action:'getPublicStats'/);
  assert.match(page, /typeof CONFIG==='undefined'/);
  assert.match(page, /案件處理概況/);
  assert.match(page, /目前尚無案件/);
  assert.doesNotMatch(page, /Math\.random|setInterval/);
  assert.doesNotMatch(page, /資料來源|統計口徑|正式案件系統|SERVICE PROGRESS|DIGITAL CIVIC SERVICE|SYSTEM ONLINE|PUBLIC SERVICES|HOW IT WORKS/);
});

test("homepage opens at the top unless an explicit section hash is present", () => {
  assert.match(page, /history\.scrollRestoration='manual'/);
  assert.match(page, /if\(!window\.location\.hash\)requestAnimationFrame\(function\(\)\{window\.scrollTo\(0,0\);\}\)/);
});

test("homepage uses the GSNBHS logo instead of the HPNBHS dove", () => {
  assert.match(page, /圖庫\/S__27246628_0\.jpg/);
  assert.doesNotMatch(page, /HP_logo\.png/);
});

test("hero uses the village logo watermark and keeps portrait rings behind the photo", () => {
  assert.match(page, /background:url\('\.\/圖庫\/S__27246628_0\.jpg'\)[^;]+no-repeat/);
  assert.match(page, /filter:grayscale\(1\) invert\(1\)/);
  assert.doesNotMatch(page, /background-size:52px 52px/);
  assert.match(page, /\.portrait-glow\{[\s\S]*?z-index:0[\s\S]*?mask-image:linear-gradient\(to right/);
  assert.match(page, /\.portrait\{[\s\S]*?z-index:1[\s\S]*?mix-blend-mode:multiply/);
});

test("demo mode uses labeled sample progress without changing the default data path", () => {
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\('demo'\)==='1'/);
  assert.match(page, /DEMO 示意資料/);
  assert.match(page, /total:68/);
  assert.match(page, /completed:46/);
  assert.match(page, /completionRate:68/);
  assert.match(page, /if\(isDemo\)[\s\S]*renderStats\(demoStats\)[\s\S]*else[\s\S]*loadStats\(\)/);
});

test("public cases stay local while personal case lookup remains available through LINE", () => {
  for (const path of ["report.html", "bulletin.html", "storeopenlist.html", "consult.html"]) {
    assert.match(page, new RegExp(`href="\\./${path}"`));
  }
  assert.equal(page.split(`href="${lineCaseUrl}"`).length - 1, 2);
  assert.match(page, /<a class="process-step process-step-link" href="\.\/report\.html">[\s\S]*?<h3>填寫通報<\/h3>/);
  assert.match(page, /href="\.\/openlist\.html"[\s\S]*<span class="service-name">公開案件<\/span>/);
  assert.match(page, />查看進度<\/a>/);
  assert.match(page, /由里長親自協助/);
  assert.doesNotMatch(page, /HPNBHS/);
  assert.doesNotMatch(page, /公開頁面會更新/);
});

test("header LINE ID opens the official account and stays visible on mobile", () => {
  assert.ok(page.includes(`<a class="line-id" href="${officialLineUrl}"`));
  assert.match(page, /aria-label="開啟舊社里官方 LINE"/);
  assert.match(page, /\.top-links>a:not\(\.line-id\)\{display:none\}/);
});

test("homepage footer includes the ITOKO RABBIT copyright", () => {
  assert.match(page, /<div class="footer-copyright">© ITOKO RABBIT<\/div>/);
  assert.doesNotMatch(page, /網頁版權/);
});

test("public case pages are enabled without LINE redirects", () => {
  assert.equal(redirects.trim(), "");
  assert.match(page, /href="\.\/openlist\.html"/);
  assert.match(page, />公開案件</);
});
