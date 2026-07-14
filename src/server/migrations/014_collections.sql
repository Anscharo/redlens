-- Collections: user-curated ordered lists of atlas doc ids. Mirrors the
-- chat tables' ownership pattern (user_id FK, cascade delete). Items are a
-- separate table (not a JSONB array) so position updates/joins stay cheap.
CREATE TABLE IF NOT EXISTS collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collections_user ON collections(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  doc_id        TEXT NOT NULL,          -- atlas node UUID, stored as text
  position      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, doc_id)
);

CREATE INDEX IF NOT EXISTS collection_items_position ON collection_items(collection_id, position);
