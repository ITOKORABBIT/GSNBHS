-- LINE 圖文選單通報使用短效、單次 token，避免在公開網址暴露穩定的 LINE userId。
CREATE TABLE IF NOT EXISTS case_report_tokens (
  token TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  line_display_name TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_case_report_tokens_expiry ON case_report_tokens(expires_at);
