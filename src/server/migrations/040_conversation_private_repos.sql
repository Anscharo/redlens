-- The private repositories whose PR previews a conversation's tool calls have
-- read. Persisted text from a private preview (tool results, answers) is only as
-- private as this list keeps it: reopening or continuing the conversation
-- re-checks the user's live access to every repo here (chat/conversation-access.ts)
-- and refuses once any is revoked, and a non-empty list keeps the conversation's
-- prompt and response text out of PostHog's AI analytics.
--
-- text[] of `owner/name`, appended with array_append on a scalar bind, never a
-- JS array (Bun.sql does not bind one to a Postgres array; see pg-array.ts).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS private_repos TEXT[] NOT NULL DEFAULT '{}';
