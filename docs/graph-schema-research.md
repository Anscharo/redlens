# RedLens Graph Schema — Research & Design

*Research session: 2026-04-15. Do not build until reviewed.*

---

## Context

RedLens is a search-first interface for the Sky Atlas (`vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md`, ~48k lines, 9,825 nodes). The goal is to add a graph layer on top of the existing static site, backed by Cloudflare Workers + D1 (SQLite), serving both a REST API for the frontend and an MCP server for AI clients.

Existing data artifacts (all in `public/`):
- `docs.json` — `Record<uuid, AtlasNode>` — 9,825 nodes, full content
- `search-index.json` — serialized lunr index
- `addresses.json` — 294 on-chain addresses extracted from Atlas content
- `chain-state.json` — view-function snapshots for 28 contracts (currently ETH mainnet only)

The existing D1 schema stub (in memory from a prior session) is just:
```sql
CREATE TABLE nodes (id TEXT PRIMARY KEY, doc_no TEXT, title TEXT, type TEXT, depth INTEGER, parent_id TEXT, content TEXT);
CREATE TABLE edges (from_id TEXT, to_id TEXT, type TEXT);
```
This research supersedes that stub entirely.

---

## Atlas Structure

### Document types (12 total)
From `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md`:

| Type | Role |
|---|---|
| Scope | Top-level (A.1–A.6) |
| Article | Second level |
| Section | Third level |
| Core | Primary working doc, nestable |
| Type Specification | Defines document type characteristics |
| Active Data Controller | Manages mutable state docs |
| Annotation | Supporting, at `.0.3.X` — expands definitions |
| Action Tenet | Supporting, at `.0.4.X` — conditional guidance |
| Scenario | At `.0.4.X.1.X` — hypothetical fact patterns |
| Scenario Variation | At `.X.varN` |
| Active Data | At `.0.6.X` — mutable state (membership lists, current configs) |
| Needed Research | Global `NR-X` numbering |

### Node heading format
```
^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$
```
Fields: depth, doc_no (e.g. `A.6.1.2.2.1`), title, type, UUID.

### The 6 Scopes

| Doc No | Title | UUID |
|---|---|---|
| A.1 | The Governance Scope | 18ac7dd3-c646-4352-9b0d-d01a2932d7d1 |
| A.2 | The Support Scope | 1ce14bd8-c7b3-4f74-a152-292a8d8ebed0 |
| A.3 | The Stability Scope | d56538fc-2220-491a-a4d2-7ad6e461d707 |
| A.4 | The Protocol Scope | 5c20d9af-0bb9-4ca1-a944-1e2cb6f8bb6b |
| A.5 | The Accessibility Scope | 99b1b47d-3c7a-4859-ac00-8c0849f9070e |
| A.6 | The Agent Scope | 4a08ca6c-e652-49e4-9b79-4831b20e600a |

---

## Entity Map

### Type definitions (A.0.1.1.x — all type=Core)

| Doc No | Title | UUID |
|---|---|---|
| A.0.1.1.17 | Alignment Conserver | 94a451ce-100c-4ff5-8d53-65953938ecde |
| A.0.1.1.18 | Aligned Delegate | 8ea04ed4-7075-45e6-b6ed-a52b7506f4a8 |
| A.0.1.1.19 | Facilitator | 912e0161-3448-470f-9cf6-d1a26d76acab |
| A.0.1.1.39 | Agent | (definition node) |
| A.0.1.1.40 | Agent Artifact | 8d081c1a-6393-4aaf-8914-8959cdf2fee3 |
| A.0.1.1.41 | Agent Scope | 87dafa99-c36e-4e68-ac19-fccac4b3834d |
| A.0.1.1.42 | Prime Agent | a8454271-c090-4084-b022-4430e3def93c |
| A.0.1.1.43 | Executor Agent | ac514975-66ad-4b43-8f76-42cac5ca599d |
| A.0.1.1.44 | Operational Executor Agent | 23253343-23e3-440f-90c0-43d3437c2098 |
| A.0.1.1.45 | Core Council Executor Agent | 2a440474-20d1-4703-a57b-35e0cebb881c |
| A.0.1.1.46 | Core Council | 5a03a0c4-a47a-409c-9b23-52ac93e63d45 |
| A.0.1.1.47 | GovOps | 1e73ee4b-823d-406a-af54-223b43bc8e42 |
| A.0.1.1.48 | Operational Executor GovOps | 80c7e2e1-a2af-47dd-80c7-aee6823cca91 |
| A.0.1.1.49 | Core Council GovOps | e512e890-629f-450f-a14d-a3ea06a369c0 |
| A.0.1.1.50 | Operational Executor Facilitator | 2d984fe4-c1d7-4ac3-835b-19f19a3a5505 |
| A.0.1.1.51 | Core Council Executor Facilitator | 453e9bfb-2776-486d-b451-35742e49e0ab |

### Prime Agents (A.6.1.1.x)

| Doc No | Name | UUID |
|---|---|---|
| A.6.1.1.1 | Spark | dee2f5a4-279a-488c-9a9d-9583e3216fbf |
| A.6.1.1.2 | Grove | 727b0de6-095b-485e-bf9c-02108a364480 |
| A.6.1.1.3 | Keel | bc6aed17-2969-4d04-9af6-c7bf3e4497e6 |
| A.6.1.1.4 | Skybase | c88439b5-f456-4e51-8825-42e0ba83546f |
| A.6.1.1.5 | Obex | f558e673-cbab-4696-8ca1-3af9b90fe5d4 |
| A.6.1.1.6 | Pattern | dc083d10-74bc-43b6-ab2f-c91efce76e84 |
| A.6.1.1.7 | Launch Agent 6 | eba0dcc7-e135-496f-b866-342deeb91dc4 |
| A.6.1.1.8 | Launch Agent 7 | d0d77316-0b08-447c-b75a-ae7926b07019 |

### Executor Agents and their named Facilitators/GovOps (A.6.1.2.x)

| Agent | Agent UUID | Agent Doc | Facilitator | Fac Doc | Fac UUID | GovOps | GO Doc | GO UUID |
|---|---|---|---|---|---|---|---|---|
| Amatsu | c57df14a-... | A.6.1.2.1 | **Endgame Edge** | A.6.1.2.1.1 | a874a419-... | **Soter Labs** | A.6.1.2.1.2 | 66845ee6-... |
| Ozone | 565660dd-... | A.6.1.2.2 | **Redline Facilitation Group** | A.6.1.2.2.1 | d282ccb9-... | **Soter Labs** | A.6.1.2.2.2 | a491d7d0-... |
| Core Council Executor Agent 1 | 12b14e05-... | A.6.1.2.3 | **JanSky** | A.6.1.2.3.1 | 8cfee319-... | **Atlas Axis** | A.6.1.2.3.2 | 3b9b8910-... |

Key observations:
- **Soter Labs** is GovOps for *both* Amatsu and Ozone — one entity row, two `member_of` edges.
- **Endgame Edge** is Facilitator for Amatsu AND an ERG member — same entity, multiple role edges.
- **JanSky** is Core Facilitator AND an ERG member — same.
- **Atlas Axis** is Core GovOps AND an ERG member — same.

### Emergency Response Group (Active Data node)

Doc No: `A.1.8.1.2.2.0.6.1`  
UUID: `e9807449-fdc3-4860-8d53-c56181311618`  
Parent: `A.1.8.1.2.2` — Emergency Response Group Membership

Current members (from Atlas, as of research date):
Endgame Edge, JanSky, Ecosystem, Phoenix Labs, Jetstream, Atlas Axis, Steakhouse, Blocktower, Core Council Risk Advisor, Maker Growth, Dewiz, Sidestream, Cloaky, Blue, JuliaChang, PullUp Labs, Chronicle Labs, TechOps Services

These 18 names appear only as list items in an Active Data node — **no own Atlas nodes, no UUIDs**. They must be **synthetic entity records** (see design decisions below).

### Pioneer Primes (Active Data A.2.2.8.3.1.2.1.0.6.1)
Currently active: Keel, Grove.

### Aligned Delegates
Represented in `addresses.json` as 29 EOAs with `roles: ["delegate"]`.  
Names: Bonapublica, PBG, WBC, BLUE, Cloaky, and others.  
Derecognized ADs tracked at `A.1.4.10.2.0.6.1` (Active Data).

---

## Data Artifacts

### `addresses.json` shape
294 entries keyed by normalized lowercase address:
```json
{
  "0x167c1a762b08d7e78dbf8f24e5c3f1ab415021d3": {
    "chain": "ethereum",
    "explorerUrl": "https://etherscan.io/address/0x...",
    "label": "Bonapublica",
    "isContract": false,
    "isProxy": false,
    "roles": ["delegate"],
    "aliases": [],
    "expectedTokens": []
  }
}
```
Distribution: 186 contracts, 108 EOAs  
Chains present: ethereum, base, avalanche, solana  
Role tags: delegate (29), multisig (28), spark (10), buffer (9), subproxy (9), foundation (6), proxy (7), grove (5), executor (3), vesting (2), external (2), reserve (1), staking-rewards (1), incentive-pool (1), registry (1), sky (2), hot-wallet (1)

### `chain-state.json` shape (current — ETH mainnet only)
```json
{
  "generatedAt": "2026-04-14T14:34:49.444Z",
  "block": "24878662",
  "values": {
    "0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b": {
      "Line": "...", "debt": "...", "live": "...", "vice": "..."
    }
  }
}
```
28 contracts covered. Method names include: `Line/debt/live/vice` (MCD_VAT), `buffer/ilk/jug/roles` (AllocatorVaults), `maxDelay/prob/spellData/subProxy` (SubProxies), `dssVest/gem/lastDistributedAt` (vesting), standard token methods, etc.

**Problem**: single global block, ETH-only. Needs per-chain redesign for multi-chain.

**Proposed multi-chain `chain-state.json` shape**:
```json
{
  "generatedAt": "...",
  "chains": {
    "ethereum": { "block": "24878662", "values": { "0x...": { "method": "value" } } },
    "base":     { "block": "...",      "values": { ... } },
    "avalanche": { "block": "...",     "values": { ... } },
    "solana":   { "slot": "...",       "values": { ... } }
  }
}
```

---

## Proposed D1/SQLite Schema

### `entities` — semantic catalog of named real-world actors

```sql
CREATE TABLE entities (
  id              TEXT PRIMARY KEY,  -- UUID: reuse defining Atlas node's UUID if Atlas-defined,
                                     --       else generate (e.g. crypto.randomUUID())
  slug            TEXT UNIQUE,       -- 'redline', 'agent-ozone', 'soter-labs', 'endgame-edge'
  name            TEXT NOT NULL,     -- 'Redline Facilitation Group', 'Endgame Edge'
  entity_type     TEXT NOT NULL,     -- see vocab below
  subtype         TEXT,              -- specialization within type
  defining_node_id TEXT,             -- FK → atlas_nodes.id; NULL for synthetic entities
  is_active       INTEGER DEFAULT 1,
  meta            TEXT               -- JSON; see provenance notes below
);
```

**`entity_type` + `subtype` vocab**:
```
entity_type              subtype
──────────────────────────────────────────────────
agent                    prime | operational_executor | core_executor
operational_facilitator  executor_facilitator | core_facilitator
govops                   operational_govops | core_govops
alignment_conserver      aligned_delegate | facilitator
ecosystem_actor          —
core_council             —
scope                    —
primitive                —
```

**Synthetic entity `meta`** (for entities with no Atlas node):
```json
{
  "source": "active_data_list",
  "source_node_id": "e9807449-fdc3-4860-8d53-c56181311618",
  "source_doc_no": "A.1.8.1.2.2.0.6.1",
  "extracted_as": "list_item"
}
```

**Atlas-defined entity `meta`** can be `null` or `{}`.

---

### `atlas_nodes` — all 9,825 Atlas document nodes

```sql
CREATE TABLE atlas_nodes (
  id        TEXT PRIMARY KEY,   -- UUID from <!-- UUID: ... -->
  doc_no    TEXT UNIQUE,        -- 'A.6.1.2.2.1'
  title     TEXT,
  type      TEXT,               -- Scope | Article | Section | Core | Annotation | ...
  depth     INTEGER,            -- 1–6 (capped per parser)
  parent_id TEXT REFERENCES atlas_nodes(id),
  content   TEXT,
  ord       INTEGER,            -- parse order within parent (avoid reserved word 'order')
  entity_id TEXT REFERENCES entities(id)  -- set if this node defines/names an entity
);

CREATE VIRTUAL TABLE atlas_nodes_fts USING fts5(id, doc_no, title, type, content);
```

---

### `addresses` — all on-chain addresses

Composite PK because the same EVM address can exist on multiple chains.

```sql
CREATE TABLE addresses (
  address         TEXT NOT NULL,     -- normalized lowercase (EVM) or case-sensitive (Solana)
  chain           TEXT NOT NULL,     -- 'ethereum' | 'base' | 'arbitrum' | 'optimism' |
                                     -- 'polygon' | 'avalanche' | 'gnosis' | 'solana'
  label           TEXT,              -- resolved: chainlogId > atlas entityLabel > etherscanName
  chainlog_id     TEXT,              -- e.g. 'MCD_VAT' (future: from build-addresses.mjs)
  etherscan_name  TEXT,              -- (future: from getsourcecode)
  is_contract     INTEGER DEFAULT 0,
  is_proxy        INTEGER DEFAULT 0,
  implementation  TEXT,              -- implementation address if proxy
  roles           TEXT,              -- JSON string[] — role vocab tags from addresses.json
  aliases         TEXT,              -- JSON string[]
  expected_tokens TEXT,              -- JSON string[]
  chain_state     TEXT,              -- JSON: view-fn snapshot for this (address, chain)
                                     -- merged from chain-state.json chains[chain].values[addr]
  state_block     TEXT,              -- block/slot at snapshot (string — avoids BigInt overflow)
  state_at        TEXT,              -- ISO timestamp from chain-state.generatedAt
  entity_id       TEXT REFERENCES entities(id),
  PRIMARY KEY (address, chain)
);

CREATE INDEX idx_addresses_entity ON addresses(entity_id);
CREATE INDEX idx_addresses_chain  ON addresses(chain);
```

---

### `edges` — all typed relationships

```sql
CREATE TABLE edges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id   TEXT NOT NULL,      -- UUID, (address+chain composite encoded), or entity id
  from_type TEXT NOT NULL,      -- 'atlas_node' | 'entity' | 'address'
  to_id     TEXT NOT NULL,
  to_type   TEXT NOT NULL,
  edge_type TEXT NOT NULL,      -- see vocab below
  weight    REAL DEFAULT 1.0,
  meta      TEXT                -- JSON: {source_node, confidence, inferred: bool}
);

CREATE INDEX idx_edges_from  ON edges(from_id, edge_type);
CREATE INDEX idx_edges_to    ON edges(to_id, edge_type);
CREATE INDEX idx_edges_type  ON edges(edge_type);
CREATE INDEX idx_entities_type ON entities(entity_type, subtype);
```

**`edge_type` vocab**:

| edge_type | from_type → to_type | populated from |
|---|---|---|
| `parent_of` | atlas_node → atlas_node | `parentId` in docs.json |
| `cites` | atlas_node → atlas_node | `[text](uuid)` markdown links in content |
| `annotates` | atlas_node → atlas_node | doc_no `.0.3.X` pattern |
| `active_data_for` | atlas_node → atlas_node | doc_no `.0.6.X` pattern |
| `defines_entity` | atlas_node → entity | named entity extraction (Facilitator/GovOps nodes) |
| `is_a` | entity → entity | type hierarchy (PrimeAgent IS_A Agent) |
| `member_of` | entity → entity | Facilitator/GovOps assigned to an Agent |
| `oversees` | entity → entity | CoreCouncil → OperationalExecutorAgent |
| `responsible_for` | entity → atlas_node | Facilitator role → Scope node |
| `member_of_erg` | entity → atlas_node | ERG Active Data node membership list |
| `has_address` | entity → address | label/role matching at import |
| `proxies_to` | address → address | chain-state or etherscan |
| `mentions` | atlas_node → address | `addressRefs` in docs.json |

For `address` nodes in edges, encode the composite key as `"<address>:<chain>"` (e.g. `"0xabc123:ethereum"`).

---

## Build Pipeline Addition

New script: `scripts/build-graph.mjs`

Steps:
1. Read `public/docs.json` → populate `atlas_nodes` (all 9,825 rows)
2. Extract named entities by scanning Core nodes whose content matches known patterns:
   - "The Operational Facilitator for ... is `<Name>`" → `operational_facilitator`
   - "Operational GovOps for ... is `<Name>`" → `govops`
   - "The Facilitator for ... is `<Name>`" → `operational_facilitator` (core subtype)
   - "GovOps for ... is `<Name>`" → `govops` (core subtype)
   - Scope nodes → `scope` entities
   - Prime Agent artifact nodes → `agent / prime`
   - Executor Agent artifact nodes → `agent / operational_executor` or `core_executor`
3. Extract synthetic entities from Active Data list nodes (ERG membership, Pioneer Primes, etc.)
4. Merge `public/addresses.json` + `public/chain-state.json` → populate `addresses` table
   - Join on `(address, chain)` composite key
   - `chain-state.json` needs per-chain redesign first (see above); in the interim, all
     chain-state values are assumed `chain = 'ethereum'`
5. Extract edges:
   - `parent_of` — from `node.parentId`
   - `cites` — regex `\[([^\]]+)\]\(([0-9a-f-]{36})\)` over node content
   - `annotates` — doc_no ending `.0.3.\d+`
   - `active_data_for` — doc_no ending `.0.6.\d+`
   - `defines_entity` — Core nodes whose content names a known entity
   - `member_of` — Facilitator/GovOps → Agent (from named assignment nodes)
   - `mentions` — from `node.addressRefs` (or extract fresh from content)
6. Emit `public/graph.json` for local inspection, or write directly to D1 via wrangler

```
pnpm build:graph   # reads docs.json + addresses.json + chain-state.json → graph.json / D1
```

---

## Design Decisions

1. **Composite PK on `addresses`** — `(address, chain)` not just `address`. Same EVM address
   can be deployed on ETH + Base + Arbitrum etc.

2. **Synthetic entities for Active Data list items** — entities that appear only as names in
   Active Data nodes (e.g. ERG members Endgame Edge, Steakhouse, Chronicle Labs) get real rows
   in `entities` with `defining_node_id = NULL` and provenance in `meta`. This is the agreed
   approach (not skipping them).

3. **Soter Labs serves multiple agents** — entity is one row, assignments are edges. Two
   `member_of` edges: `soter-labs → amatsu` and `soter-labs → ozone`.

4. **Endgame Edge wears multiple hats** — same entity row, multiple edge types:
   `member_of` (→ Agent Amatsu as facilitator) + `member_of_erg` (→ ERG node).
   `entity_type = 'operational_facilitator'`, `subtype = 'executor_facilitator'`.

5. **`chain-state.json` block per chain** — current flat structure is ETH-only. Future
   `fetch-snapshots.mjs` must emit per-chain blocks. Interim: treat all chain-state as
   `chain = 'ethereum'` and store `state_block` as string to avoid BigInt issues.

6. **Atlas MCP for research** — use `atlas_search`, `atlas_get`, `atlas_neighbors` MCP tools
   (already configured in `.mcp.json`) rather than reading the raw markdown file directly.

7. **D1 graph traversal** — N-hop traversal via SQLite recursive CTEs. Atlas queries rarely
   exceed 3 hops. No need for a dedicated graph DB.

---

## Relevant File Paths

```
scripts/build-index.mjs           existing build pipeline (do not modify for graph work)
scripts/build-graph.mjs           NEW — graph extraction script
scripts/build-addresses.mjs       NOT YET — chainlog + etherscan enrichment (separate pass)
public/docs.json                  input: 9,825 Atlas nodes
public/addresses.json             input: 294 on-chain addresses
public/chain-state.json           input: view-fn snapshots (ETH mainnet, 28 contracts)
public/graph.json                 output: graph export for local inspection
public/atlas-graph.json           exists already (unknown contents — check before overwriting)
src/types.ts                      AtlasNode, AddressInfo, SearchHit types
src/lib/docs.ts                   loadDocs() module cache pattern to follow
vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md   canonical Atlas spec
.mcp.json                         MCP config — atlas_search/atlas_get/atlas_neighbors available
```

**Note on `public/atlas-graph.json`**: this file already exists. Check its contents before
deciding whether `build-graph.mjs` should overwrite it or merge with it.

---

## What Has NOT Been Researched Yet

- Contents of `public/atlas-graph.json` (already exists — unknown schema/contents)
- Full list of aligned delegate addresses and whether they map to named entities
- Whether Spark/Grove/Keel/Skybase/Obex/Pattern have named Operational Facilitators
  (only Executor Agents were checked — Prime Agents may have facilitators in their Omni Documents)
- Chainlog integration (future `build-addresses.mjs` pass — out of scope for graph MVP)
- Etherscan `getsourcecode` enrichment (same future pass)
- `fetch-snapshots.mjs` multi-chain redesign (blocked on `chain-state.json` format change)
