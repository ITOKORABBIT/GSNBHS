CREATE TABLE IF NOT EXISTS report_dedupe (
  dedupe_key TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
