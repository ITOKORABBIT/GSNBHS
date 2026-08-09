import assert from "node:assert/strict";
import test from "node:test";

import worker from "../workers/cases-api/src/index.js";

function createEnv(row) {
  return {
    ALLOWED_ORIGIN: "https://gsnbhs.pages.dev",
    DB: {
      prepare(sql) {
        assert.match(sql, /COUNT\(\*\) AS total/);
        assert.doesNotMatch(sql, /\bname\b|\bphone\b|\bline_id\b/);
        return {
          bind(...values) {
            assert.equal(values.length, 2);
            assert.match(values[0], /^\d{4}\/\d{2}%$/);
            assert.match(values[1], /^\d{4}-\d{2}%$/);
            return { first: async () => row };
          },
        };
      },
    },
  };
}

test("public stats returns aggregate case progress without admin auth", async () => {
  const request = new Request("https://gsnbhs-cases-api.example", {
    method: "POST",
    body: JSON.stringify({ action: "getPublicStats" }),
  });
  const response = await worker.fetch(request, createEnv({
    total: 12,
    new_count: 2,
    active_count: 3,
    completed_count: 6,
    not_accepted_count: 1,
    this_month_count: 4,
    latest_update: "2026/08/09 10:30:00",
  }), {});

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.stats, {
    total: 12,
    new: 2,
    active: 3,
    completed: 6,
    notAccepted: 1,
    thisMonth: 4,
    completionRate: 50,
    latestUpdate: "2026/08/09 10:30:00",
    generatedAt: body.stats.generatedAt,
  });
  assert.match(body.stats.generatedAt, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("empty database reports no completion rate instead of a fake zero percent", async () => {
  const request = new Request("https://gsnbhs-cases-api.example", {
    method: "POST",
    body: JSON.stringify({ action: "getPublicStats" }),
  });
  const response = await worker.fetch(request, createEnv({ total: 0 }), {});
  const body = await response.json();

  assert.equal(body.stats.total, 0);
  assert.equal(body.stats.completed, 0);
  assert.equal(body.stats.completionRate, null);
});
