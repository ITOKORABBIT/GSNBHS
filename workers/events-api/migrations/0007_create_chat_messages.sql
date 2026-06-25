CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(line_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
