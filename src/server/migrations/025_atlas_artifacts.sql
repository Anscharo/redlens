-- Per-sha atlas artifact blobs: the set of built files ONE producer (the atlas
-- worker) publishes and EVERY web instance reads back, instead of each instance
-- rebuilding the same artifacts for itself on drift.
-- Plan: docs/plans/atlas-artifact-store.md (phase 1 = this table).
--
-- One row per (sha, file). Rows are immutable: a git sha pins the atlas content,
-- so the same (atlas_sha, name) can never legitimately carry different bytes.
-- That is why publishing is INSERT … ON CONFLICT DO NOTHING and why there is no
-- UPDATE path — a worker retry or a redeploy republishing the same sha is a
-- no-op, not a conflict to resolve. Retention is by whole sha (see
-- pruneArtifacts): the web serves a sha's files as a set, so half a sha is
-- useless and a per-row TTL would manufacture exactly that.
--
--   atlas_sha  text        — atlas submodule commit these artifacts were built at
--   name       text        — file name as served, e.g. "docs-shallow.json"
--   gz         bytea       — gzip -9 of the raw file bytes (~3 MB total per sha)
--   raw_bytes  integer     — uncompressed length; a cheap post-gunzip sanity check
--   sha256     text        — hex digest of the RAW (uncompressed) bytes
--   created_at timestamptz — publish time; the ordering retention prunes by
--
-- BYTEA — first use of the type in this schema. What was actually checked
-- (2026-08-25, bun 1.3.11, no live Postgres available in the authoring
-- environment): the driver was probed against a mock Postgres wire-protocol
-- server. A Buffer parameter is sent as parameter OID 17 (bytea) in BINARY
-- format with the exact bytes, unescaped, verified byte-identical at 3 MB
-- including NUL and 0xff; a bytea column arriving in Postgres' text hex format
-- (\x…) is decoded back to a Node Buffer, also byte-identical at 3 MB. So the
-- DRIVER round-trips cleanly. What that probe canNOT prove is the server half —
-- a real INSERT/SELECT against a real Postgres. atlas-artifacts.test.ts has a
-- live round-trip test that runs only when DATABASE_URL is set; run it (or a
-- dev-container publish) before trusting this table in production. If it ever
-- fails, the fallback is base64 TEXT and both this comment and the module's
-- encoding must change together.
CREATE TABLE IF NOT EXISTS atlas_artifacts (
  atlas_sha  TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  gz         BYTEA       NOT NULL,
  raw_bytes  INTEGER     NOT NULL,
  sha256     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (atlas_sha, name)
);

-- Retention and "what has been published" both scan by recency. The table is
-- tiny while pruning runs (a handful of shas × ~8 files), so this index earns
-- its keep only in the case that matters: a worker that stopped pruning.
CREATE INDEX IF NOT EXISTS atlas_artifacts_created_idx
  ON atlas_artifacts (created_at DESC);
