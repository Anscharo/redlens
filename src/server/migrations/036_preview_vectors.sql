-- Vectors made for previews, kept so that a REBUILD does not make them again.
--
-- A preview bundle lives on disk and is removed often: when the live atlas
-- moves (about hourly), when more than 20 bundles exist, on every restart. Each
-- rebuild used to embed the same text again — 10 to 17 seconds against the
-- provider for ~500 rows, measured 2026-09-29. A vector depends only on its
-- text and the model, so it is keyed by exactly that and found again whatever
-- removed the bundle, and whichever commit of a pull request asks for it.
--
--   model         the embedding model that made it; another model's vector is
--                 not comparable, so a model change simply stops matching and
--                 the old rows age out
--   content_hash  sha256 of the embedded text — the same key as
--                 atlas_doc_embeddings.content_hash (retrieval/embed-text.ts)
--   last_used     drives eviction: the table is CAPPED (preview/vector-cache.ts
--                 PREVIEW_VECTORS_MAX) and the least recently used rows go first
--
-- Holds a hash and a vector, nothing else: no repo, no commit, no document id,
-- no text. That matters because private previews are embedded too.
--
-- NOT atlas_doc_embeddings: that table is the live atlas, one row per document,
-- searched through an HNSW index. These rows belong to no document and are only
-- ever looked up by key, so they carry no vector index.
--
-- Postgres and not a Railway bucket, for the reasons recorded in
-- docs/research/identity-swap-detection.md ("Where preview vectors live"): one
-- query returns every vector a preview needs, where a bucket needs one request
-- for each and has no lifecycle rules to evict with.
CREATE TABLE IF NOT EXISTS preview_vectors (
  model        TEXT         NOT NULL,
  content_hash TEXT         NOT NULL,
  embedding    vector(1024) NOT NULL,
  last_used    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (model, content_hash)
);

CREATE INDEX IF NOT EXISTS preview_vectors_last_used ON preview_vectors(last_used);
