-- Chat persistence: conversations + messages. The agentic loop (/api/chat)
-- writes the user message before streaming and the assistant message after
-- completion (never partial content). cost_usd backfills asynchronously, so the
-- hard rate-limit gate leans on input_tokens+output_tokens (known at stream-end).
CREATE TABLE IF NOT EXISTS conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  title               TEXT,                 -- first ~60 chars of the first user message
  page_context        JSONB,                -- { path, nodeId, nodeTitle, nodeDocNo, actorSlug }
  model               TEXT,
  total_input_tokens  INT DEFAULT 0,
  total_output_tokens INT DEFAULT 0,
  total_cost_usd      DECIMAL(10,6) DEFAULT 0,
  query_atlas_calls   INT DEFAULT 0,
  summary             TEXT,                 -- compacted summary of messages before summary_upto_id
  summary_upto_id     UUID                  -- last message id folded into summary (set after messages exist)
);

CREATE INDEX IF NOT EXISTS conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  role            TEXT NOT NULL,            -- 'user' | 'assistant'
  content         TEXT NOT NULL,            -- assistant content written after stream completes; never partial
  tool_calls      JSONB,                    -- [{ mode/args, result_summary }]
  input_tokens    INT,
  output_tokens   INT,
  generation_id   TEXT,                     -- OpenRouter gen-… id; drives async cost backfill (last round only on multi-round turns → cost undercounts)
  cost_usd        DECIMAL(10,6),            -- NULL until the cost reconciler fills it
  latency_ms      INT
);

CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, created_at);
-- Backfill queue: messages with a generation id but no cost yet.
CREATE INDEX IF NOT EXISTS messages_cost_pending ON messages(generation_id) WHERE generation_id IS NOT NULL AND cost_usd IS NULL;
