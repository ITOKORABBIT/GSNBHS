import assert from "node:assert/strict";
import test from "node:test";

import { handleHubCallback } from "./line.js";

function createDb() {
  const application = {
    application_id: "COM_TEST",
    line_user_id: "U_TEST",
    display_name: "測試家長",
    status: "pending",
    reviewed_at: "",
  };
  return {
    application,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM community_applications")) return { ...application };
              return null;
            },
            async run() {
              if (sql.includes("SET status = ?, reviewer_id")) {
                const [nextStatus, , reviewedAt, id, retryStatus, deliveringStatus, staleBefore] = args;
                const canClaim = application.status === "pending" || application.status === retryStatus ||
                  (application.status === deliveringStatus && application.reviewed_at <= staleBefore);
                if (application.application_id !== id || !canClaim) return { meta: { changes: 0 } };
                application.status = nextStatus;
                application.reviewed_at = reviewedAt;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE community_applications SET status")) {
                const [nextStatus, id, expectedStatus] = args;
                if (application.application_id !== id || application.status !== expectedStatus) return { meta: { changes: 0 } };
                application.status = nextStatus;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

function callbackRequest() {
  return new Request("https://example.test/hub-callback", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-secret" },
    body: JSON.stringify({ kind: "community", id: "COM_TEST", action: "approve", reviewerId: "U_REVIEWER" }),
  });
}

test("community approval stays retryable until the resident actually receives the LINE message", async () => {
  const db = createDb();
  const env = {
    DB: db,
    NOTIFY_HUB_SECRET: "test-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "test-token",
    COMMUNITY_INVITE_URL: "https://example.test/invite",
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("LINE unavailable", { status: 503 });
    const failed = await handleHubCallback(callbackRequest(), env);
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).delivered, false);
    assert.equal(db.application.status, "approved_pending_delivery");

    globalThis.fetch = async () => new Response("{}", { status: 200 });
    const retried = await handleHubCallback(callbackRequest(), env);
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).delivered, true);
    assert.equal(db.application.status, "approved");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
