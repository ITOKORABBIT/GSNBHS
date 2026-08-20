import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const modules = [
  "admin", "adminreport", "bulletin", "bulletinlist", "detail", "eventdetail",
  "eventlist", "list", "opendetail", "openlist", "report", "store",
  "storedetail", "storelist", "storeopendetail", "storeopenlist", "survey", "voucher",
];

test("all feature pages use the platform core with correct load order", () => {
  for (const name of modules) {
    const html = fs.readFileSync(new URL(`../${name}.html`, import.meta.url), "utf8");
    const sharedAt = html.indexOf(`src="./shared/${name}.js"`);
    assert.notEqual(sharedAt, -1, `${name}: missing shared script`);
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
