import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const modules = [
  "admin", "adminreport", "bulletin", "bulletinlist", "detail", "eventdetail",
  "eventlist", "list", "opendetail", "openlist", "report", "store",
  "storedetail", "storelist", "storeopendetail", "storeopenlist", "survey", "voucher",
  "eventopenlist",
];

// 版面各里不同的頁面改用舊社里專屬檔，不吃 shared/<name>.js
const ownLayoutPages = {
  storeopenlist: "./assets/storefront-map.js",
  eventopenlist: "./assets/eventopenlist.js",
};

test("all feature pages use the platform core with correct load order", () => {
  for (const name of modules) {
    const html = fs.readFileSync(new URL(`../${name}.html`, import.meta.url), "utf8");
    const ownScript = ownLayoutPages[name];
    // 換版面時要能帶 ?v= 破快取，所以版本參數要放行
    const sharedMatch = new RegExp(`src="\\./shared/${name}\\.js(?:\\?[^"]*)?"`).exec(html);
    const sharedAt = ownScript
      ? html.indexOf(`src="${ownScript}`)
      : (sharedMatch ? sharedMatch.index : -1);
    assert.notEqual(sharedAt, -1, `${name}: missing page script`);
    if (ownScript) {
      // 專屬版面頁不該再載入共用版面，否則兩份渲染會打架
      assert.equal(html.indexOf(`src="./shared/${name}.js"`), -1, `${name}: must not load shared layout`);
    }
    if (name === "voucher") continue;
    const config = /src=["'](?:\.\/)?(?:store)?config\.js["']/.exec(html);
    const utils = /src=["'](?:\.\/)?utils\.js["']/.exec(html);
    assert.ok(config && config.index < sharedAt, `${name}: config must load first`);
    assert.ok(utils && utils.index < sharedAt, `${name}: utils must load first`);
  }
});

test("platform pages have the GSNBHS Open Graph identity", () => {
  for (const name of ["index", ...modules]) {
    const html = fs.readFileSync(new URL(`../${name}.html`, import.meta.url), "utf8");
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta property="og:image" content="https:\/\/gsnbhs\.pages\.dev\/圖庫\/S__27246628_0\.jpg">/);
    assert.doesNotMatch(html, /HP_logo\.png/);
  }
});

test("shared scripts use dynamic village namespaces", () => {
  for (const name of modules) {
    if (ownLayoutPages[name]) continue;
    const script = fs.readFileSync(new URL(`../shared/${name}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(script, /(?:gsnbhs|gznbhs|hpnbhs|omnbhs)_(?:admin|event|bulletin)/i, name);
  }
});

test("platform Worker fields and safe case authentication are present", () => {
  const stores = fs.readFileSync(new URL("../workers/stores-api/src/index.js", import.meta.url), "utf8");
  const bulletins = fs.readFileSync(new URL("../workers/bulletins-api/src/index.js", import.meta.url), "utf8");
  const cases = fs.readFileSync(new URL("../workers/cases-api/src/index.js", import.meta.url), "utf8");
  assert.match(stores, /lineDisplayName:\s*text\(data\.lineDisplayName\)/);
  assert.match(bulletins, /linkUrl:\s*text\(data\.linkUrl\)/);
  assert.match(cases, /async function getPublicCases/);
  const authAt = cases.indexOf("await requireAdmin(env, data);", cases.indexOf("All remaining actions"));
  const handlerAt = cases.indexOf("const result = await", authAt);
  assert.ok(authAt > 0 && handlerAt > authAt);
  assert.doesNotMatch(cases.slice(authAt, handlerAt), /Promise\.all/);
});
