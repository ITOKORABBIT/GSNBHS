import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const workerDirs = ["events-api", "cases-api", "stores-api", "bulletins-api"];

function readJson(relativePath) {
  const jsonc = readFileSync(new URL(relativePath, projectRoot), "utf8");
  return JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, ""));
}

test("all GSNBHS workers bind to the existing consolidated D1 database", () => {
  const expectedName = "gsnbhs-db";
  const expectedId = "3fb4a75a-7f61-480a-9ad2-dc4421519ad5";

  for (const worker of workerDirs) {
    const config = readJson(`workers/${worker}/wrangler.jsonc`);
    assert.equal(config.d1_databases.length, 1, `${worker} should expose only one D1 binding`);
    assert.equal(config.d1_databases[0].binding, "DB");
    assert.equal(config.d1_databases[0].database_name, expectedName);
    assert.equal(config.d1_databases[0].database_id, expectedId);
  }
});

test("GSNBHS events LINE store lookup uses the primary DB binding", () => {
  const lineJs = readFileSync(new URL("../workers/events-api/src/line.js", import.meta.url), "utf8");
  assert.doesNotMatch(lineJs, /env\.STORES_DB/);
  assert.match(lineJs, /queryStoresDb/);
});
