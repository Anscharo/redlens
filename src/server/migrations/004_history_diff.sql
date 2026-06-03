-- Add per-entry diff payload to atlas_history.
-- Previously diffs were served from static public/history/*.json files;
-- with those files removed from git the diff is stored here so the
-- /api/history/:nodeId endpoint can serve it directly.
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS diff JSONB;
