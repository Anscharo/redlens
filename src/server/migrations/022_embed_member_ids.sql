-- member_ids: docs covered by this vector. Standalone rows are ARRAY[doc_id]
-- (or empty, treated as self). Grouped rows list the anchor plus folded
-- children so query-time leaf-pick and the worker coverage check can see them.
ALTER TABLE atlas_doc_embeddings
  ADD COLUMN IF NOT EXISTS member_ids UUID[] NOT NULL DEFAULT '{}';
