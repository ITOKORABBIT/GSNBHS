import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(name) {
  return fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
}

// 里長從 LINE 卡片點進審核頁時沒有 session，會先被送到清單頁登入。
// 那個跳板頁若留在瀏覽器歷史裡，審核完按返回會回到跳板，跳板又把人送回審核頁，
// 畫面就停在清單的「載入中…」——里長回報的「卡住」。
test("登入跳板不留在瀏覽器歷史，返回清單不會被彈回審核頁", () => {
  const storedetail = read("shared/storedetail.js");
  assert.match(storedetail, /location\.replace\('storelist\.html\?redirect='/);
  assert.doesNotMatch(storedetail, /location\.href = 'storelist\.html\?redirect='/);

  const list = read("shared/list.js");
  const detail = read("shared/detail.js");
  const adminreport = read("shared/adminreport.js");
  for (const [name, src] of [["list", list], ["detail", detail], ["adminreport", adminreport]]) {
    assert.doesNotMatch(src, /location\.href = 'admin\.html\?redirect='/, name + " 仍用 location.href 導向登入頁");
  }
});

test("清單頁帶 redirect 時先跳轉，不先畫出載入中的骨架", () => {
  const storelist = read("shared/storelist.js");
  const enterApp = storelist.slice(storelist.indexOf("function enterApp()"));
  const redirectIdx = enterApp.indexOf("location.replace(redirect)");
  const shellIdx = enterApp.indexOf("appShell");
  assert.ok(redirectIdx > 0, "enterApp 應該用 location.replace 跳轉");
  assert.ok(redirectIdx < shellIdx, "跳轉要排在顯示 appShell 之前");
});

test("手機版清單頁首標題單獨一列置中", () => {
  const html = read("storelist.html");
  const mobile = html.slice(html.indexOf("@media(max-width: 480px)"));
  assert.match(mobile, /\.page-header\{[^}]*flex-wrap: wrap/);
  assert.match(mobile, /\.page-header\{[^}]*justify-content: center/);
  assert.match(mobile, /\.header-title\{[^}]*flex: 0 0 100%/);
  // header 在手機變高，篩選列的 sticky 位置要跟著改，否則會蓋住或留一條縫
  assert.match(mobile, /\.filter-wrap\{ top: 0/);
});
