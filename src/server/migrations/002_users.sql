-- Chat auth: users only. Sessions are stateless JWT cookies (no sessions table —
-- see session.ts), so this is the lone auth table. conversations/messages land in
-- a later migration alongside the /api/chat loop.
--
-- gen_random_uuid() is core in PG13+ (Railway runs pg16; docker-compose pins pg16).
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,            -- 'github' (MVP); 'google' (v1)
  provider_id  TEXT NOT NULL,            -- stable id from the provider (GitHub numeric id)
  email        TEXT,
  name         TEXT,
  avatar_url   TEXT,                     -- drives the profile button; not in the plan's sketch but /api/auth/me needs it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_id)
);
