-- One accepted copy of a note per user. findAcceptedByHash() is a read-then-
-- insert, so two concurrent identical /teach requests could both pass it and
-- insert twice (PR #386 review). The partial unique index makes the second
-- insert a no-op (store.ts uses ON CONFLICT ... DO NOTHING against it) and
-- the handler then answers with the existing row.
-- Rejected rows stay unconstrained: the same over-long or spam note may be
-- rejected any number of times and each is audit trail.
-- Existing duplicates (if any) are collapsed to the earliest copy first, or
-- the index could not be built.
DELETE FROM chat_teachings a
  USING chat_teachings b
  WHERE a.user_id = b.user_id
    AND a.content_hash = b.content_hash
    AND a.status = 'accepted' AND b.status = 'accepted'
    AND a.created_at > b.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS chat_teachings_user_hash_accepted
  ON chat_teachings (user_id, content_hash)
  WHERE status = 'accepted';
