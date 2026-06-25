CREATE TABLE IF NOT EXISTS image_uploads (
  image_id   TEXT PRIMARY KEY,
  mime_type  TEXT NOT NULL DEFAULT 'image/jpeg',
  data_base64 TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_img_uploaded_at ON image_uploads(uploaded_at);
