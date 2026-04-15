-- RedLens Atlas — D1 schema (full)
-- Research: docs/graph-schema-research.md

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- entities — semantic catalog of named real-world actors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
  id               TEXT PRIMARY KEY,
  slug             TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  -- entity_type vocab: agent | operational_facilitator | govops |
  --                    alignment_conserver | ecosystem_actor | core_council | scope | primitive
  subtype          TEXT,
  -- subtype vocab (per entity_type):
  --   agent:                   prime | operational_executor | core_executor
  --   operational_facilitator: executor_facilitator | core_facilitator
  --   govops:                  operational_govops | core_govops
  --   alignment_conserver:     aligned_delegate | facilitator
  defining_node_id TEXT,           -- FK → atlas_nodes.id; NULL for synthetic entities
  is_active        INTEGER DEFAULT 1,
  meta             TEXT             -- JSON provenance (source, source_node_id, etc.)
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type, subtype);
CREATE INDEX IF NOT EXISTS idx_entities_slug ON entities(slug);

-- ---------------------------------------------------------------------------
-- atlas_nodes — all 9,825 Atlas document nodes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas_nodes (
  id          TEXT PRIMARY KEY,
  doc_no      TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  depth       INTEGER NOT NULL DEFAULT 0,
  parent_id   TEXT REFERENCES atlas_nodes(id),
  content     TEXT NOT NULL DEFAULT '',
  ord         INTEGER NOT NULL DEFAULT 0,
  entity_id   TEXT REFERENCES entities(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_doc_no   ON atlas_nodes(doc_no);
CREATE INDEX IF NOT EXISTS idx_nodes_parent   ON atlas_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type     ON atlas_nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_entity   ON atlas_nodes(entity_id);

CREATE VIRTUAL TABLE IF NOT EXISTS atlas_nodes_fts USING fts5(
  id UNINDEXED,
  doc_no,
  title,
  type,
  content,
  content=atlas_nodes,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON atlas_nodes BEGIN
  INSERT INTO atlas_nodes_fts(rowid,id,doc_no,title,type,content)
  VALUES (new.rowid,new.id,new.doc_no,new.title,new.type,new.content);
END;
CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON atlas_nodes BEGIN
  INSERT INTO atlas_nodes_fts(atlas_nodes_fts,rowid,id,doc_no,title,type,content)
  VALUES ('delete',old.rowid,old.id,old.doc_no,old.title,old.type,old.content);
END;
CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON atlas_nodes BEGIN
  INSERT INTO atlas_nodes_fts(atlas_nodes_fts,rowid,id,doc_no,title,type,content)
  VALUES ('delete',old.rowid,old.id,old.doc_no,old.title,old.type,old.content);
  INSERT INTO atlas_nodes_fts(rowid,id,doc_no,title,type,content)
  VALUES (new.rowid,new.id,new.doc_no,new.title,new.type,new.content);
END;

-- ---------------------------------------------------------------------------
-- addresses — on-chain addresses
-- Composite PK: same EVM address can exist on multiple chains
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
  roles           TEXT,           -- JSON string[]
  aliases         TEXT,           -- JSON string[]
  expected_tokens TEXT,           -- JSON string[]
  chain_state     TEXT,           -- JSON: view-fn snapshot for this (address, chain)
  state_block     TEXT,           -- block/slot at snapshot
  state_at        TEXT,           -- ISO timestamp
  entity_id       TEXT REFERENCES entities(id),
  PRIMARY KEY (address, chain)
);

CREATE INDEX IF NOT EXISTS idx_addresses_entity ON addresses(entity_id);
CREATE INDEX IF NOT EXISTS idx_addresses_chain  ON addresses(chain);
CREATE INDEX IF NOT EXISTS idx_addresses_label  ON addresses(label);

-- ---------------------------------------------------------------------------
-- edges — all typed relationships
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id   TEXT NOT NULL,
  from_type TEXT NOT NULL,    -- 'atlas_node' | 'entity' | 'address'
  to_id     TEXT NOT NULL,
  to_type   TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  weight    REAL DEFAULT 1.0,
  meta      TEXT              -- JSON: {source_node, confidence, inferred}
);

-- edge_type vocab:
--   parent_of       atlas_node → atlas_node   (structural hierarchy)
--   cites           atlas_node → atlas_node   ([text](uuid) markdown links)
--   annotates       atlas_node → atlas_node   (doc_no .0.3.X pattern)
--   active_data_for atlas_node → atlas_node   (doc_no .0.6.X pattern)
--   defines_entity  atlas_node → entity       (node names an entity)
--   is_a            entity     → entity       (type hierarchy)
--   member_of       entity     → entity       (Facilitator/GovOps assigned to Agent)
--   member_of_erg   entity     → atlas_node   (ERG Active Data membership)
--   responsible_for entity     → atlas_node   (Facilitator role → sections)
--   has_address     entity     → address      (entity owns an on-chain address)
--   proxies_to      address    → address      (proxy implementation)
--   mentions        atlas_node → address      (addressRefs in content)

CREATE INDEX IF NOT EXISTS idx_edges_from      ON edges(from_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_to        ON edges(to_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_type      ON edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_from_type ON edges(from_type);
