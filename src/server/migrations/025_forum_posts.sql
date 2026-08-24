-- Patterned Sky Forum threads (monthly settlement, later atlas-edit / spell).
-- The worker is the only writer; the web service reads. We never ingest the
-- whole forum — only allowlisted tags in src/lib/forumKinds.ts.
--
-- Embedding grain (locked, not yet populated by the worker):
--   topic  = title + original-post body (the report itself)
--   post   = a reply whose stripped text is >= 200 chars
-- Sentence-level is deferred: these threads are structured cycle reports, not
-- narrative prose, and sentence vectors lose the month/agent context that
-- makes retrieval useful. forum_embeddings.embedding stays NULL until a
-- follow-up worker step fills it (same OpenRouter path as atlas_doc_embeddings).

CREATE TABLE IF NOT EXISTS forum_topics (
  topic_id       INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL,
  url            TEXT NOT NULL,
  poster         TEXT NOT NULL,
  posted_at      TIMESTAMPTZ NOT NULL,
  last_posted_at TIMESTAMPTZ,
  tags           JSONB NOT NULL DEFAULT '[]'::jsonb,
  posts_count    INTEGER NOT NULL DEFAULT 0,
  op_html        TEXT,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forum_topics_kind_posted
  ON forum_topics (kind, posted_at DESC);

CREATE TABLE IF NOT EXISTS forum_posts (
  post_id              INTEGER PRIMARY KEY,
  topic_id             INTEGER NOT NULL REFERENCES forum_topics(topic_id) ON DELETE CASCADE,
  post_number          INTEGER NOT NULL,
  poster               TEXT NOT NULL,
  posted_at            TIMESTAMPTZ NOT NULL,
  html                 TEXT NOT NULL DEFAULT '',
  reply_to_post_number INTEGER,
  UNIQUE (topic_id, post_number)
);

CREATE INDEX IF NOT EXISTS forum_posts_topic ON forum_posts (topic_id, post_number);

CREATE TABLE IF NOT EXISTS forum_embeddings (
  id           TEXT PRIMARY KEY,
  topic_id     INTEGER NOT NULL REFERENCES forum_topics(topic_id) ON DELETE CASCADE,
  post_id      INTEGER REFERENCES forum_posts(post_id) ON DELETE CASCADE,
  grain        TEXT NOT NULL CHECK (grain IN ('topic', 'post')),
  content_hash TEXT NOT NULL,
  embedding    vector(1024)
);

CREATE INDEX IF NOT EXISTS forum_embeddings_topic ON forum_embeddings (topic_id);
CREATE INDEX IF NOT EXISTS forum_embeddings_hnsw ON forum_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Single-row cadence gate, same shape as chain_state. The worker cycle is
-- ~12 minutes; Discourse fetch must not run every tick.
CREATE TABLE IF NOT EXISTS forum_sync_state (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fetched_at TIMESTAMPTZ
);
