-- EUROPA museum schema
CREATE TABLE IF NOT EXISTS periods (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  start_year  INT NOT NULL,
  end_year    INT NOT NULL,
  wiki_title  TEXT NOT NULL,
  wiki_url    TEXT,
  summary     TEXT,
  description TEXT,
  image_url   TEXT,
  thumb_url   TEXT,
  color       TEXT NOT NULL,
  sort        INT NOT NULL
);

CREATE TABLE IF NOT EXISTS civilizations (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  period_id     INT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  start_year    INT NOT NULL,
  end_year      INT NOT NULL,
  display_start INT,            -- optional clamped span for timeline placement
  display_end   INT,
  wiki_title    TEXT NOT NULL,
  wiki_url      TEXT,
  summary       TEXT,
  description   TEXT,
  image_url     TEXT,
  thumb_url     TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  period_id       INT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  civilization_id INT REFERENCES civilizations(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  year            INT NOT NULL,
  end_year        INT,
  wiki_title      TEXT NOT NULL,
  wiki_url        TEXT,
  summary         TEXT,
  description     TEXT,
  image_url       TEXT,
  thumb_url       TEXT,
  on_timeline     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS artworks (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  civilization_id INT REFERENCES civilizations(id) ON DELETE CASCADE,
  event_id        INT REFERENCES events(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  artist          TEXT,
  year_label      TEXT,
  year            INT,
  kind            TEXT NOT NULL DEFAULT 'painting', -- painting | artifact
  commons_file    TEXT NOT NULL,
  image_url       TEXT,
  thumb_url       TEXT,
  width           INT,
  height          INT,
  story           TEXT,
  facts           JSONB,
  license         TEXT,
  credit          TEXT,
  wiki_title      TEXT,
  wiki_url        TEXT,
  CHECK (civilization_id IS NOT NULL OR event_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_civ_period   ON civilizations(period_id);
CREATE INDEX IF NOT EXISTS idx_event_period ON events(period_id);
CREATE INDEX IF NOT EXISTS idx_event_civ    ON events(civilization_id);
CREATE INDEX IF NOT EXISTS idx_art_civ      ON artworks(civilization_id);
CREATE INDEX IF NOT EXISTS idx_art_event    ON artworks(event_id);
