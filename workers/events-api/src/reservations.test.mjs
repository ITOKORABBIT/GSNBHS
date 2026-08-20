import assert from "node:assert/strict";
import test from "node:test";
import { reserveRegistrationSlot, getActiveReservationCount, REGISTRATION_FULL_MESSAGE } from "./reservations.js";

function createDb(completed, active) {
  const reservations = Array.from({ length: active }, (_, index) => ({ event_id: "EVT_1", user_id: `U${index}`, status: "active", expires_at: new Date(Date.now() + 60_000).toISOString() }));
  return { prepare(sql) { return { bind(...args) { return {
    async first() {
      if (sql.includes("SELECT reservation_id")) return null;
      if (sql.includes("SELECT payload_json FROM events")) return { payload_json: JSON.stringify({ quota: 50 }) };
      if (sql.includes("COUNT(*) AS count")) return { count: reservations.filter((row) => row.status === "active" && row.expires_at > args[1]).length };
      return null;
    },
    async run() {
      if (!sql.includes("INSERT INTO event_reservations")) return { meta: { changes: 0 } };
      const [reservationId, eventId, userId, now, expiresAt] = args;
      const count = reservations.filter((row) => row.status === "active" && row.expires_at > now).length;
      if (completed + count >= 50) return { meta: { changes: 0 } };
      reservations.push({ reservation_id: reservationId, event_id: eventId, user_id: userId, status: "active", expires_at: expiresAt });
      return { meta: { changes: 1 } };
    },
  }; } }; } };
}

test("reservation includes active holds in the quota", async () => {
  const available = createDb(36, 13);
  assert.equal((await reserveRegistrationSlot({ DB: available }, { eventId: "EVT_1", userId: "U_new" })).success, true);
  assert.equal(await getActiveReservationCount({ DB: available }, "EVT_1"), 14);
  const full = createDb(36, 14);
  const rejected = await reserveRegistrationSlot({ DB: full }, { eventId: "EVT_1", userId: "U_new" });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error, REGISTRATION_FULL_MESSAGE);
});
