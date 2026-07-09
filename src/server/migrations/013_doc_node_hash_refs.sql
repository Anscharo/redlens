-- Persist the two fields the in-process updater's DB→docs.json rebuild was
-- silently dropping (deep code review 2026-07-09, exec #2/#3):
--
--   node_content_hash  the parser's sha256(raw markdown slice) carried on the
--                      node as `contentHash`. DISTINCT from content_hash, which
--                      is the embed-text hash sha256(title+content) used by the
--                      sync diff ledger. OEA report freshness keys on the parser
--                      hash, so it needs its own column to round-trip — reusing
--                      content_hash would flip every assessed row stale.
--   address_refs       per-node normalized address keys (jsonb string[], same
--                      encoding as atlas_addresses.roles/aliases). Powers
--                      RightPanel address cards + chainlog reverse search.
--                      Persisted rather than re-derived so the rebuild can't
--                      drift from build-index's extraction.
--
-- Nullable + no backfill: the next structural sync (drift or --force) populates
-- them for every row. Until then the updater reads NULL → contentHash undefined
-- / addressRefs [] (the pre-fix behavior), so this is regression-free.
ALTER TABLE atlas_doc_meta ADD COLUMN IF NOT EXISTS node_content_hash TEXT;
ALTER TABLE atlas_doc_meta ADD COLUMN IF NOT EXISTS address_refs JSONB;
