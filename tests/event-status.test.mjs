import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(new URL("../eventdetail.html", import.meta.url), "utf8");
const list = readFileSync(new URL("../eventlist.html", import.meta.url), "utf8");
const listJs = readFileSync(new URL("../shared/eventlist.js", import.meta.url), "utf8");
const scheduled = readFileSync(new URL("../workers/events-api/src/scheduled.js", import.meta.url), "utf8");
const line = readFileSync(new URL("../workers/events-api/src/line.js", import.meta.url), "utf8");

function optionValues(html) {
  return [...html.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]);
}

// 後端認得、但後台選不到的狀態，就是里長改不了也看不懂的狀態。
// 「已結束」和「已取消」都是這樣漏掉的，所以從程式碼反推清單。
function backendStatuses() {
  const found = new Set();
  for (const source of [scheduled, line]) {
    for (const m of source.matchAll(/SET status = '([^']+)'/g)) found.add(m[1]);
    for (const m of source.matchAll(/status\s+NOT IN \(([^)]+)\)/g)) {
      for (const v of m[1].matchAll(/'([^']+)'/g)) found.add(v[1]);
    }
    for (const m of source.matchAll(/status === "([^"]+)"/g)) found.add(m[1]);
  }
  // line.js 也管商家與案件，那些是英文狀態（approved 之類），不是活動狀態
  return [...found].filter((v) => /[一-鿿]/.test(v));
}

test("後端認得的活動狀態，後台選單都要能選到", () => {
  const statuses = backendStatuses();
  assert.ok(statuses.length > 0, "沒抓到後端狀態？先確認 scheduled.js / line.js");

  const options = optionValues(detail);
  for (const status of statuses) {
    assert.ok(options.includes(status), `編輯頁少了後端會用到的狀態：${status}`);
    assert.match(listJs, new RegExp(`statusOptions=\\[[^\\]]*'${status}'`), `清單頁下拉少了：${status}`);
  }
});

test("五種狀態在後台三個地方都看得到", () => {
  const options = optionValues(detail);
  for (const status of ["草稿", "報名中", "已截止", "已結束", "已取消"]) {
    assert.ok(options.includes(status), `編輯頁少了 ${status}`);
  }
  assert.match(listJs, /statusOptions=\['草稿','報名中','已截止','已結束','已取消'\]/);
  assert.match(list, /data-filter="已結束"/);
  assert.match(list, /data-filter="已取消"/);
  assert.match(list, /\.badge\.gold\{/);
  assert.match(list, /\.badge\.cancelled\{/);
  assert.match(listJs, /badge gold">已結束/);
  assert.match(listJs, /badge cancelled">已取消/);
});

test("沒對應到的狀態不會被硬寫成已截止", () => {
  // 舊寫法是「不是報名中也不是草稿就顯示已截止」，會把已結束講成已截止
  assert.doesNotMatch(listJs, /:\s*'<span class="badge red">已截止<\/span>';/);
  assert.match(listJs, /badge red">\$\{esc\(e\.status\|\|'已截止'\)\}/);
});
