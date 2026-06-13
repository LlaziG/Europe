-- full-text search over the narrated chapters (deep "in the texts" search)
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS ts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', left(title, 200) || ' ' || left(body, 8000))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_chapters_ts ON chapters USING gin(ts);
