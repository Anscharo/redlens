-- Grace-period archive of built frontend assets (dist/assets/*). Every deploy
-- replaces the hashed chunks wholesale; a tab opened before the deploy still
-- requests the previous hashes and currently gets the SPA fallback HTML (a
-- broken dynamic import). The web service archives its own build's assets at
-- boot and serves disk misses from here, so pre-deploy tabs keep working for
-- the grace window. last_seen advances on every boot that still ships the
-- file; pruning is therefore "gone from all builds for N days".
CREATE TABLE IF NOT EXISTS asset_archive (
  path         TEXT PRIMARY KEY,          -- request path, e.g. /assets/App-abc12345.js
  gz           BYTEA NOT NULL,            -- gzip of the file bytes (assets are stored compressed only)
  content_type TEXT NOT NULL,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);
