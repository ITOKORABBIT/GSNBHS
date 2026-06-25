// ── AI 客服留言記錄 CRUD ────────────────────────────────────────────────────
import { text, httpError } from "./utils.js";

export async function insertChatMessage(env, { lineUserId, displayName, role, content }) {
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, line_user_id, display_name, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), lineUserId, text(displayName), role, content, new Date().toISOString()).run();
}

// 後台用：依使用者分組列出每位里民最後一則留言，方便里長快速瀏覽
export async function getChatThreads(env) {
  const rows = await env.DB.prepare(
    `SELECT line_user_id,
            MAX(display_name) AS display_name,
            MAX(created_at) AS last_at,
            COUNT(*) AS message_count
     FROM chat_messages
     GROUP BY line_user_id
     ORDER BY last_at DESC`,
  ).all();
  return { success: true, threads: rows.results || [] };
}

// 後台用：列出單一里民的完整對話紀錄
export async function getChatMessages(env, data) {
  const lineUserId = text(data.lineUserId);
  if (!lineUserId) throw httpError(400, "Missing lineUserId");
  const rows = await env.DB.prepare(
    `SELECT role, content, created_at FROM chat_messages
     WHERE line_user_id = ? ORDER BY created_at ASC`,
  ).bind(lineUserId).all();
  return { success: true, messages: rows.results || [] };
}
