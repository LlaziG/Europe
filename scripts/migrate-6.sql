-- grounded spoken-word narration, stored beside the sourced text and read
-- aloud by the audioguide instead of the raw Wikipedia prose
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS narration TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS narration TEXT;
