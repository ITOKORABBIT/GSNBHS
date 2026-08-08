import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_FORM_MAX_MS, PUBLIC_FORM_MIN_MS, validatePublicFormEnvelope } from "./public-guard.js";

test("public form envelope accepts a human-paced fresh form", () => {
  const now = 1_800_000_000_000;
  assert.equal(validatePublicFormEnvelope({ website: "", formTs: now - PUBLIC_FORM_MIN_MS }, now), "");
});

test("public form envelope rejects honeypot, instant and expired submissions", () => {
  const now = 1_800_000_000_000;
  assert.equal(validatePublicFormEnvelope({ website: "https://spam.test", formTs: now - 10_000 }, now), "bot_rejected");
  assert.equal(validatePublicFormEnvelope({ website: "", formTs: now - PUBLIC_FORM_MIN_MS + 1 }, now), "form_expired");
  assert.equal(validatePublicFormEnvelope({ website: "", formTs: now - PUBLIC_FORM_MAX_MS - 1 }, now), "form_expired");
});
