-- Per-change provenance for the HTML-era reconstruction (plan §10.4). Each reconstructed
-- change-event can record HOW its document's lineage link was traced at that hop:
--   method — 'deterministic' (matcher / forward∩reverse / containment; the default and
--            usually left NULL) | 'ai' (an LLM/frontier auto-lock) | 'human' (a person's
--            confirmed pick). Only 'ai'/'human' are written + surfaced as a badge; the
--            deterministic majority stays NULL.
-- Nullable + ADDITIVE: the markdown era leaves it NULL, so existing rows and the existing
-- upsert path are unaffected. The frozen artifact upserts it via htmlEraRows / eventToRow.
-- Existing rows backfill on the next `pnpm build:history --full` (or a freeze re-apply).
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS method TEXT;
