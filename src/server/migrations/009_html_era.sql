-- HTML-era (pre-#117) history needs annotations the markdown era doesn't (plan §7):
--   era            — format/period: 'html' | 'markdown-monolith' | 'markdown-atoms'
--   seam           — per-doc #117 fate: 'kept' | 'split' | 'merged' | 'created' | 'deleted'
--   extracted_from — on `split` rows: the HTML parent the doc was carved out of
--   merged_into    — on `merged` rows: the surviving md doc that absorbed it
--   move_kind      — discriminates moved_from/_to payloads: 'path' | 'doc_no' | 'migration'
-- All nullable + ADDITIVE: the markdown era leaves them null, so existing rows and
-- the existing upsert path are unaffected. The frozen artifact upserts them via
-- htmlEraRows. Existing rows backfill on the next `pnpm build:history --full`.
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS era            TEXT;
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS seam           TEXT;
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS extracted_from UUID;
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS merged_into    UUID;
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS move_kind      TEXT;
