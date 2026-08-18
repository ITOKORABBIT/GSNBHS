import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pages = readdirSync(root).filter((name) => name.endsWith(".html"));

test("no public page still points at the 和平里 HP_logo", () => {
  for (const name of pages) {
    const page = readFileSync(new URL(name, root), "utf8");
    assert.doesNotMatch(page, /HP_logo\.png/, `${name} 仍引用 HP_logo.png`);
  }
});

test("pages with a favicon use the GSNBHS logo", () => {
  for (const name of pages) {
    const page = readFileSync(new URL(name, root), "utf8");
    for (const href of page.match(/<link rel="[^"]*icon[^"]*" [^>]*href="([^"]+)"/g) ?? []) {
      assert.match(href, /圖庫\/S__27246628_0\.jpg/, `${name} 的 icon 不是 GSNBHS logo：${href}`);
    }
  }
});
