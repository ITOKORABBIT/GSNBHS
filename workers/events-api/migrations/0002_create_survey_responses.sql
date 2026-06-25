CREATE TABLE IF NOT EXISTS survey_responses (
  survey_id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  event_id TEXT NOT NULL DEFAULT '',
  event_name TEXT NOT NULL DEFAULT '',
  line_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  resident_note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  answers_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL,
  PRIMARY KEY (survey_id, response_id)
);

CREATE TABLE IF NOT EXISTS survey_walkin_attendance (
  attendance_id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL,
  event_id TEXT NOT NULL DEFAULT '',
  event_name TEXT NOT NULL DEFAULT '',
  line_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  resident_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resident_notes (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_event_user ON survey_responses(event_id, line_user_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_submitted_at ON survey_responses(submitted_at);
CREATE INDEX IF NOT EXISTS idx_walkin_survey ON survey_walkin_attendance(survey_id);
CREATE INDEX IF NOT EXISTS idx_resident_notes_display_name ON resident_notes(display_name);
