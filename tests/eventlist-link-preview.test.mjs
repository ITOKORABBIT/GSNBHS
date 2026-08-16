import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../eventlist.html", import.meta.url), "utf8");
const lineWorker = readFileSync(new URL("../workers/events-api/src/line.js", import.meta.url), "utf8");

test("event list link preview uses the GSNBHS logo", () => {
  assert.match(
    page,
    /<meta property="og:image" content="https:\/\/gsnbhs\.pages\.dev\/%E5%9C%96%E5%BA%AB\/S__27246628_0\.jpg\?v=20260816">/,
  );
  assert.match(page, /<link rel="apple-touch-icon" href="\.\/圖庫\/S__27246628_0\.jpg\?v=20260816">/);
  assert.doesNotMatch(page, /HP_logo\.png/);
});

test("event cards without an uploaded image use the public GSNBHS Drive logo", () => {
  assert.match(
    lineWorker,
    /const EVENT_IMG_FALLBACK = "https:\/\/lh3\.googleusercontent\.com\/d\/1GAb13SxqDBjTnnwZZjNubyJEWxqibs-Z";/,
  );
  assert.doesNotMatch(lineWorker, /EVENT_IMG_FALLBACK = "[^"]*HP_logo\.png"/);
});
