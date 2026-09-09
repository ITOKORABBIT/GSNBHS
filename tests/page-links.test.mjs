import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// 頁面之間互連的相對連結，指到的檔案一定要存在。
// 起因：把舊社里的公佈欄複製到其他里時，側欄殘留了該里沒有的 consult.html。
test("internal page links point at files that exist", () => {
  const root = new URL("../", import.meta.url);
  const pages = readdirSync(root).filter((name) => name.endsWith(".html"));
  const broken = [];

  for (const page of pages) {
    const html = readFileSync(new URL(page, root), "utf8");
    for (const match of html.matchAll(/href="\.\/([^"#?]+\.html)(?:[?#][^"]*)?"/g)) {
      const target = decodeURIComponent(match[1]);
      if (!existsSync(new URL(target, root))) broken.push(`${page} → ${target}`);
    }
  }

  assert.deepEqual(broken, [], "有連結指到不存在的頁面");
});
