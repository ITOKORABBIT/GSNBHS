import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loginAdmin, requireAdmin } from "../workers/events-api/src/auth.js";

const workerFiles = [
  "../workers/events-api/src/auth.js",
  "../workers/stores-api/src/index.js",
  "../workers/bulletins-api/src/index.js",
  "../workers/cases-api/src/index.js",
  "../workers/events-api/wrangler.jsonc",
  "../workers/stores-api/wrangler.jsonc",
  "../workers/bulletins-api/wrangler.jsonc",
  "../workers/cases-api/wrangler.jsonc",
];

test("GAS admin table is the only Worker authorization list", () => {
  for (const file of workerFiles) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /ADMIN_EMAILS/, `${file} still has a static admin allowlist`);
    assert.doesNotMatch(source, /sessionToken:\s*idToken/, `${file} still grants a session when GAS rejects login`);
  }
});

test("a dynamic GAS admin can log in even when absent from legacy Worker config", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.action, "login");
    assert.equal(body.id_token, "valid-google-token");
    return new Response(JSON.stringify({
      success: true,
      sessionToken: "gas-session",
      email: "sococomm7411@gmail.com",
      name: "SO",
      role: "管理員",
    }));
  };

  try {
    const result = await loginAdmin({
      GAS_SCRIPT_URL: "https://example.test/gas",
      ADMIN_EMAILS: "ulch0709@gmail.com",
    }, "valid-google-token");
    assert.deepEqual(result, {
      success: true,
      sessionToken: "gas-session",
      email: "sococomm7411@gmail.com",
      name: "SO",
      role: "管理員",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Google token alone cannot bypass the GAS admin table", async () => {
  await assert.rejects(
    () => requireAdmin({
      GAS_SCRIPT_URL: "https://example.test/gas",
      ADMIN_EMAILS: "sococomm7411@gmail.com",
    }, { id_token: "legacy-worker-token" }),
    (error) => error.status === 401 && error.message === "Unauthorized",
  );
});
