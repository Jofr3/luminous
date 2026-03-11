-- Add abilities column (JSON array of {type, name, effect})
ALTER TABLE cards ADD COLUMN abilities TEXT;

-- Add index for JSON lookups on abilities
CREATE INDEX IF NOT EXISTS idx_cards_abilities ON cards(abilities);
