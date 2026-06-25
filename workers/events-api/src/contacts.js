// ── Emergency contacts CRUD ────────────────────────────────────────────────────
import { text, requireId, httpError } from "./utils.js";

export async function getEmergencyContacts(env) {
  const rows = await env.DB.prepare(
    "SELECT id, name, phone, org, sort_order, kind FROM emergency_contacts ORDER BY sort_order ASC, name ASC",
  ).all();
  return { success: true, contacts: rows.results || [] };
}

function normalizeKind_(kind) {
  return kind === "hint" || kind === "url" ? kind : "tel";
}

export async function addEmergencyContact(env, data) {
  const name = text(data.name);
  const kind = normalizeKind_(text(data.kind));
  const phone = text(data.phone);
  if (!name) throw httpError(400, "Missing name");
  if (kind !== "hint" && !phone) throw httpError(400, "Missing phone/link");
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO emergency_contacts (id, name, phone, org, sort_order, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, name, phone, text(data.org), Number(data.sortOrder) || 0, kind, new Date().toISOString()).run();
  return { success: true, id };
}

export async function updateEmergencyContact(env, data) {
  const id = requireId(data.id, "Missing id");
  const name = text(data.name);
  const kind = normalizeKind_(text(data.kind));
  const phone = text(data.phone);
  if (!name) throw httpError(400, "Missing name");
  if (kind !== "hint" && !phone) throw httpError(400, "Missing phone/link");
  await env.DB.prepare(
    "UPDATE emergency_contacts SET name = ?, phone = ?, org = ?, sort_order = ?, kind = ? WHERE id = ?",
  ).bind(name, phone, text(data.org), Number(data.sortOrder) || 0, kind, id).run();
  return { success: true };
}

export async function deleteEmergencyContact(env, data) {
  const id = requireId(data.id, "Missing id");
  await env.DB.prepare("DELETE FROM emergency_contacts WHERE id = ?").bind(id).run();
  return { success: true };
}

// Used by line.js to render the 緊急聯絡 Flex message.
export async function getEmergencyContactsForLine(env) {
  const rows = await env.DB.prepare(
    "SELECT name, phone, org, kind FROM emergency_contacts ORDER BY sort_order ASC, name ASC",
  ).all();
  return rows.results || [];
}
