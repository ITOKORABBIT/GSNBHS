CREATE TABLE IF NOT EXISTS case_notifications (
  case_id         TEXT PRIMARY KEY,
  notify_status   TEXT NOT NULL DEFAULT 'pending',
  notify_error    TEXT NOT NULL DEFAULT '',
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  notified_at     TEXT NOT NULL DEFAULT '',
  updated_at      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_case_notifications_status
  ON case_notifications(notify_status, updated_at DESC);
