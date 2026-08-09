import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

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

test("homepage service links stay inside the GSNBHS site", () => {
  for (const path of ["report.html", "openlist.html", "bulletin.html", "storeopenlist.html", "consult.html"]) {
    assert.match(page, new RegExp(`href="\\./${path}"`));
  }
  assert.doesNotMatch(page, /HPNBHS/);
});
