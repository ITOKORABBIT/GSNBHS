import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("homepage uses the official aggregate case stats without synthetic growth", () => {
  assert.match(page, /action:'getPublicStats'/);
  assert.match(page, /typeof CONFIG==='undefined'/);
  assert.match(page, /統計口徑：結案率以「已結案 ÷ 全部案件」計算/);
  assert.match(page, /新系統已於 2026 年 8 月上線，目前尚無新案件/);
  assert.doesNotMatch(page, /Math\.random|setInterval/);
});

test("homepage service links stay inside the GSNBHS site", () => {
  for (const path of ["report.html", "openlist.html", "bulletin.html", "storeopenlist.html", "consult.html"]) {
    assert.match(page, new RegExp(`href="\\./${path}"`));
  }
  assert.doesNotMatch(page, /HPNBHS/);
});
