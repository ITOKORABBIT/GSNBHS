import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(new URL("../eventdetail.html", import.meta.url), "utf8");
const list = readFileSync(new URL("../eventlist.html", import.meta.url), "utf8");
const listJs = readFileSync(new URL("../shared/eventlist.js", import.meta.url), "utf8");
const scheduled = readFileSync(new URL("../workers/events-api/src/scheduled.js", import.meta.url), "utf8");

function optionValues(html) {
  return [...html.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]);
}

test("後台狀態選單涵蓋排程自動設定的狀態", () => {
  // closeEndedEvents 會把過期活動改成「已結束」。後台選不到的話，
  // 里長一動下拉就會把狀態改掉，所以兩邊必須對得上。
  const autoStatuses = [...scheduled.matchAll(/SET status = '([^']+)'/g)].map((m) => m[1]);
  assert.ok(autoStatuses.length > 0, "排程沒有自動設定狀態？先確認 scheduled.js");

  const options = optionValues(detail);
  for (const status of autoStatuses) {
    assert.ok(options.includes(status), `編輯頁少了排程會設定的狀態：${status}`);
    assert.match(listJs, new RegExp(`statusOptions=\\[[^\\]]*'${status}'`), `清單頁下拉少了：${status}`);
  }
});

test("已結束在後台三個地方都看得到", () => {
  assert.ok(optionValues(detail).includes("已結束"));
  assert.match(listJs, /statusOptions=\['草稿','報名中','已截止','已結束'\]/);
  assert.match(list, /data-filter="已結束"/);
  assert.match(list, /\.badge\.gold\{/);
  assert.match(listJs, /badge gold">已結束/);
});

test("沒對應到的狀態不會被硬寫成已截止", () => {
  // 舊寫法是「不是報名中也不是草稿就顯示已截止」，會把已結束講成已截止
  assert.doesNotMatch(listJs, /:\s*'<span class="badge red">已截止<\/span>';/);
  assert.match(listJs, /badge red">\$\{esc\(e\.status\|\|'已截止'\)\}/);
});
