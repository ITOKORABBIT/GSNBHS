-- 家長共學社群申請：里民在 LINE 逐題作答 → 推播給里長群組審核 → 通過後自動發社群連結
CREATE TABLE IF NOT EXISTS community_applications (
  application_id TEXT PRIMARY KEY,
  line_user_id   TEXT NOT NULL DEFAULT '',
  display_name   TEXT NOT NULL DEFAULT '',
  current_school TEXT NOT NULL DEFAULT '',
  target_school  TEXT NOT NULL DEFAULT '',
  residence      TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  reviewer_id    TEXT NOT NULL DEFAULT '',
  reviewed_at    TEXT NOT NULL DEFAULT '',
  submitted_at   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_community_applications_user ON community_applications(line_user_id);
CREATE INDEX IF NOT EXISTS idx_community_applications_status ON community_applications(status);
