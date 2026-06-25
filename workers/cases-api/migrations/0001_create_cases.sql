CREATE TABLE IF NOT EXISTS cases (
  case_id      TEXT PRIMARY KEY,
  report_time  TEXT,
  status       TEXT,
  category     TEXT,
  name         TEXT,
  phone        TEXT,
  line_id      TEXT,
  title        TEXT,
  description  TEXT,
  addr         TEXT,
  map_url      TEXT,
  case1999     TEXT,
  photo1       TEXT, photo2 TEXT, photo3 TEXT, photo4 TEXT, photo5 TEXT,
  reply_time   TEXT,
  last_update  TEXT,
  reply_content TEXT,
  rep_photo1   TEXT, rep_photo2 TEXT, rep_photo3 TEXT, rep_photo4 TEXT, rep_photo5 TEXT,
  rep_photo6   TEXT, rep_photo7 TEXT, rep_photo8 TEXT, rep_photo9 TEXT, rep_photo10 TEXT,
  handler      TEXT,
  note         TEXT,
  public_flag  INTEGER DEFAULT 0,
  public_title TEXT,
  public_cate  TEXT,
  public_loc   TEXT,
  public_summary TEXT,
  reply_url    TEXT,
  pin_order    INTEGER DEFAULT 0,
  sort_order   INTEGER DEFAULT 0,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_cases_status      ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_public      ON cases(public_flag);
CREATE INDEX IF NOT EXISTS idx_cases_report_time ON cases(report_time DESC);
CREATE INDEX IF NOT EXISTS idx_cases_sort        ON cases(sort_order, pin_order);

CREATE TABLE IF NOT EXISTS import_runs (
  id          TEXT PRIMARY KEY,
  imported_at TEXT,
  case_count  INTEGER
);
