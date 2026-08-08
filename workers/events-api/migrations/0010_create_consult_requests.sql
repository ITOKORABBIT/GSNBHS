-- 里民諮詢服務預約（取代舊系統對外公開的 Notion 表單）
-- 舊表單把回覆公開在網頁上，姓名/電話/諮詢內容任何人都看得到；這裡只存在 D1，
-- 僅透過通報中心推播給里長群組。
CREATE TABLE IF NOT EXISTS consult_requests (
  consult_id    TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT '',
  detail        TEXT NOT NULL DEFAULT '',
  time_slot     TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  line_user_id  TEXT NOT NULL DEFAULT '',
  display_name  TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '待處理',
  submitted_at  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_consult_requests_status ON consult_requests(status);
CREATE INDEX IF NOT EXISTS idx_consult_requests_submitted ON consult_requests(submitted_at);
