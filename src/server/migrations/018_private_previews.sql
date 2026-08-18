-- Private atlas previews (docs/plans/private-previews.md).
--
-- Two additive columns, both safe to apply ahead of the feature being switched
-- on (privatePreviewsEnabled stays false until the GitHub App env vars are set):
--
--   users.github_login  — the viewer's GitHub login, needed for the App
--     collaborator-permission check. Identity is still anchored on provider_id
--     (immutable); the login is a lookup handle, refreshed on every login and
--     NULL for users who haven't logged in since this migration.
--
--   previews.private    — whether a bundle came from a private repo. Gates every
--     sha-keyed response (the DB row is a durability fallback; meta.json is the
--     authoritative build-time flag). Defaults false so every existing public
--     preview is unaffected.
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_login text;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;
