-- 案件通報人的 LINE 身分。從 LINE 進來（LIFF）才會有值，
-- 用瀏覽器直接開通報表單的案件維持空字串。
ALTER TABLE cases ADD COLUMN line_user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE cases ADD COLUMN line_display_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cases_line_user_id ON cases(line_user_id);
