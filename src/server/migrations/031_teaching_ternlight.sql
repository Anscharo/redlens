-- chat_teachings: one vector, embedded once at write.
--
-- 030 gave the table a 1024-dim OpenRouter `embedding`, filled asynchronously
-- after accept. Nothing ever read it: the matcher scores with on-device
-- ternlight (384-dim, WASM, ~2ms) so a turn never waits on a network embed,
-- and the SQL recall lane is the tsvector. It cost one OpenRouter call per
-- note for a column no query touched, so it goes.
--
-- Review of PR #386 found the ternlight vector being recomputed for every
-- accepted note on every chat turn. It is now computed SYNCHRONOUSLY at accept
-- and stored here; per turn the chat embeds only the QUESTION and Postgres
-- returns each row's cosine (1 - (ternlight_embedding <=> q)). Rows written
-- before this column are embedded once on first match and written back
-- (teach/match.ts). Cross-user teachings, if ever built, search this same
-- column — more rows, same space; add an index then.
-- No index now: retrieval filters by user_id first and a notebook is capped at
-- TEACH_FETCH_CAP rows.
ALTER TABLE chat_teachings ADD COLUMN IF NOT EXISTS ternlight_embedding vector(384);
DROP INDEX IF EXISTS chat_teachings_hnsw;
ALTER TABLE chat_teachings DROP COLUMN IF EXISTS embedding;
