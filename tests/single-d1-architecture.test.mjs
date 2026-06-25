import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const workerDirs = ["events-api", "cases-api", "stores-api", "bulletins-api"];

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, projectRoot), "utf8"));
}

test("all OMNBHS workers bind to the existing consolidated D1 database", () => {
  const expectedName = "omnbhs-db";
  const expectedId = "7e30d54c-c1ad-45fe-9b75-cff81e00c84b";

  for (const worker of workerDirs) {
    const config = readJson(`workers/${worker}/wrangler.jsonc`);
    assert.equal(config.d1_databases.length, 1, `${worker} should expose only one D1 binding`);
    assert.equal(config.d1_databases[0].binding, "DB");
    assert.equal(config.d1_databases[0].database_name, expectedName);
    assert.equal(config.d1_databases[0].database_id, expectedId);
  }
});

test("OMNBHS events LINE store lookup uses the primary DB binding", () => {
  const lineJs = readFileSync(new URL("../workers/events-api/src/line.js", import.meta.url), "utf8");
  assert.doesNotMatch(lineJs, /env\.STORES_DB/);
  assert.match(lineJs, /queryStoresDb/);
});
