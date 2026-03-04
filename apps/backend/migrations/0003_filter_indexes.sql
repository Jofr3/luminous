-- Indexes to support filter queries on the cards table
CREATE INDEX IF NOT EXISTS idx_cards_stage ON cards(stage);
CREATE INDEX IF NOT EXISTS idx_cards_trainer_type ON cards(trainer_type);
CREATE INDEX IF NOT EXISTS idx_cards_energy_type ON cards(energy_type);
CREATE INDEX IF NOT EXISTS idx_cards_hp ON cards(hp);
CREATE INDEX IF NOT EXISTS idx_cards_retreat ON cards(retreat);
CREATE INDEX IF NOT EXISTS idx_cards_legal_standard ON cards(legal_standard);
CREATE INDEX IF NOT EXISTS idx_cards_legal_expanded ON cards(legal_expanded);
