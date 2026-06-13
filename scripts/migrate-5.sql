-- documented causal edges between events, each carrying the sourced sentence
CREATE TABLE IF NOT EXISTS causes (
  id              SERIAL PRIMARY KEY,
  cause_event_id  INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  effect_event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sentence        TEXT NOT NULL,
  source_slug     TEXT NOT NULL, -- whose article asserts the link
  score           INT NOT NULL DEFAULT 1,
  UNIQUE (cause_event_id, effect_event_id)
);
CREATE INDEX IF NOT EXISTS idx_causes_effect ON causes(effect_event_id);
CREATE INDEX IF NOT EXISTS idx_causes_cause  ON causes(cause_event_id);
