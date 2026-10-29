-- The MATERIAL_VERSION (src/server/pau/source-material.ts) each spell's
-- material was read under; a row read under another version is read again.
-- Rows read before the column existed count as version 0, so they are re-read.
ALTER TABLE pau_spell_sources ADD COLUMN IF NOT EXISTS parser_version INT NOT NULL DEFAULT 0;
