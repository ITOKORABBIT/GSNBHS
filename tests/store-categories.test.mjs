import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_STORE_CATEGORIES } from "../workers/stores-api/src/index.js";

const CATEGORIES = ["美食地圖", "飲料冰品", "健康醫療", "生活便利", "學術教育", "運動休閒", "其他各行各業"];
const RETIRED = ["住宅相關", "寵物專區", "里內日常小吃", "家庭好友聚餐", "大坑名產貴賓招待"];

function read(name) {
  return fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
}

test("後台預設分類就是里長那七類", () => {
  assert.deepEqual(DEFAULT_STORE_CATEGORIES, CATEGORIES);
});

test("商家申請表單的類別下拉跟後台同一組", () => {
  const html = read("store.html");
  const options = [...html.matchAll(/<option value="([^"]*)">/g)]
    .map((m) => m[1])
    .filter(Boolean);
  for (const cate of CATEGORIES) assert.ok(options.includes(cate), "申請表單少了「" + cate + "」");
  for (const gone of RETIRED) assert.ok(!options.includes(gone), "申請表單仍留著「" + gone + "」");
});

test("後台清單、審核頁與公開頁用同一組分類", () => {
  const foodCates = CATEGORIES.slice(0, 6);
  for (const file of ["shared/storelist.js", "shared/storeopenlist.js"]) {
    const src = read(file);
    for (const cate of foodCates) assert.match(src, new RegExp(cate), file + " 少了 " + cate);
    for (const gone of ["住宅相關", "寵物專區"]) {
      assert.doesNotMatch(src, new RegExp(gone), file + " 仍留著 " + gone);
    }
  }
  const detail = read("shared/storedetail.js");
  assert.match(detail, /var CATE_OPTIONS = \['美食地圖','飲料冰品','健康醫療','生活便利','學術教育','運動休閒','其他各行各業'\]/);
  // 舊商家掛著已下架的分類時，下拉要把現值補回去，否則存檔會被改成第一項
  assert.match(detail, /cateOptions\.indexOf\(curCate\) === -1\) cateOptions\.unshift\(curCate\)/);
});

test("LINE 美食地圖選單跟著換成新分類", () => {
  const line = read("workers/events-api/src/line.js");
  for (const cate of ["學術教育", "運動休閒"]) assert.match(line, new RegExp(cate));
  for (const gone of ["住宅相關", "寵物專區"]) assert.doesNotMatch(line, new RegExp(gone));
  // 健身歸運動休閒，不要再同時掛在生活便利底下
  assert.doesNotMatch(line, /生活便利: \["生活便利","生活","美容","健身"/);
});

test("後台清單以審核後的公開分類為準", () => {
  const src = read("shared/storelist.js");
  // 里長在審核頁改的是 pubCate，申請時填的 category 不會跟著動；
  // 清單若只看 category，改完分類的店家還是掛在原本的分組。
  assert.match(src, /function storeCate\(d\) \{[\s\S]*d\.pubCate \|\| d\.category/);
  assert.doesNotMatch(src, /FOOD_CATES\.indexOf\(d\.category/);
  assert.doesNotMatch(src, /if \(d\.category\) cats\[d\.category\]/);
  assert.doesNotMatch(src, /var dispCate = d\.category/);
});
