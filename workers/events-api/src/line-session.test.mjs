import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvtReminderAlreadyHandledMessage,
  buildEvtSummaryBubble,
  buildEvtDuplicateSubmitMessage,
  ensureEvtSubmissionId,
  findRecentLineRegistration,
  getLineSession,
  saveLineSession,
  clearLineSession,
} from "./line.js";

function createDb() {
  const sessions = new Map();
  const registrations = [];
  return {
    sessions,
    registrations,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM line_sessions")) {
                const row = sessions.get(args[0]);
                if (!row) return null;
                if (sql.includes("expires_at > ?") && row.expires_at <= args[1]) return null;
                return row;
              }
              if (sql.includes("FROM event_registrations")) {
                return registrations
                  .filter((row) => row.line_user_id === args[0])
                  .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0] || null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith("INSERT INTO line_sessions")) {
                sessions.set(args[0], {
                  session_key: args[0],
                  kind: args[1],
                  user_id: args[2],
                  state_json: args[3],
                  updated_at: args[4],
                  expires_at: args[5],
                });
              } else if (sql.startsWith("DELETE FROM line_sessions")) {
                sessions.delete(args[0]);
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test("LINE session helpers persist state in D1 and clear it", async () => {
  const env = { DB: createDb() };
  const state = { stage: "summary", eventId: "EVT_1", answers: [{ label: "姓名", value: "王小明" }] };

  await saveLineSession(env, "evt", "U1", state);
  const loaded = await getLineSession(env, "evt", "U1");

  assert.equal(loaded.stage, "summary");
  assert.equal(loaded.eventId, "EVT_1");
  assert.equal(loaded.answers[0].value, "王小明");

  await clearLineSession(env, "evt", "U1");
  assert.deepEqual(await getLineSession(env, "evt", "U1"), {});
});

test("duplicate submit can recover the most recent successful registration", async () => {
  const db = createDb();
  db.registrations.push({
    event_id: "EVT_1",
    line_user_id: "U1",
    display_name: "LINE 名稱",
    submitted_at: new Date().toISOString(),
    payload_json: JSON.stringify({
      eventName: "端午手作",
      "請提供報名者姓名（一次一位）：": "周秉諺",
      "請提供連絡電話：": "0909208777",
    }),
  });

  const recent = await findRecentLineRegistration({ DB: db }, "U1");
  const message = buildEvtDuplicateSubmitMessage(recent);

  assert.equal(recent.attendeeName, "周秉諺");
  assert.match(message.text, /已收到您的報名/);
  assert.match(message.text, /周秉諺/);
});

test("duplicate submit message stays helpful when no registration is found", () => {
  const message = buildEvtDuplicateSubmitMessage(null);

  assert.match(message.text, /還查不到/);
  assert.match(message.text, /我要報名/);
});

test("stale reminder opt-in reply does not tell residents the flow timed out", () => {
  const message = buildEvtReminderAlreadyHandledMessage();

  assert.match(message.text, /已收到/);
  assert.match(message.text, /確認送出/);
  assert.doesNotMatch(message.text, /操作逾時/);
});

test("summary card reminds residents to tap submit only once", () => {
  const bubble = buildEvtSummaryBubble({
    eventName: "端午手作",
    answers: [{ label: "姓名", value: "王小明" }],
  });

  const bodyText = bubble.contents.body.contents.map((item) => item.text || "").join("\n");
  assert.match(bodyText, /點一次/);
  assert.match(bodyText, /請稍候/);
});

test("submission id stays stable for repeated submit taps on the same summary card", () => {
  const state = {};
  const first = ensureEvtSubmissionId(state);
  const second = ensureEvtSubmissionId(state);

  assert.equal(first, second);
  assert.equal(state.submissionId, first);
  assert.match(first, /^REG_/);
});

test("legacy summary cards without submission id still get an idempotent submit id", () => {
  const legacyStateA = {
    eventId: "EVT_1",
    reservationId: "RESERVED_SLOT_1",
    answers: [{ qIdx: 0, label: "姓名", value: "王小明" }],
  };
  const legacyStateB = {
    eventId: "EVT_1",
    reservationId: "RESERVED_SLOT_1",
    answers: [{ qIdx: 0, label: "姓名", value: "王小明" }],
  };

  assert.equal(ensureEvtSubmissionId(legacyStateA, "U1"), ensureEvtSubmissionId(legacyStateB, "U1"));
});
