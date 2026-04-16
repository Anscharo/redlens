---
name: graph-atlas
description: >
  Knowledge base for the RedLens Atlas graph schema. Use when writing or
  modifying redlens-mcp/scripts/build-graph.mjs, designing edge types, querying
  the Atlas MCP for relationships, reading raw Atlas markdown to understand
  doc_no patterns, or reviewing Atlas PRs for new structural conventions.
  Covers Atlas document numbering rules, the heading depth cap (parentId
  unreliability), primitive hub structure, entity extraction patterns,
  edge type vocabulary, and auditable provenance requirements.
  Keywords: graph, atlas, doc_no, edge, entity, primitive, instance, executor accord, build-graph, relations.json
license: proprietary
metadata:
  author: anscharo
  version: "1.1"
---

# graph-atlas

**Source of truth for Atlas document structure:** `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md`
Read that file before making any changes to graph extraction logic. This skill summarises what we've learned and must stay in sync with it.

**This skill should be updated** whenever a new relationship pattern is discovered in the Atlas — through reading the markdown, using the MCP tools, or noticing a structural convention not yet captured here. Add it under the appropriate section with an Atlas source reference (doc_no or UUID).

---

## Terminology

| Term | Meaning |
|---|---|
| **doc** | An Atlas Document — has `uuid`, `doc_no`, `title`, `type`, `content`. The Atlas calls these "Documents". Do not call them "nodes" (that is a graph term). |
| **entity** | A named real-world actor extracted from Atlas content |
| **address** | An on-chain address (EVM or Solana) |
| **edge** | A typed, auditable relationship between docs, entities, and/or addresses |

**Auditable edge requirement:** Every edge MUST carry `source_doc_nos` — a JSON array of the doc_nos that establish the relationship. Without provenance, an edge cannot be shown to users or cited in reports.

---

## Atlas Document Numbering

*From `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md` §8*

### Doc_no patterns by type

| Type | Pattern | Example |
|---|---|---|
| Scope | `A.{N}` | `A.1`, `A.2` |
| Article | `{Scope}.{N}` | `A.1.1` |
| Section | `{Article}.{N}` or `{Section}.{N}` | `A.1.1.1` |
| Core | `{Section}.{N}` (nestable arbitrarily) | `A.1.1.1.1` |
| Type Specification | `{Section}.{N}` | `A.1.2.2.2.1` |
| Active Data Controller | `{Section}.{N}` | `A.1.1.3.1` |
| Annotation | `{Target}.0.3.{N}` | `A.1.12.1.2.0.3.1` |
| Action Tenet | `{Target}.0.4.{N}` | `A.1.4.5.0.4.1` |
| Scenario | `{Tenet}.1.{N}` | `A.1.4.5.0.4.1.1.1` |
| Scenario Variation | `{Scenario}.var{N}` | `A.1.4.5.0.4.1.1.1.var1` |
| Active Data | `{Controller}.0.6.{N}` | `A.1.1.3.1.0.6.1` |
| Needed Research | `NR-{N}` (global) | `NR-5` |

### Special directory numbers

- `.0.3` = Element Annotation Directory
- `.0.4` = Facilitator Tenet Annotation Directory
- `.0.6` = Active Data Directory
- `.1` = Facilitator Scenario Directory

### Semantic depth vs heading level — CRITICAL for graph extraction

**Semantic depth** = `doc_no.split(".").length - 1` (segments after "A").

**Heading level** = `min(semantic_depth, 6)`. The Atlas markdown caps at `######` (6 hashtags).

**Consequence for `parentId` in `docs.json`:** The parser uses a heading-level stack. When a doc at semantic depth > 6 is encountered, it still gets `######`. Its `parentId` is set to whatever was last seen at heading level 5 — the nearest depth-5 ancestor — NOT its true semantic parent.

**Rule:**
- `doc_no.split(".").length <= 7` (semantic depth ≤ 6): `parentId` is reliable
- `doc_no.split(".").length > 7` (semantic depth > 6): `parentId` jumps to nearest depth-5 ancestor. **Use doc_no arithmetic instead.**

**Examples of the depth cap breaking parentId:**
- `A.6.1.1.1.2.1.1.1.1` (9 parts, depth 8) → `parentId = A.6.1.1.1.2` (Sky Primitives, not Hub Document)
- All ICDs, Hub Documents, Global Activation Status docs under Sky Primitives are affected

**Helper functions for build-graph.mjs:**
```javascript
function semanticParent(doc) {
  if (doc.doc_no.split(".").length <= 7) return docById.get(doc.parentId); // reliable
  const parts = doc.doc_no.split(".");
  return docByDocNo.get(parts.slice(0, -1).join(".")) ?? null;
}
function ancestorByStripping(doc, n) {
  const parts = doc.doc_no.split(".");
  return docByDocNo.get(parts.slice(0, -n).join(".")) ?? null;
}
```

---

## Entity Types (Atlas-confirmed)

Do not add an entity type unless it has a defining Atlas document or is explicitly mentioned as a type in Atlas content.

| entity_type | subtype | How to identify |
|---|---|---|
| `agent` | `prime` | Direct child of `A.6.1.1` (List Of Prime Agent Artifacts) |
| `agent` | `executor` | Direct child of `A.6.1.2` (List Of Executor Agent Artifacts) |
| `agent` | `halo` | Mentioned in `A.6.1.1.5.1` but no structural pattern yet — do not classify |
| `operational_facilitator` | — | Title "Operational Executor Facilitator" at `A.6.1.2.Y.1` |
| `core_facilitator` | — | Title "Core Executor Facilitator" at `A.6.1.2.Y.1` |
| `govops` | `operational` | Title "Operational GovOps" at `A.6.1.2.Y.2` |
| `govops` | `core` | Title "Core GovOps" at `A.6.1.2.Y.2` |
| `alignment_conserver` | `aligned_delegate` | `addresses.json` entries with `roles: ["delegate"]` |
| `ecosystem_actor` | — | Named list items in Active Data docs with no own UUID |
| `scope` | — | Docs with `type = "Scope"` |

**Key principle:** Always key on doc_no position, not title strings. Agent names change.

---

## Doc Number Patterns for Relationship Extraction

### Pattern 1: Prime Agent artifacts

```
A.6.1.1.X            {Agent Name}           ← Prime Agent (direct child of A.6.1.1)
A.6.1.1.X.1          Introduction
A.6.1.1.X.2          Sky Primitives         ← all primitive instances live here
A.6.1.1.X.3          Omni Documents

A.6.1.2.Y            {Executor Name}        ← Executor Agent (direct child of A.6.1.2)
A.6.1.2.Y.1          Facilitator doc        ← names the Facilitator entity
A.6.1.2.Y.2          GovOps doc             ← names the GovOps entity
```

### Pattern 2: Sky Primitives within an Agent

Each primitive under `A.6.1.1.X.2` follows this structure. Position `.2.Z` does **not** indicate primitive category — derive from the `See [...]` citation to `A.2.2`.

```
A.6.1.1.X.2.Z              {Primitive Name}      ← primitive root; cites global def in A.2.2
A.6.1.1.X.2.Z.1            Primitive Hub Document
A.6.1.1.X.2.Z.1.1          Global Activation Status
A.6.1.1.X.2.Z.1.2          Active Instances Directory
A.6.1.1.X.2.Z.1.2.N        {Name} ICD Location   ← pointer (may also be .1.3.N or .1.4.N)
A.6.1.1.X.2.Z.1.3          Completed Instances Directory
A.6.1.1.X.2.Z.1.4          In Progress Invocations Directory
A.6.1.1.X.2.Z.1.5          Hub Data Repository
A.6.1.1.X.2.Z.2            Active Instances
A.6.1.1.X.2.Z.2.N          {Name} Instance Configuration Document  ← live record
A.6.1.1.X.2.Z.3            Completed Instances
A.6.1.1.X.2.Z.4            In Progress Invocations
```

**ICD directory positions vary** — ICDs can be under Active (`.Z.2.N`), Completed (`.Z.3.N`), or In-Progress (`.Z.4.N`). Never assume Active Instances is the only position.

**All extraction uses doc_no arithmetic, not parentId** (depth cap makes parentId unreliable for docs deeper than 6 segments).

**Extraction rules:**

- `implements`: The primitive root always opens with `"... See [Global Name](uuid)."` — match the literal `"See [text](uuid)"` pattern where the target is under `A.2.2`. Only for `A.6.1.1.*` docs. Do not derive from `cites` edges (too broad).

- `instance_of`: ICD doc_no = `{primRoot}.{dir}.{N}`. Strip 2 segments → primitive root. Only for `A.6.1.1.*` ICDs — not global `A.2.2.*` docs whose titles mention "Instance Configuration Document".

- `located_at`: ICD Location doc always contains a UUID link to the actual ICD in its content. Extract UUID from content — do not guess from doc_no (directory position varies).

- `has_status`: Global Activation Status is at `{primRoot}.1.1`. Strip 2 segments → primitive root. Only for `A.6.1.1.*` docs.

### Pattern 3: Executor Accord (Prime → Executor)

Within an Executor Accord active instance:
```
A.6.1.1.X.2.Z.2.N.1.1.1    Operational/Core Executor Agent
```
This doc's content cites `A.6.1.2.Y` via a UUID link — authoritative link from Prime to Executor.

**Edges to extract:**
- `executor_accord`: `entity(prime_agent) → entity(executor_agent)`, sources: `[A.6.1.1.X.2.Z.2.N.1.1.1, A.2.8.2.N]` (ICD parameter doc + Ecosystem Accord)

### Pattern 4: Ecosystem Accords

Every child of `A.2.8.2` is an active accord. Title format `"Ecosystem Accord N: {Party} And {Party}"` for bilateral; descriptive name for multi-party (e.g. `A.2.8.2.2 "Prime Program"` = Sky + Grove + Spark). Extract parties from title/content — do not assume bilateral.

- `ecosystem_accord`: `doc(A.2.8.2.N) → entity(each_party)`, source: `[A.2.8.2.N]`

### Pattern 5: Facilitator / GovOps assignment

**Operational Executor Agents** (full prefix):
- `"The Operational Facilitator for {Executor} is {Name}."`
- `"Operational GovOps for {Executor} is {Name}."`

**Core Council Executor Agents** (no prefix — make regex optional):
- `"The Facilitator for {Executor} is {Name}."`
- `"GovOps for {Executor} is {Name}."`

- `member_of`: `entity(facilitator/govops) → entity(executor_agent)`, source: `[A.6.1.2.Y.1]` or `[A.6.1.2.Y.2]`

### Pattern 6: Active Data

Every `type = "Active Data Controller"` contains:
- `"The Responsible Party is {Entity Name}."` → `responsible_for` edge
- Active Data docs at `*.0.6.X`

- `responsible_for`: `entity → doc(controller)`, source: the controller doc
- `active_data_for`: `doc(*.0.6.X) → doc(controller)`, structural from doc_no suffix

### Pattern 7: ERG membership

Source: `A.1.8.1.2.2.0.6.1`. Members are plain-text list items with no UUID — create synthetic entities.

- `member_of_erg`: `entity(member) → doc(A.1.8.1.2.2.0.6.1)`, source: `[A.1.8.1.2.2.0.6.1]`

### Pattern 8: UUID citation links

Every `[text](uuid)` markdown link → `cites` edge, source: `[source_doc_no]`

### Pattern 9: Supporting doc suffixes

| Suffix | Type | Edge |
|---|---|---|
| `*.0.3.X` | Annotation | `annotates` → parent |
| `*.0.4.X` | Action Tenet | `annotates` → parent |
| `*.0.6.X` | Active Data | `active_data_for` → parent controller |
| `*.varX` | Scenario Variation | `annotates` → parent |

---

## Global Primitive Categories (A.2.2)

Derive category from the `implements` citation target's parent section:

| doc_no | Category |
|---|---|
| `A.2.2.4` | Genesis |
| `A.2.2.5` | Operational |
| `A.2.2.6` | Ecosystem Upkeep |
| `A.2.2.7` | SkyLink |
| `A.2.2.8` | Demand Side Stablecoin |
| `A.2.2.9` | Supply Side Stablecoin |
| `A.2.2.10` | Core Governance |

---

## Edge Type Vocabulary

```
parent_of         doc       → doc       Structural hierarchy (from parentId, reliable for depth ≤ 6)
cites             doc       → doc       UUID markdown link [text](uuid) in content
annotates         doc       → doc       Annotation/Tenet/Scenario (*.0.3.X, *.0.4.X)
active_data_for   doc       → doc       Active Data (*.0.6.X) → its controller
located_at        doc       → doc       ICD Location → ICD (via UUID in content)
instance_of       doc       → doc       ICD → primitive root (strip 2 segments from doc_no)
has_status        doc       → doc       Primitive root → Global Activation Status (strip 2)
implements        doc       → doc       Agent primitive → global def in A.2.2 (via "See" cite)
ecosystem_accord  doc       → entity    Ecosystem Accord doc → each party
executor_accord   entity    → entity    Prime Agent → Executor Agent (dual-sourced)
member_of         entity    → entity    Facilitator or GovOps → Executor Agent
member_of_erg     entity    → doc       ERG member → ERG Active Data doc
defines_entity    doc       → entity    Defining doc → the entity it names
responsible_for   entity    → doc       Responsible Party → Active Data Controller
has_address       entity    → address   Entity owns an on-chain address
controlled_by     address   → entity    Address controlled by entity
proxies_to        address   → address   Proxy → implementation address
mentions          doc       → address   addressRefs in doc content
```

---

## Open Questions

- **Halo Agents**: mentioned in `A.6.1.1.5.1` as a future category — no structural pattern yet
- **Multi-party Ecosystem Accords**: `A.2.8.2.2` (Prime Program) covers 3 parties — parse from content
- **Executor Accord position**: currently `.2.2` for all checked agents — derive from citation not position
