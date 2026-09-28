-- Account-scoped preview history: which previews a signed-in visitor has opened,
-- so /preview's "my recent previews" follows the ACCOUNT across browsers and
-- devices instead of living only in one browser's localStorage. The local record
-- (previewLocal.ts) stays: it is the whole story for anonymous visitors, and it
-- covers what a signed-in visitor opened before this table existed or while
-- logged out, so the reader (handler.ts /api/preview/mine) unions the two.
--
-- Keyed on (user_id, preview_id), NOT on sha. A preview id — `pull-346`,
-- `owner:repo:branch` — points at a NEW sha on every push, and the list wants one
-- row per thing you opened showing its latest build, exactly how localStorage
-- dedups by id. `sha` is therefore the newest sha seen for that id.
--
-- Deliberately NO foreign key on sha: the read joins previews for the title /
-- doc count / private flag, which already hides a blocked or unknown sha, and an
-- open must never fail because that row moved. user_id's ON DELETE CASCADE is
-- load-bearing — Preferences → Delete account is one DELETE FROM users
-- (auth.ts deleteAccount), and this history has to go with it.
CREATE TABLE IF NOT EXISTS preview_opens (
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preview_id      TEXT        NOT NULL,           -- the id the visitor opened (previewLocal.ts's grammar)
  sha             TEXT        NOT NULL,           -- newest resolved commit for that id
  first_opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, preview_id)
);

-- The one read pattern: this user's opens, newest first.
CREATE INDEX IF NOT EXISTS preview_opens_user ON preview_opens(user_id, last_opened_at DESC);
