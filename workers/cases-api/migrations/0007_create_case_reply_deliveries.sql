-- 同一案件、狀態與回覆內容只推播一次，避免雙擊或重送消耗 LINE 額度。
CREATE TABLE IF NOT EXISTS case_reply_deliveries (
  case_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'delivering',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  PRIMARY KEY (case_id, fingerprint)
);
