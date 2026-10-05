-- Names the model that made each stored vector.
--
-- `embed_model` records which model produced `embedding`. The embed passes
-- (sync-embeddings.ts, briefings-passes.ts) re-embed a row whose embed_model
-- differs from config.embedModel, in addition to a row whose text changed, so
-- switching EMBED_MODEL replaces every vector and a query is never scored
-- against vectors from another model. The re-embed is resumable: each batch
-- stamps its own rows, and an interrupted run leaves the rest queued.
--
-- Rows that exist when this migration runs read NULL, which never equals a model
-- name, so each is re-embedded once.
--
-- Search queries deliberately do NOT filter on this column. Migration 024's
-- partial HNSW index predicate (`WHERE NOT attribution_only`) and
-- `atlas_doc_briefings_hnsw`'s (`WHERE embedding IS NOT NULL`, migration 037)
-- must match the query WHERE word for word, or Postgres falls back to a
-- sequential scan with no error.
ALTER TABLE atlas_doc_embeddings ADD COLUMN IF NOT EXISTS embed_model TEXT;
ALTER TABLE atlas_doc_briefings ADD COLUMN IF NOT EXISTS embed_model TEXT;
