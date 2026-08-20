CREATE TABLE IF NOT EXISTS event_reservations (
  reservation_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_event_reservations_active ON event_reservations(event_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_event_reservations_user ON event_reservations(event_id, user_id, status);
