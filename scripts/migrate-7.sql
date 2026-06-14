-- mark rows that have the engaging storytelling narration (vs the older
-- descriptive pass), so regeneration can resume on exactly what's left
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS storied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS storied BOOLEAN NOT NULL DEFAULT FALSE;
