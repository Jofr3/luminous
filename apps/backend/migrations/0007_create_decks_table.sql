-- Decks table for storing decklists
CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  decklist TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed with two meta decklists (Seattle Regionals 2026)

-- Charizard ex / Pidgeot (1st Place Seattle Regionals 2026)
INSERT INTO decks (name, decklist) VALUES
(
  'Charizard ex / Pidgeot',
  '3 sv07-114
3 sv07-115
2 sv04.5-007
1 me02-011
1 me02-012
2 sv03-125
2 sv08.5-035
1 sv08.5-036
1 sv08.5-037
1 sv03-162
1 sv03.5-016
1 sv03.5-017
2 sv03-164
2 sv07-118
2 sv07-128
1 sv01-096
1 sv06.5-038
4 me02-087
2 me01-114
1 sv02-185
1 sv07-132
4 sv01-181
4 me01-125
4 sv05-144
1 me01-131
1 sv02-188
1 sv06.5-061
1 sv05-157
2 sv07-131
5 sv03-230
2 sv02-190'
),
-- Dragapult ex / Dusknoir (Seattle Regionals 2026)
(
  'Dragapult ex / Dusknoir',
  '4 sv06-128
4 sv06-129
3 sv06-130
2 sv08.5-035
2 sv08.5-036
1 sv08.5-037
2 me02.5-016
1 sv06-141
1 sv06-095
1 sv01-118
1 me02.5-142
1 sv08-076
4 sv02-185
4 me01-119
3 me01-114
1 sv10.5w-084
1 sv04-171
4 sv05-144
3 me02.5-198
3 me01-131
3 sv04-160
2 me02.5-196
2 sv06-153
3 sv02-191
2 sv03.5-207
1 sv03-230
1 sv05-162'
);
