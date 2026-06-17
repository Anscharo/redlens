-- Preview feature metadata. Bundles live on ephemeral disk (/tmp/previews); this
-- table is the durable sha→repo map that lets a pinned /preview/<sha> URL survive
-- a cache eviction or restart (a bare SHA can't locate a tarball without the repo),
-- plus the daily-quota / abuse accounting and build telemetry. NOT the bundle.
CREATE TABLE IF NOT EXISTS previews (
  sha          TEXT PRIMARY KEY,
  repo         TEXT        NOT NULL,
  ref          TEXT        NOT NULL,
  kind         TEXT        NOT NULL,            -- 'pr' | 'branch' | 'sha'
  pr_number    INTEGER,
  pr_title     TEXT,
  pr_author    TEXT,
  pr_state     TEXT,                            -- 'open' | 'merged' | 'closed'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_access  TIMESTAMPTZ NOT NULL DEFAULT now(),
  doc_count    INTEGER     NOT NULL DEFAULT 0,
  build_ms     INTEGER     NOT NULL DEFAULT 0
);

-- Daily-quota count is `WHERE created_at >= date_trunc('day', now() at utc)`.
CREATE INDEX IF NOT EXISTS previews_created_at_idx ON previews (created_at);
