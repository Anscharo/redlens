-- Append-only usage ledger — closes the quota-reclaim exploit where DELETE
-- /api/chat/conversations/:id cascades messages (and via messages,
-- message_checks), and getWindowUsage (rate-limit.ts) used to SUM exactly
-- those two cascaded tables. A rate-limited user could delete conversations
-- to reclaim quota and keep chatting. usage_events is written once per turn
-- (chat.ts's persistAssistant) and NEVER deleted by a conversation/message
-- delete, so the rate-limit window can't be reset by destroying history.
--
-- FK behavior is load-bearing, read both notes before changing either:
--   - conversation_id is PROVENANCE ONLY: ON DELETE SET NULL. It must NEVER
--     become ON DELETE CASCADE — the entire point of this table is that
--     deleting a conversation cannot erase the usage it accrued. A row that
--     lost its conversation_id still counts toward the user's window.
--   - user_id IS ON DELETE CASCADE, and that is correct and does NOT reopen
--     the hole: deleteAccount() (src/server/auth.ts) does a full
--     `DELETE FROM users`, which kills the session along with the row — there
--     is no logged-in identity left to spend reclaimed quota after a user
--     deletes their own account. Do not "fix" this to SET NULL.
CREATE TABLE IF NOT EXISTS usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  input_tokens    INT NOT NULL DEFAULT 0,
  output_tokens   INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_events_window ON usage_events(user_id, created_at);

-- Backfill exactly ONE DAY of history, not the whole table. getWindowUsage's
-- rate-limit bucket (config.rateLimitWindowMinutes, default 120) can never
-- look further back than the bucket start, so backfilling older rows buys
-- the quota guarantee nothing while making this migration scale with the
-- size of messages/message_checks. Rows older than one day are intentionally
-- absent from usage_events — they've already aged out of every bucket that
-- could exist by the time this migration runs.
--
-- ONE statement (UNION ALL of both sources) rather than two separate
-- guarded INSERTs: the guard is "only backfill on a fresh table"
-- (WHERE NOT EXISTS (SELECT 1 FROM usage_events)), and two separate
-- statements would have the first INSERT make the table non-empty, causing
-- the second INSERT's guard to skip it — silently dropping the
-- message_checks half of the backfill.
INSERT INTO usage_events (user_id, conversation_id, created_at, input_tokens, output_tokens)
SELECT * FROM (
  SELECT c.user_id, c.id, m.created_at, COALESCE(m.input_tokens, 0), COALESCE(m.output_tokens, 0)
  FROM messages m JOIN conversations c ON c.id = m.conversation_id
  WHERE m.created_at >= now() - interval '1 day'
  UNION ALL
  SELECT c.user_id, c.id, mc.created_at, COALESCE(mc.input_tokens, 0), COALESCE(mc.output_tokens, 0)
  FROM message_checks mc
  JOIN messages m ON m.id = mc.message_id
  JOIN conversations c ON c.id = m.conversation_id
  WHERE mc.created_at >= now() - interval '1 day'
) src
WHERE NOT EXISTS (SELECT 1 FROM usage_events);
