import assert from "node:assert/strict";
import test from "node:test";

import { getPublicEvents } from "./events.js";

// 用假的 D1：只要能回 payload_json，以及讓保留名額查詢有值就夠了
function fakeEnv(events, reservedByEvent = {}) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                // getActiveReservationCount 的查詢
                const eventId = args[0];
                return { count: reservedByEvent[eventId] || 0 };
              },
            };
          },
          async all() {
            assert.match(sql, /FROM events/);
            return { results: events.map((e) => ({ payload_json: JSON.stringify(e) })) };
          },
        };
      },
    },
  };
}

const SENSITIVE = {
  eventId: "EVT001",
  eventName: "中元普度",
  description: "里辦公處前廣場",
  imageUrl: "https://example.test/a.jpg",
  eventDate: "2026/09/20",
  eventStart: "2026-09-20T09:00",
  eventEnd: "2026-09-20T12:00",
  eventLocation: "舊社公園",
  mapUrl: "https://maps.example.test/x",
  registrationStart: "2026-09-01T00:00",
  registrationEnd: "2026-09-18T23:59",
  quota: 100,
  registeredCount: 30,
  status: "報名中",
  sortOrder: 1,
  // 以下都不該外流
  questions: [{ label: "身分證字號", type: "text" }],
  surveyId: "SUR001",
  surveySentAt: "2026-09-21T10:00",
  createdBy: "chief@example.test",
  registrationSheet: "REG_EVT001",
  checkinLat: 24.18,
  checkinLng: 120.68,
  reminderTime: "2026-09-19T09:00",
};

test("public events only expose whitelisted fields", async () => {
  const result = await getPublicEvents(fakeEnv([SENSITIVE]));
  assert.equal(result.success, true);
  assert.equal(result.events.length, 1);

  const event = result.events[0];
  assert.equal(event.eventName, "中元普度");
  assert.equal(event.registeredCount, 30);
  assert.equal(event.registrationEnd, "2026-09-18T23:59");

  for (const leaked of [
    "questions", "surveyId", "surveySentAt", "createdBy",
    "registrationSheet", "checkinLat", "checkinLng", "reminderTime",
  ]) {
    assert.equal(event[leaked], undefined, `${leaked} 不該出現在公開活動資料裡`);
  }
});

test("drafts stay private and 暫佔中 shows up only as isFull", async () => {
  const draft = { ...SENSITIVE, eventId: "EVT002", eventName: "還沒公開的活動", status: "草稿" };
  const result = await getPublicEvents(fakeEnv([SENSITIVE, draft]));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventId, "EVT001");

  // 30 已報名 + 70 暫佔 = 100，剛好滿額；但暫佔數字本身不外流
  const full = await getPublicEvents(fakeEnv([SENSITIVE], { EVT001: 70 }));
  assert.equal(full.events[0].isFull, true);
  assert.equal(full.events[0].reservedCount, undefined);

  const notFull = await getPublicEvents(fakeEnv([SENSITIVE], { EVT001: 10 }));
  assert.equal(notFull.events[0].isFull, false);
});

test("events without a quota are never marked full", async () => {
  const unlimited = { ...SENSITIVE, quota: 0 };
  const result = await getPublicEvents(fakeEnv([unlimited], { EVT001: 999 }));
  assert.equal(result.events[0].isFull, false);
});
