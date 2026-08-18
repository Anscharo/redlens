-- Partial HNSW index over the rows semantic search can actually return.
--
-- Migration 023 added attribution_only and a btree on doc_id, but the btree
-- cannot serve an ANN query — search.ts's semantic leg still ordered by
-- `embedding <=> $1` through the full-table atlas_emb_hnsw index (001) and
-- filtered `NOT attribution_only` afterwards. That post-filter is the problem:
-- an ANN scan returns its LIMIT k nearest rows and the filter then deletes some
-- of them, so the query yields FEWER than k searchable hits with no error and
-- no way to notice. It only got worse with grouping — kv_records_breadcrumbs
-- puts roughly five attribution_only rows in the table for every searchable
-- anchor, so most of a k-row ANN result can be rows search must discard.
--
-- Making the index partial on the same predicate moves the filter INTO the
-- scan: the walk only ever visits searchable rows, so LIMIT k returns k of
-- them. That is a correctness fix for result-set size, not just a speed one.
--
-- Coupled to search.ts: the predicate here must stay identical to the query's
-- WHERE clause, or Postgres silently stops using this index and falls back to a
-- sequential scan.
CREATE INDEX IF NOT EXISTS atlas_emb_hnsw_searchable ON atlas_doc_embeddings
  USING hnsw (embedding vector_cosine_ops) WHERE NOT attribution_only;

-- The full-table HNSW is now dead weight: this is the only ANN query in the
-- codebase, and leaf attribution (search.ts's member scoring) reads by
-- `doc_id = ANY(...)` off the primary key, never by vector distance. Keeping
-- both would pay HNSW insert cost twice on every re-embed — which this policy
-- change triggers for the whole corpus. Same transaction as the CREATE above,
-- so there is no window without an index.
DROP INDEX IF EXISTS atlas_emb_hnsw;
