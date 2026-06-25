CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  event_start TEXT NOT NULL DEFAULT '',
  event_end TEXT NOT NULL DEFAULT '',
  registration_start TEXT NOT NULL DEFAULT '',
  registration_end TEXT NOT NULL DEFAULT '',
  survey_id TEXT NOT NULL DEFAULT '',
  registered_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_registrations (
  event_id TEXT NOT NULL,
  reg_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  checked_in TEXT NOT NULL DEFAULT 'FALSE',
  submitted_at TEXT NOT NULL DEFAULT '',
  headcount INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (event_id, reg_id)
);

CREATE TABLE IF NOT EXISTS surveys (
  survey_id TEXT PRIMARY KEY,
  survey_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  registration_count INTEGER NOT NULL DEFAULT 0,
  survey_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_updated_at ON events(updated_at);
CREATE INDEX IF NOT EXISTS idx_regs_event ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_regs_checked_in ON event_registrations(event_id, checked_in);
CREATE INDEX IF NOT EXISTS idx_surveys_updated_at ON surveys(updated_at);
