CREATE TABLE IF NOT EXISTS stores (
  store_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  store_name TEXT NOT NULL DEFAULT '',
  pub_name TEXT NOT NULL DEFAULT '',
  pub_cate TEXT NOT NULL DEFAULT '',
  plan_type TEXT NOT NULL DEFAULT '免費',
  pin_order INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  brand_tag TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  public_payload_json TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);
CREATE INDEX IF NOT EXISTS idx_stores_public_sort ON stores(status, pub_cate, sort_order, store_id);
CREATE INDEX IF NOT EXISTS idx_stores_updated_at ON stores(updated_at);
