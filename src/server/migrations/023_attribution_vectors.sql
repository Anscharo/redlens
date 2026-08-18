-- Leaf-attribution vectors.
--
-- A grouping policy folds N docs into one anchor vector, which is what makes thin
-- docs findable at all. But once a grouped anchor is retrieved, something has to say
-- WHICH member the query actually wanted, and that step was the pipeline's biggest
-- loss: measured 2026-08-18, retrieval reaches the right group for essentially every
-- ICD query while term-overlap attribution lands on the right document only ~34% of
-- the time. Scoring members against the query embedding instead measures ~51%, but
-- needs a vector per folded member — which the sync previously DELETED.
--
-- attribution_only rows are those member vectors. They are excluded from semantic
-- SEARCH (see search.ts) so retrieval behaves exactly as measured — restoring them as
-- searchable rows would put the folded docs back in competition and undo the grouping
-- — and are read only when attributing an already-retrieved group to a leaf.
ALTER TABLE atlas_doc_embeddings
  ADD COLUMN IF NOT EXISTS attribution_only BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: every search query filters on NOT attribution_only.
CREATE INDEX IF NOT EXISTS atlas_doc_embeddings_searchable
  ON atlas_doc_embeddings (doc_id) WHERE NOT attribution_only;
