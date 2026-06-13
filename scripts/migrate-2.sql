-- original image dimensions (needed to avoid requesting upscaled thumbnails)
ALTER TABLE periods       ADD COLUMN IF NOT EXISTS image_w INT, ADD COLUMN IF NOT EXISTS image_h INT;
ALTER TABLE civilizations ADD COLUMN IF NOT EXISTS image_w INT, ADD COLUMN IF NOT EXISTS image_h INT;
ALTER TABLE events        ADD COLUMN IF NOT EXISTS image_w INT, ADD COLUMN IF NOT EXISTS image_h INT;

-- fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_periods_name_trgm  ON periods       USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_civs_name_trgm     ON civilizations USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_civs_desc_trgm     ON civilizations USING gin (coalesce(description,'') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_events_name_trgm   ON events        USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_events_desc_trgm   ON events        USING gin (coalesce(description,'') gin_trgm_ops);
