-- hpnbhs-bulletins-api D1 schema
-- 執行方式：CF Dashboard → D1 → hpnbhs-bulletins → Console 貼上並執行

CREATE TABLE IF NOT EXISTS bulletins (
  bulletin_id  TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  image_url    TEXT NOT NULL DEFAULT '',
  pinned       INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT '未發布',
  author       TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '里民活動',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_bulletins_status   ON bulletins(status);
CREATE INDEX IF NOT EXISTS idx_bulletins_sort     ON bulletins(sort_order);
CREATE INDEX IF NOT EXISTS idx_bulletins_created  ON bulletins(created_at DESC);

CREATE TABLE IF NOT EXISTS bulletin_views (
  bulletin_id TEXT PRIMARY KEY,
  view_count  INTEGER NOT NULL DEFAULT 0
);
