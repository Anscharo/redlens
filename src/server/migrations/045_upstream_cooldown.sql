-- How long each outside API host is left alone after it said we were going too
-- fast (src/lib/upstreamBackoff.ts). The worker exits after each run, so a
-- cooldown longer than one run is kept here and loaded by the next one.
CREATE TABLE IF NOT EXISTS upstream_cooldown (
  host   TEXT PRIMARY KEY,
  until  TIMESTAMPTZ NOT NULL
);
