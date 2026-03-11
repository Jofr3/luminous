-- Phase 2: Drop old JSON columns now that data lives in normalized tables

-- Drop the abilities index from migration 0004 (column is being dropped)
DROP INDEX IF EXISTS idx_cards_abilities;

ALTER TABLE cards DROP COLUMN attacks;
ALTER TABLE cards DROP COLUMN abilities;
ALTER TABLE cards DROP COLUMN weaknesses;
ALTER TABLE cards DROP COLUMN resistances;
ALTER TABLE cards DROP COLUMN types;
