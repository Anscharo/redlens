-- Document briefings: a short placement-aware description per atlas document
-- plus two or three questions it answers, embedded as a SECOND vector per
-- document (docs/plans/atlas-doc-briefings.md, scripts/lib/doc-briefings.mjs).
--
-- Why a separate table and not columns on atlas_doc_embeddings: migration 024's
-- partial HNSW index there is `WHERE NOT attribution_only`, and its predicate
-- must stay identical to the unit query's WHERE in search.ts or Postgres
-- silently stops using it. A briefing vector is a different kind of row (one per
-- DOCUMENT, never grouped, never folded), so it gets its own index and leaves
-- that coupling alone.
--
-- Coupled to the briefing query the same way: its WHERE must stay
-- `embedding IS NOT NULL`, identical to this index's predicate, or the planner
-- falls back to a sequential scan with no error.
--
-- A placeholder row (`briefing = ''`, embedding NULL) exists only to hold
-- `failures` for a document that has no briefing yet, so the worker stops asking
-- the model after three failed attempts. The index predicate keeps it out of
-- search, a pull from the database skips it, and the seed rule treats it as "no
-- row".
CREATE TABLE IF NOT EXISTS atlas_doc_briefings (
  doc_id          UUID PRIMARY KEY REFERENCES atlas_doc_meta(id) ON DELETE CASCADE,
  briefing        TEXT NOT NULL,            -- '' = placeholder that only carries `failures`
  questions       JSONB NOT NULL,
  digest          TEXT NOT NULL,            -- docDigest of the document the text was written for
  context_digest  TEXT NOT NULL,            -- sha256 of (digest, parent digest, sorted citer digests)
  model           TEXT,
  source          TEXT NOT NULL CHECK (source IN ('seed', 'worker')),
  briefing_hash   TEXT NOT NULL,            -- sha256 of briefingEmbedText(row)
  embedding       vector(1024),             -- NULL until embedded
  embedded_hash   TEXT,                     -- briefing_hash the vector was made from
  failures        INT NOT NULL DEFAULT 0,   -- validation failures counted at failed_context
  failed_context  TEXT,                     -- the context digest the failures were counted at
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_doc_briefings_hnsw ON atlas_doc_briefings
  USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

-- sha256 of the committed seed file last loaded, so an unchanged file is skipped.
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS briefings_seed_hash TEXT;
