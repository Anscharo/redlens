-- In-app feedback tool: free-text bug reports, submitted anonymously or
-- signed-in, from any page (URL/node/atlas + app commit context attached
-- client-side). Rate limiting + dedupe are read from THIS table (see
-- feedback.ts's rateLimitAndDedupe) — no separate ledger, since feedback has
-- no delete/cascade path that could reclaim quota (unlike usage_events,
-- migration 017).
--
-- user_id ON DELETE SET NULL, DELIBERATELY UNLIKE 017's ON DELETE CASCADE: a
-- bug report is operational data ABOUT THE APP (what broke, on what page),
-- not the user's content — deleting an account should not erase evidence of
-- a bug the app produced. The row survives as an orphaned (user_id NULL)
-- report; submitter_key still ties duplicate/rate-limit accounting together
-- for the anonymous case.
--
-- node_id is TEXT, not UUID: it's a client-supplied "which doc was open"
-- hint with no FK (no ON DELETE behavior to reason about, and atlas node ids
-- aren't a stable target — see CLAUDE.md's "never hardcode doc_nos" plus the
-- atlas's own churn). A malformed/truncated client value must not fail a
-- ::uuid cast and 500 the whole submission — same reasoning as
-- collection_items.doc_id in 014_collections.sql, which is TEXT for exactly
-- this reason.
--
-- No `ip` column, ON PURPOSE: the app is IP-free by policy (see
-- analytics.ts/posthog-capture.ts's $geoip_disable), and Railway's load
-- balancer makes a captured IP meaningless as a rate-limit key anyway (it's
-- the LB's address, not the client's — see preview/handler.ts's per-IP
-- window, which this table's Postgres-backed submitter_key limiting exists
-- to avoid repeating).
CREATE TABLE IF NOT EXISTS feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  submitter_key TEXT,
  message       TEXT NOT NULL,
  message_hash  TEXT NOT NULL,
  url           TEXT, host TEXT,
  app_commit    TEXT, atlas_commit TEXT,
  atlas_base    TEXT, preview_id TEXT,
  node_id       TEXT,
  session_id    TEXT,
  user_agent    TEXT,
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,
  console       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'new',
  ph_sent       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS feedback_created   ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_submitter ON feedback(submitter_key, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_user      ON feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_dedupe    ON feedback(message_hash, created_at DESC);
