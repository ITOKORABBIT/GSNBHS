import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_FORM_MIN_MS, validatePublicFormEnvelope } from "./public-guard.js";

test("store public form requires an empty honeypot and a realistic elapsed time", () => {
  const now = 1_800_000_000_000;
  assert.equal(validatePublicFormEnvelope({ website: "", formTs: now - PUBLIC_FORM_MIN_MS }, now), "");
  assert.equal(validatePublicFormEnvelope({ website: "bot", formTs: now - 10_000 }, now), "bot_rejected");
  assert.equal(validatePublicFormEnvelope({ website: "", formTs: now }, now), "form_expired");
});
