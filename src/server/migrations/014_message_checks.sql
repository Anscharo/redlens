-- Chat reliability harness (docs/plans/chat-reliability-harness.md): one row
-- per harness activity on an assistant message — deterministic round checks,
-- the verifier audit, a possible advisor recovery, and the post-revision
-- recheck. Rows (not columns on messages) because a message can have several,
-- and overall+action+model make escalation-rate dashboards a single GROUP BY.
-- Each model row carries its own generation_id for the async cost backfill.
CREATE TABLE IF NOT EXISTS message_checks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind           TEXT NOT NULL,   -- 'verify' | 'verify_recheck' | 'advisor_recovery' | 'round_checks'
  model          TEXT,            -- NULL for deterministic rows
  action         TEXT,            -- 'annotate' | 'revised' | NULL
  verdict        JSONB,           -- Verdict / recovery decision / CheckReport (incl. original answer when revised)
  overall        TEXT,            -- 'pass'|'warn'|'fail'|'unverified' (extracted for cheap aggregation)
  input_tokens   INT,
  output_tokens  INT,
  generation_id  TEXT,
  cost_usd       DECIMAL(10,6),
  latency_ms     INT
);

CREATE INDEX IF NOT EXISTS message_checks_message ON message_checks(message_id, created_at);
CREATE INDEX IF NOT EXISTS message_checks_window  ON message_checks(created_at);
CREATE INDEX IF NOT EXISTS message_checks_cost_pending ON message_checks(generation_id)
  WHERE generation_id IS NOT NULL AND cost_usd IS NULL;
