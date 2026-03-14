-- Add tera column to cards table for identifying Tera Pokémon ex
ALTER TABLE cards ADD COLUMN tera INTEGER DEFAULT 0;
