-- Public form rate limits and retryable consultation delivery state.
CREATE TABLE IF NOT EXISTS public_rate_limits (
  scope         TEXT NOT NULL,
  subject_key   TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject_key)
);

CREATE TABLE IF NOT EXISTS public_submission_dedupe (
  dedupe_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS public_sequences (
  scope TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

ALTER TABLE consult_requests ADD COLUMN notify_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE consult_requests ADD COLUMN notify_error TEXT NOT NULL DEFAULT '';
ALTER TABLE consult_requests ADD COLUMN notify_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE consult_requests ADD COLUMN notified_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_consult_requests_notify_status
  ON consult_requests(notify_status);
