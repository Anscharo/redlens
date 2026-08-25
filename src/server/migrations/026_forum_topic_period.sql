-- Persist the YYYY-MM period(s) named in an MSC (etc.) thread title so the
-- settlement page can join a selected month to a forum URL without re-parsing.

ALTER TABLE forum_topics
  ADD COLUMN IF NOT EXISTS period JSONB NOT NULL DEFAULT '[]'::jsonb;
