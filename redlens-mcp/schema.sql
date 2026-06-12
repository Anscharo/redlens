-- RedLens Atlas — D1 schema
-- "docs" = Atlas Documents (uuid, doc_no, title, type, content); the source of truth.
-- "entities" = named real-world actors extracted from docs; point back to their defining doc.
-- See .claude/skills/graph-atlas/SKILL.md for the full entity taxonomy and edge vocabulary.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- docs — all 9,825+ Atlas Documents. Loaded before entities (primary source).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS docs (
  id          TEXT PRIMARY KEY,
  doc_no      TEXT NOT NULL,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  depth       INTEGER NOT NULL DEFAULT 0,
  parent_id   TEXT REFERENCES docs(id),
  content     TEXT NOT NULL DEFAULT '',
  ord         INTEGER NOT NULL DEFAULT 0,
  atlas_hash  TEXT,   -- atlas submodule commit SHA when this row was last written
  updated_at  TEXT    -- ISO timestamp of the sync run that last changed this row
);

CREATE INDEX IF NOT EXISTS idx_docs_doc_no   ON docs(doc_no);
CREATE INDEX IF NOT EXISTS idx_docs_parent   ON docs(parent_id);
CREATE INDEX IF NOT EXISTS idx_docs_type     ON docs(type);

CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  id UNINDEXED,
  doc_no,
  title,
  type,
  content,
  content=docs,
  content_rowid=rowid
);

-- FTS5 is rebuilt explicitly via `INSERT INTO docs_fts(docs_fts) VALUES('rebuild')`
-- at the end of sync-d1.mjs after all docs rows are loaded. Per-row triggers
-- were removed because they fired on every delete AND every insert during the
-- bulk clear→reload cycle, doubling the effective write count for docs.

-- ---------------------------------------------------------------------------
-- entities — named real-world actors, derived from docs.
-- entity_type vocabulary (see graph-atlas skill for full reference):
--   agent | composite_party | foundation | development_company | ecosystem
--   operational_party | governance_body | facilitator_org | govops_org
--   delegate_org | ecosystem_actor
--   primitive | instance | invocation
-- agent subtypes: proto | prime | operational_executor | core_executor
-- instance vs invocation: per atlas A.2.2.1.3 / A.2.2.1.4, an instance is an
--   operational deployment (status Active/Suspended/Completed); an invocation
--   is the in-progress act of enabling a primitive (status InProgress). They
--   carry the same param shape but are distinct entity types so queries can
--   filter on operational vs in-progress without inspecting meta.status.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
  id               TEXT PRIMARY KEY,
  slug             TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  subtype          TEXT,
  defining_doc_id  TEXT REFERENCES docs(id),  -- NULL for bootstrap/synthetic
  is_active        INTEGER DEFAULT 1,
  meta             TEXT             -- JSON provenance for synthetic entities
);

CREATE INDEX IF NOT EXISTS idx_entities_type    ON entities(entity_type, subtype);
CREATE INDEX IF NOT EXISTS idx_entities_slug    ON entities(slug);
CREATE INDEX IF NOT EXISTS idx_entities_defdoc  ON entities(defining_doc_id);

-- ---------------------------------------------------------------------------
-- addresses — on-chain addresses; composite PK (same EVM addr on multiple chains)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS addresses (
  address         TEXT NOT NULL,
  chain           TEXT NOT NULL,
  label           TEXT,
  chainlog_id     TEXT,
  etherscan_name  TEXT,
  is_contract     INTEGER DEFAULT 0,
  is_proxy        INTEGER DEFAULT 0,
  implementation  TEXT,
  roles           TEXT,            -- JSON string[]
  aliases         TEXT,            -- JSON string[]
  expected_tokens TEXT,            -- JSON string[]
  chain_state     TEXT,            -- JSON view-fn snapshot
  state_block     TEXT,
  entity_id       TEXT REFERENCES entities(id),
  PRIMARY KEY (address, chain)
);

CREATE INDEX IF NOT EXISTS idx_addresses_entity ON addresses(entity_id);
CREATE INDEX IF NOT EXISTS idx_addresses_chain  ON addresses(chain);
CREATE INDEX IF NOT EXISTS idx_addresses_label  ON addresses(label);

-- ---------------------------------------------------------------------------
-- edges — typed, auditable relationships
-- Every edge carries source_doc_nos: the Atlas docs that establish the relationship.
-- See .claude/skills/graph-atlas/SKILL.md for the full edge vocabulary.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id          TEXT NOT NULL,
  from_type        TEXT NOT NULL,   -- 'doc' | 'entity' | 'address'
  to_id            TEXT NOT NULL,
  to_type          TEXT NOT NULL,   -- 'doc' | 'entity' | 'address'
  edge_type        TEXT NOT NULL,
  source_doc_nos   TEXT,            -- JSON string[] — Atlas doc_nos that prove this edge
  weight           REAL DEFAULT 1.0,
  meta             TEXT             -- JSON extra context
);

CREATE INDEX IF NOT EXISTS idx_edges_from      ON edges(from_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_to        ON edges(to_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_type      ON edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_from_type ON edges(from_type);

-- ---------------------------------------------------------------------------
-- kv_meta — provenance for the currently-deployed snapshot.
-- Populated by sync-d1.mjs from public/manifest.json.
-- The worker echoes these values in every tool response so callers can tell
-- which atlas commit produced an answer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kv_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- node_history — git-log of per-doc changes derived from public/history/<uuid>.json.
-- One row per change event (added | modified | removed | moved).
-- Diff payloads are NOT stored here; callers fetch the full per-node JSON from
-- the deployed GitHub Pages site when they need line/word diffs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id        TEXT NOT NULL,                -- not FK: covers nodes later removed from docs
  date          TEXT NOT NULL,                -- YYYY-MM-DD, sortable
  commit_hash   TEXT NOT NULL,                -- 7-char abbrev
  commit_seq    INTEGER,                      -- topological position in git log (1000-based); stable across rebases
  change_type   TEXT NOT NULL,                -- added | modified | removed | moved
  pr_number     INTEGER,
  pr_title      TEXT,
  pr_author     TEXT,
  pr_url        TEXT,
  summary       TEXT,                         -- matched PR bullet title, or PR title fallback
  description   TEXT,                         -- matched bullet description, or short PR body
  moved_from    TEXT,
  moved_to      TEXT
);

-- Natural key for dedup: a node can only have one event of each type per commit.
-- Required for INSERT OR IGNORE in sync-history.mjs (incremental sync).
CREATE UNIQUE INDEX IF NOT EXISTS idx_hist_unique    ON node_history(doc_id, commit_hash, change_type);
CREATE INDEX IF NOT EXISTS idx_hist_doc       ON node_history(doc_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_hist_date      ON node_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_hist_type_date ON node_history(change_type, date DESC);
CREATE INDEX IF NOT EXISTS idx_hist_pr        ON node_history(pr_number);
CREATE INDEX IF NOT EXISTS idx_hist_seq       ON node_history(commit_seq);

-- ---------------------------------------------------------------------------
-- schema_migrations — tracks which one-time migrations have been applied.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
