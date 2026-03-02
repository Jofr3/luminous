-- Series table
CREATE TABLE IF NOT EXISTS series (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT
);

-- Sets table
CREATE TABLE IF NOT EXISTS sets (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  logo               TEXT,
  symbol             TEXT,
  card_count_total   INTEGER,
  card_count_official INTEGER,
  release_date       TEXT,
  tcg_online_code    TEXT,
  series_id          TEXT REFERENCES series(id),
  legal_standard     INTEGER DEFAULT 0,
  legal_expanded     INTEGER DEFAULT 0
);

-- Cards table
CREATE TABLE IF NOT EXISTS cards (
  id                   TEXT PRIMARY KEY,
  local_id             TEXT,
  name                 TEXT NOT NULL,
  image                TEXT,
  category             TEXT,
  illustrator          TEXT,
  rarity               TEXT,
  hp                   INTEGER,
  stage                TEXT,
  evolve_from          TEXT,
  description          TEXT,
  level                TEXT,
  suffix               TEXT,
  effect               TEXT,
  trainer_type         TEXT,
  energy_type          TEXT,
  retreat              INTEGER,
  regulation_mark      TEXT,
  legal_standard       INTEGER DEFAULT 0,
  legal_expanded       INTEGER DEFAULT 0,
  set_id               TEXT REFERENCES sets(id),
  updated              TEXT,
  variant_normal       INTEGER DEFAULT 0,
  variant_reverse      INTEGER DEFAULT 0,
  variant_holo         INTEGER DEFAULT 0,
  variant_first_edition INTEGER DEFAULT 0,
  variant_w_promo      INTEGER DEFAULT 0,
  attacks              TEXT,
  weaknesses           TEXT,
  resistances          TEXT,
  types                TEXT,
  dex_ids              TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cards_set_id   ON cards(set_id);
CREATE INDEX IF NOT EXISTS idx_cards_name     ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
CREATE INDEX IF NOT EXISTS idx_cards_rarity   ON cards(rarity);
