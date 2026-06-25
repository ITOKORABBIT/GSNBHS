CREATE TABLE IF NOT EXISTS line_sessions (
  session_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_line_sessions_user ON line_sessions(kind, user_id);
CREATE INDEX IF NOT EXISTS idx_line_sessions_expires ON line_sessions(expires_at);
