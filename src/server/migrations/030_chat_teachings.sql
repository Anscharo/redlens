-- Per-user chat teachings: notes a signed-in user saves with /teach so later
-- turns can inject them as search hints. Scoped to the authoring user_id for
-- now (ON DELETE CASCADE — these are the user's content, unlike feedback).
-- Sharing across users is deliberately deferred.
--
-- status is 'accepted' | 'rejected' after an advanced-model gibberish review
-- (chat/teach/review.ts). Only accepted rows are retrieved. Rejected rows stay
-- as an audit trail of what the reviewer declined.
--
-- embedding is the same 1024-dim OpenRouter vector as atlas_doc_embeddings
-- (filled asynchronously after accept; NULL until then). Matching on the hot
-- path prefers an on-device ternlight score plus lexical overlap so a turn
-- does not wait on an embed round-trip; the stored vector is the SQL cosine
-- lane and the future cross-user path.
--
-- tsv is a generated English tsvector over subject+content so a traditional
-- SQL full-text query can find a teaching without loading the user's whole
-- notebook. conversation_id is provenance only (ON DELETE SET NULL) — deleting
-- a thread must not erase what the user taught.
CREATE TABLE IF NOT EXISTS chat_teachings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  content          TEXT NOT NULL,
  subject          TEXT,
  status           TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
  reject_reason    TEXT,
  content_hash     TEXT NOT NULL,
  review_model     TEXT,
  review           JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding        vector(1024),
  tsv              tsvector GENERATED ALWAYS AS (
                     to_tsvector('english', coalesce(subject, '') || ' ' || content)
                   ) STORED
);

CREATE INDEX IF NOT EXISTS chat_teachings_user_status
  ON chat_teachings (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_teachings_user_hash
  ON chat_teachings (user_id, content_hash);
CREATE INDEX IF NOT EXISTS chat_teachings_tsv
  ON chat_teachings USING gin (tsv);
CREATE INDEX IF NOT EXISTS chat_teachings_hnsw
  ON chat_teachings USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND status = 'accepted';
