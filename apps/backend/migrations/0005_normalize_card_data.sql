-- Normalize card data: extract JSON columns into proper relational tables
-- Phase 1: Create tables and backfill (old columns kept for safety)

-- card_attacks: one row per attack per card
CREATE TABLE IF NOT EXISTS card_attacks (
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  cost        TEXT,
  damage_base INTEGER NOT NULL DEFAULT 0,
  damage_mod  TEXT,
  damage_raw  TEXT NOT NULL DEFAULT '',
  effect      TEXT,
  PRIMARY KEY (card_id, position)
);

CREATE INDEX IF NOT EXISTS idx_card_attacks_name ON card_attacks(name);

-- card_abilities: one row per ability per card (position-based PK since some lack names)
CREATE TABLE IF NOT EXISTS card_abilities (
  card_id  TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type     TEXT NOT NULL DEFAULT 'Ability',
  name     TEXT NOT NULL DEFAULT '',
  effect   TEXT,
  PRIMARY KEY (card_id, position)
);

CREATE INDEX IF NOT EXISTS idx_card_abilities_name ON card_abilities(name);

-- card_type_modifiers: weaknesses and resistances
CREATE TABLE IF NOT EXISTS card_type_modifiers (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  type    TEXT NOT NULL,
  value   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (card_id, kind, type)
);

CREATE INDEX IF NOT EXISTS idx_card_type_modifiers_kind_type ON card_type_modifiers(kind, type);

-- card_types: one row per energy type per card
CREATE TABLE IF NOT EXISTS card_types (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type    TEXT NOT NULL,
  PRIMARY KEY (card_id, type)
);

CREATE INDEX IF NOT EXISTS idx_card_types_type ON card_types(type);

-- Backfill card_attacks from JSON
INSERT INTO card_attacks (card_id, position, name, cost, damage_base, damage_mod, damage_raw, effect)
SELECT
  c.id,
  CAST(j.key AS INTEGER),
  COALESCE(json_extract(j.value, '$.name'), ''),
  json_extract(j.value, '$.cost'),
  CASE
    WHEN CAST(json_extract(j.value, '$.damage') AS TEXT) IS NULL THEN 0
    WHEN CAST(json_extract(j.value, '$.damage') AS TEXT) = '' THEN 0
    ELSE COALESCE(CAST(CAST(json_extract(j.value, '$.damage') AS TEXT) AS INTEGER), 0)
  END,
  CASE
    WHEN CAST(json_extract(j.value, '$.damage') AS TEXT) GLOB '*[0-9]+' THEN '+'
    WHEN CAST(json_extract(j.value, '$.damage') AS TEXT) GLOB '*[0-9]x' THEN 'x'
    WHEN CAST(json_extract(j.value, '$.damage') AS TEXT) GLOB '*[0-9]-' THEN '-'
    ELSE NULL
  END,
  COALESCE(CAST(json_extract(j.value, '$.damage') AS TEXT), ''),
  json_extract(j.value, '$.effect')
FROM cards c, json_each(c.attacks) j
WHERE c.attacks IS NOT NULL AND c.attacks != '' AND c.attacks != 'null';

-- Backfill card_abilities from JSON
INSERT INTO card_abilities (card_id, position, type, name, effect)
SELECT
  c.id,
  CAST(j.key AS INTEGER),
  COALESCE(json_extract(j.value, '$.type'), 'Ability'),
  COALESCE(json_extract(j.value, '$.name'), ''),
  json_extract(j.value, '$.effect')
FROM cards c, json_each(c.abilities) j
WHERE c.abilities IS NOT NULL AND c.abilities != '' AND c.abilities != 'null';

-- Backfill weaknesses into card_type_modifiers
INSERT OR IGNORE INTO card_type_modifiers (card_id, kind, type, value)
SELECT
  c.id,
  'weakness',
  json_extract(j.value, '$.type'),
  COALESCE(json_extract(j.value, '$.value'), '')
FROM cards c, json_each(c.weaknesses) j
WHERE c.weaknesses IS NOT NULL AND c.weaknesses != '' AND c.weaknesses != 'null';

-- Backfill resistances into card_type_modifiers
INSERT OR IGNORE INTO card_type_modifiers (card_id, kind, type, value)
SELECT
  c.id,
  'resistance',
  json_extract(j.value, '$.type'),
  COALESCE(json_extract(j.value, '$.value'), '')
FROM cards c, json_each(c.resistances) j
WHERE c.resistances IS NOT NULL AND c.resistances != '' AND c.resistances != 'null';

-- Backfill card_types from JSON
INSERT OR IGNORE INTO card_types (card_id, type)
SELECT
  c.id,
  j.value
FROM cards c, json_each(c.types) j
WHERE c.types IS NOT NULL AND c.types != '' AND c.types != 'null';
