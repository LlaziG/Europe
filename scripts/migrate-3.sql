-- narrated chapters: the entity's full Wikipedia article, split by section
CREATE TABLE IF NOT EXISTS chapters (
  id              SERIAL PRIMARY KEY,
  civilization_id INT REFERENCES civilizations(id) ON DELETE CASCADE,
  event_id        INT REFERENCES events(id) ON DELETE CASCADE,
  idx             INT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  CHECK (civilization_id IS NOT NULL OR event_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_chapters_civ   ON chapters(civilization_id);
CREATE INDEX IF NOT EXISTS idx_chapters_event ON chapters(event_id);
