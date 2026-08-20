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

test("public case list and detail expose only approved fields", async () => {
  const stored = JSON.stringify({
    caseId: "GS-001", publicFlag: true, publicTitle: "路燈修復", publicSummary: "已處理",
    name: "居民姓名", phone: "0912345678", lineUserId: "U-secret", lineDisplayName: "秘密名稱", note: "內部備註",
  });
  const env = {
    ALLOWED_ORIGIN: "https://gsnbhs.pages.dev",
    DB: { prepare(sql) { return {
      bind() { return { first: async () => ({ payload_json: stored }) }; },
      all: async () => ({ results: [{ payload_json: stored }] }),
    }; } },
  };
  for (const [action, key] of [["getPublicCases", "cases"], ["getPublicCase", "case"]]) {
    const response = await worker.fetch(new Request("https://gsnbhs-cases-api.example", {
      method: "POST", body: JSON.stringify({ action, caseId: "GS-001" }),
    }), env, {});
    const body = await response.json();
    assert.equal(response.status, 200);
    const item = key === "cases" ? body.cases[0] : body.case;
    assert.equal(item.publicTitle, "路燈修復");
    assert.equal(item.name, undefined);
    assert.equal(item.phone, undefined);
    assert.equal(item.lineUserId, undefined);
    assert.equal(item.note, undefined);
  }
});
