---
name: parse-atlas
description: >
  Knowledge base for parsing the Sky Atlas into the RedLens graph. Use when
  writing or modifying scripts/required/build-graph.mjs or any lib/ phase script,
  designing edge types, querying the Atlas MCP for relationships, reading raw
  Atlas markdown to understand doc_no patterns, or reviewing Atlas PRs for new
  structural conventions. Covers Atlas document numbering rules, the heading
  depth cap (parentId unreliability), primitive hub structure, entity
  extraction patterns, Active Data table parsing, the role-as-edge vocabulary,
  composite accord parties, and auditable provenance requirements.
  Keywords: graph, atlas, doc_no, edge, entity, primitive, instance, invocation, role, facilitator, govops, prime agent, executor agent, composite party, build-graph, relations.json, table-parser, delegate, src_member, derecognized, active data
license: MIT
metadata:
  author: anscharo
  version: "2.1"
---

# parse-atlas

**Source of truth for Atlas document structure:** `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md`
Read that file before making any changes to graph extraction logic. This skill summarises what we've learned and must stay in sync with it.

**This skill should be updated** whenever a new relationship pattern is discovered in the Atlas — through reading the markdown, using the MCP tools, or noticing a structural convention not yet captured here. Add it under the appropriate section with an Atlas source reference (doc_no or UUID).

---

## Terminology

| Term        | Meaning                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **doc**     | An Atlas Document — has `uuid`, `doc_no`, `title`, `type`, `content`. The Atlas calls these "Documents". Do not call them "nodes" (that is a graph term). |
| **entity**  | A named real-world actor extracted from Atlas content (agent, foundation, dev company, facilitator org, delegate, ecosystem concept, etc.)                |
| **address** | An on-chain address (EVM or Solana)                                                                                                                       |
| **edge**    | A typed, auditable relationship between docs, entities, and/or addresses                                                                                  |

**Auditable edge requirement:** Every edge MUST carry `source_doc_nos` — a JSON array of the doc_nos that establish the relationship. Without provenance, an edge cannot be shown to users or cited in reports.

### Foundational Atlas definitions (keep verbatim)

> Agents are first-class economic citizens of Sky that autonomously pursue business opportunities. Each Agent has its own Agent Artifact and token. Initially, the creation of an Agent results in a **Proto-Agent**, which lacks any specialized role. To gain functionality within the Sky ecosystem, a Proto-Agent must deploy a special **Transformation Primitive** to transform into a specific Agent sub-type. The Agent sub-types currently defined in the Atlas include 1) **Prime Agent** and 2) **Executor Agent**, with the Executor Agent sub-type further divided into **Operational Executor Agents** and **Core Executor Agents**.
>
> Although Executor Agents are not yet operational, the Atlas nonetheless defines the foundational rules, processes, and governance structures necessary for their eventual activation. In the medium to long term, these Executor Agents will become fully operative and perform an essential function in facilitating the activities of Prime Agents across the Sky ecosystem.

**Role-as-edge principle.** "Spark is Prime Agent **for** Sky Ecosystem" is bilateral — the role describes a relationship between two entities. Roles therefore live on edges (`prime_agent_for`, `operational_executor_agent_for`, `operational_facilitator_for`, etc.), not on the entity's type. An entity's `entity_type` captures its broad kind (agent, foundation, facilitator_org); its obligations and relationships are expressed via edges. Atlas verb: "Ozone serves as the Operational Executor Agent **for** {Prime Agent}" (A.2.8.2.9.2.1.2).

### The "Sky" concept layers

The atlas distinguishes several "Sky" concepts. Do not collapse the named legal entities.

| Atlas term                       | Role                                                                                                                                                                                | entity_type         | Becomes target of                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| ~~Sky Ecosystem~~                | Scope that regulates Agents (A.6). **Editorial: collapsed into `sky-core`** — see Editorial Decisions.                                                                              | — (not emitted)     | —                                                                       |
| **Sky Core**                     | Operational party representing "Sky" in every Ecosystem Accord (verbatim "The party 'Sky' comprises Sky Core" in 8 accords). Also serves as the target for `prime_agent_for` edges. | `operational_party` | `prime_agent_for`, `ecosystem_accord` (as party), `comprises` (inbound) |
| **Sky Governance**               | Decision body that selects delegates and approves spells                                                                                                                            | `governance_body`   | `aligned_delegate_for`, `ranked_delegate_for`                           |
| **Sky Frontier Foundation**      | Legal entity; grant recipient (A.2.13.1.1; address `0xca5183FB9997046fbd9bA8113139bf5a5Af122A0`)                                                                                    | `foundation`        | normal entity edges                                                     |
| **Sky Fortification Foundation** | Legal entity; grant recipient (A.2.13.1.2)                                                                                                                                          | `foundation`        | normal entity edges                                                     |

**"Sky Foundation" does not exist in the atlas.** Be specific with names.

---

## Atlas Document Numbering

_From `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md` §8_

### Doc_no patterns by type

| Type                   | Pattern                                | Example                  |
| ---------------------- | -------------------------------------- | ------------------------ |
| Scope                  | `A.{N}`                                | `A.1`, `A.2`             |
| Article                | `{Scope}.{N}`                          | `A.1.1`                  |
| Section                | `{Article}.{N}` or `{Section}.{N}`     | `A.1.1.1`                |
| Core                   | `{Section}.{N}` (nestable arbitrarily) | `A.1.1.1.1`              |
| Type Specification     | `{Section}.{N}`                        | `A.1.2.2.2.1`            |
| Active Data Controller | `{Section}.{N}`                        | `A.1.1.3.1`              |
| Annotation             | `{Target}.0.3.{N}`                     | `A.1.12.1.2.0.3.1`       |
| Action Tenet           | `{Target}.0.4.{N}`                     | `A.1.4.5.0.4.1`          |
| Scenario               | `{Tenet}.1.{N}`                        | `A.1.4.5.0.4.1.1.1`      |
| Scenario Variation     | `{Scenario}.var{N}`                    | `A.1.4.5.0.4.1.1.1.var1` |
| Active Data            | `{Controller}.0.6.{N}`                 | `A.1.1.3.1.0.6.1`        |
| Needed Research        | `NR-{N}` (global)                      | `NR-5`                   |

**New-type tripwire:** `KNOWN_DOC_TYPES` in `scripts/lib/atlas-parser.mjs` mirrors this table. A heading with a `[Type]` outside the set parses normally (content is never dropped) but emits a `[drift] unknown document type` warning, and `parser.test.ts` fails CI until the type is reviewed — either handled by an extraction pattern or deliberately added to the set. Build stderr from atlas updates is diffed against `.github/atlas-warnings-baseline.txt` by `atlas-update.yml`; new lines open/append an `atlas-drift` issue for analysis.

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

Every entity type below either has a defining Atlas doc number pattern, or is bootstrapped because it's the target of a role edge with no single defining doc.

| entity_type           | subtype                | How to identify                                                                                                                                                                                                                                   |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`               | `proto`                | Pre-Transformation-Primitive Agent. Reserved — no named instances yet.                                                                                                                                                                            |
| `agent`               | `prime`                | Direct child of `A.6.1.1` (List Of Prime Agent Artifacts)                                                                                                                                                                                         |
| `agent`               | `operational_executor` | Direct child of `A.6.1.2` whose title starts `"Operational Executor Agent "`                                                                                                                                                                      |
| `agent`               | `core_executor`        | Direct child of `A.6.1.2` whose title starts `"Core Council Executor Agent "`                                                                                                                                                                     |
| `composite_party`     | —                      | Entity named as a party in `A.2.8.2.Y.1.1.N` (Ecosystem Accord party details). Holds treaty-level identity; its members are resolved via `comprises`.                                                                                             |
| `foundation`          | —                      | Named `"X Foundation"` — in party-comprises lists (e.g. Spark Foundation) or grant recipients (Sky Frontier Foundation, Sky Fortification Foundation)                                                                                             |
| `development_company` | —                      | Third slot in party-comprises lists. Examples: Phoenix Labs, Elodin, Treadstone, Stablewatch, Rubicon, "Development Company"                                                                                                                      |
| `operational_party`   | —                      | Bootstrapped: **Sky Core** (also serves as the target of `prime_agent_for`; see Editorial Decisions)                                                                                                                                              |
| `governance_body`     | —                      | Bootstrapped: **Sky Governance**                                                                                                                                                                                                                  |
| `facilitator_org`     | —                      | Named in `"The (Operational\|Core) Facilitator for {Executor} is {Name}."`                                                                                                                                                                        |
| `govops_org`          | —                      | Named in `"(Operational\|Core) GovOps for {Executor} is {Name}."`                                                                                                                                                                                 |
| `delegate_org`        | —                      | Active Delegates: Current Aligned Delegates Active Data (`5f584db8`, `is_active=1`). Derecognized: Derecognized Delegates Active Data (`e7aec672`, `is_active=0`). Ranked: UUID-anchored current-members docs (`RANKED_DELEGATE_UUIDS` — L1 `46c0f334`, L2 `ebe4da3b`; doc_nos `A.1.6.4.1.{L}.3.1` after the A.1.5→A.1.6 renumber). Fallback: `addresses.json` entries with `roles: ["delegate"]`. If an entity already exists as `ecosystem_actor` and appears in the active delegates table, it is **upgraded to `delegate_org`** (Pattern 16). |
| `src_member`          | —                      | Named in the SRC Membership Registry Active Data (`d9c6ed16`). Institutional risk advisors (currently Blockworks Advisory, L2 Beat, Aragon). Meta carries `domain_expertise`, `start_date`, `term_status`, `standing`.                           |
| `ecosystem_actor`     | —                      | Catch-all: named actors surfaced by patterns that don't fit a more specific kind (ERG members, role-binding holders, etc.)                                                                                                                        |
| `ecosystem_actor`     | `individual`           | Natural person / forum handle from the Current Authorized Forum Accounts table (`b71564fd`, Pattern 16 Table 4). Source of `authorized_rep_for` edges. Dropped from `relations.json` unless pinned.                                              |
| `ecosystem_actor`     | `integration_partner`  | Integration Boost partner promoted from `Integration Partner Name` ICD params (Pattern 19). Source of `integration_partner_of` edges; pinned into `relations.json`.                                                                              |
| `multisig`            | —                      | Multisig detected via the structural five-child convention (Pattern 17). Entity id = root doc UUID. Meta: `{address, chain, threshold, purpose_doc_no}`. Target of `signer_of` / `can_modify_signers_of`.                                        |
| `instance`            | `<primitive-slug>`     | Primitive Instance Configuration Document under the **Active/Suspended/Completed Instances** tier. Operational deployment per atlas A.2.2.1.3. Entity id = ICD doc UUID. Emitted for every in-scope primitive (see Pattern 14 for the allowlist). `st` is the primitive slug (`distribution-reward`, `integration-boost`, `allocation-system`, etc.). Status (Active/Suspended/Completed) lives in `meta.status`. |
| `invocation`          | `<primitive-slug>`     | ICD under the **In Progress Invocations** tier. The in-progress act of enabling a primitive per atlas A.2.2.1.4 — distinct from an Instance. Same param shape and same entity id derivation as `instance`; the only difference is lifecycle stage. `meta.status = "InProgress"`. |

**Halo Agents** are mentioned in `A.6.1.1.5.1` as a future category but have no structural pattern yet — do not classify.

**Key principle:** Key on doc_no position first, then title shape. Never on names alone — agent names change.

**Registry docs are anchored by UUID, never by doc_no constant.** The 2026 A.1 renumbering (A.1.5→A.1.6 Aligned Delegates, A.1.8→A.1.9 ERG) silently zeroed out `aligned_delegate_for`, `ranked_delegate_for`, and `erg_member_for` for months because `graph-patterns.mjs` held doc_no string constants. Those are now UUID constants (`ALIGNED_DELEGATES_UUID`, `ERG_MEMBERSHIP_UUID`, `RANKED_DELEGATE_UUIDS`, `SPELL_TEAM_UUID`); source citations derive the doc_no at runtime via `doc.doc_no`. Any new pattern that pins a specific document MUST follow this rule, and SHOULD warn to console when the UUID is not found.

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

Every Prime Agent emits `prime_agent_for`: `entity(prime) → entity(Sky Core)`, source: `[A.6.1.1.X]`.

**Editorial:** the atlas phrasing is "Prime Agent for the Sky Ecosystem". We collapse the target onto `sky-core` rather than creating a separate `sky-ecosystem` entity — see Editorial Decisions.

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

**ICD directory positions vary** — ICDs can be under Active (`.Z.2.N`), Completed (`.Z.3.N`), or In-Progress (`.Z.4.N`). Never assume Active Instances is the only position. **Allocation System inserts a `Multi-Instance Coordinator Document` at `.Z.2`**, shifting Active Instances to `.Z.3` and Completed to `.Z.4` — one more reason to walk by title rather than by tier index.

**All extraction uses doc_no arithmetic, not parentId** (depth cap makes parentId unreliable for docs deeper than 6 segments).

**Primitive-root resolver (shared helper).** A previous convention (`ancestorByStripping(d, 2)`) landed 77 Allocation System edges on directory intermediaries like "Ethereum Mainnet Instances" because ICDs there sit several levels below the Primitive root. Use this instead:

```javascript
// Locates the real Primitive root for any per-agent ICD.
// Primitive roots always live at A.6.1.1.X.2.G.P — agent X, Sky Primitives
// section (.2), primitive group (.G), primitive (.P).
function primitiveRootFor(doc) {
  const m = doc.doc_no.match(/^(A\.6\.1\.1\.\d+\.2\.\d+\.\d+)(?:$|\.)/);
  if (!m) return null;
  const root = docByDocNo.get(m[1]);
  return root && /Primitive$/i.test(root.title) ? root : null;
}
```

`scripts/lib/graph-patterns.mjs:126`. Must be used everywhere that previously called `ancestorByStripping(d, 2)` to reach a primitive root.

**Extraction rules:**

- `implements`: The primitive root always opens with `"... See [Global Name](uuid)."` — match the literal `"See [text](uuid)"` pattern where the target is under `A.2.2`. Only for `A.6.1.1.*` docs. Do not derive from `cites` edges (too broad).
- `instance_of`: Instance ICD → primitive root via `primitiveRootFor(icd)`. Only for `A.6.1.1.*` ICDs under the Active/Suspended/Completed Instances tier. Edge meta carries `{status: "Active"|"Suspended"|"Completed"}` for in-scope primitives (see Pattern 14).
- `invocation_of`: Invocation ICD → primitive root. Mirror of `instance_of` but for the In Progress Invocations tier. Edge meta carries `{status: "InProgress"}`. Per atlas A.2.2.1.3 / A.2.2.1.4 Instances and Invocations are distinct concepts; the edge split lets consumers filter operational vs in-progress without inspecting meta.
- `located_at`: ICD Location doc always contains a UUID link to the actual ICD in its content. Extract UUID from content — do not guess from doc_no (directory position varies). **A handful of ICD Location docs in the atlas are misnamed** (title lacks the "Location" suffix, reading just "X Instance Configuration Document" instead of "X Instance Configuration Document Location"). Detect by content too, not title alone:
  ```javascript
  const isICDLocation = (d) =>
    /instance configuration document location/i.test(d.title) ||
    /^\s*This Instance['’]s associated Instance Configuration Document is located at/i.test(
      d.content ?? "",
    );
  ```
  `scripts/lib/graph-patterns.mjs:26`. Without the content fallback, misnamed Location docs get emitted as duplicate ICD entities that overwrite the real ones.
- `has_status`: Global Activation Status is at `{primRoot}.1.1`. Only for `A.6.1.1.*` docs.

### Pattern 3: Executor Agent role assignment (Prime → Executor)

Within an Executor Accord active instance:

```
A.6.1.1.X.2.Z.2.N.1.1.1    Operational/Core Executor Agent
```

This doc's content cites `A.6.1.2.Y` via a UUID link — authoritative link from Prime to Executor.

Emit a **role-specific** edge in the **executor → prime** direction (Atlas framing: "Ozone's work in supporting the Agents that it serves **as the Operational Executor Agent for**", A.2.8.2.9.2.1.2):

- `operational_executor_agent_for`: if the target executor is `agent/operational_executor`
- `core_executor_agent_for`: if the target executor is `agent/core_executor`

Sources: `[A.6.1.1.X.2.Z.2.N.1.1.1, A.2.8.2.N]` (ICD parameter doc + matching Ecosystem Accord).

Executors may serve multiple Primes — emit one edge per ICD parameter doc.

### Pattern 4: Ecosystem Accords

Every child of `A.2.8.2` is an active accord. Title format `"Ecosystem Accord N: {Party} And {Party}"` for bilateral; descriptive name for multi-party (e.g. `A.2.8.2.2 "Prime Program"` = Sky + Spark + Grove + Moonbow). Parse parties from the party-details docs — do not assume bilateral from title.

- `ecosystem_accord`: `doc(A.2.8.2.N) → entity(each_party)`, source: `[A.2.8.2.N]`. Target is the **composite_party** entity (e.g. "Spark"), not its members — members are surfaced via `comprises` (Pattern 12).

The "Sky" party always comprises "Sky Core" verbatim in all 8 accords.

### Pattern 5: Facilitator / GovOps assignment

**Operational Executor Agents** (full prefix):

- `"The Operational Facilitator for {Executor} is {Name}."`
- `"Operational GovOps for {Executor} is {Name}."`

**Core Council Executor Agents** (no prefix — make regex optional):

- `"The Facilitator for {Executor} is {Name}."`
- `"GovOps for {Executor} is {Name}."`

Emit one of four **role-specific** edges (entity → agent(executor)):

| Source doc                  | Edge                          |
| --------------------------- | ----------------------------- |
| `A.6.1.2.Y.1` (Operational) | `operational_facilitator_for` |
| `A.6.1.2.Y.1` (Core)        | `core_facilitator_for`        |
| `A.6.1.2.Y.2` (Operational) | `operational_govops_for`      |
| `A.6.1.2.Y.2` (Core)        | `core_govops_for`             |

Source: `[A.6.1.2.Y.1]` or `[A.6.1.2.Y.2]`. Entity gets `entity_type = facilitator_org` or `govops_org` respectively.

### Pattern 6: Active Data

Every `type = "Active Data Controller"` contains:

- `"The Responsible Party is {Entity Name}."` → `responsible_party_for` edge
- Active Data docs at `*.0.6.X`

- `responsible_party_for`: `entity → doc(controller)`, source: the controller doc
- `active_data_for`: `doc(*.0.6.X) → doc(controller)`, structural from doc_no suffix

### Pattern 7: ERG membership

Source: `ERG_MEMBERSHIP_UUID` (`e9807449-fdc3-4860-8d53-c56181311618`; doc_no `A.1.9.1.2.2.0.6.1` after the A.1.8→A.1.9 renumber — UUID-anchored for exactly that reason). Members are plain-text list items with no UUID — create synthetic entities.

- `erg_member_for`: `entity(member) → doc(ERG membership doc)`, source: `[derived doc_no]`

### Pattern 8: UUID citation links

Every `[text](uuid)` markdown link → `cites` edge, source: `[source_doc_no]`

### Pattern 9: Supporting doc suffixes

| Suffix    | Type               | Edge                                  |
| --------- | ------------------ | ------------------------------------- |
| `*.0.3.X` | Annotation         | `annotates` → parent                  |
| `*.0.4.X` | Action Tenet       | `annotates` → parent                  |
| `*.0.6.X` | Active Data        | `active_data_for` → parent controller |
| `*.varX`  | Scenario Variation | `annotates` → parent                  |

### Pattern 10: Aligned + Ranked Delegates

All delegates are "Aligned Delegates" relative to Sky Governance. A subset are "Ranked Delegates" with a budget level.

**Aligned Delegates registry:** `ALIGNED_DELEGATES_UUID` (`5f584db8-…` — the same Current Aligned Delegates Active Data doc that Pattern 16 Table 1 parses; doc_no `A.1.6.1.5.0.6.1` after the A.1.5→A.1.6 renumber). The doc is a **table** today, so `aligned_delegate_for` edges are emitted from the table rows in Phase 2.7; the prose-list path here is a fallback.

- `aligned_delegate_for`: `entity(delegate) → entity(Sky Governance)`, source: `[derived doc_no]`

Each delegate entity has `entity_type = delegate_org`.

**Ranked Delegates** (subset with budget). UUID-anchored via `RANKED_DELEGATE_UUIDS`:

| level | UUID       | doc_no (current)  | Content (verified)                                    |
| ----- | ---------- | ----------------- | ------------------------------------------------------ |
| 1     | `46c0f334` | `A.1.6.4.1.1.3.1` | "The current Level 1 Ranked Delegates are BLUE and Cloaky." |
| 2     | `ebe4da3b` | `A.1.6.4.1.2.3.1` | "The current Level 2 Ranked Delegate is Bonapublica."  |
| 3     | —          | —                 | **No current-members doc.** L3 is defined by criteria (greatest delegated Voting Power not in L1/L2), not an enumeration. |

Content shape varies by count — L1 plural (`Delegates are X and Y`), L2 singular (`Delegate is X`). Regex must accept both:

```
/Ranked Delegates?\s+(?:are|is)\s+([^.]+)\./i
```

Split the name list on `,\s*|\s+and\s+`. For each name:

- Emit `ranked_delegate_for`: `entity → entity(Sky Governance)`, `meta.level = L`, source: `[derived doc_no]`.

Ranked delegate status is layered on top of Aligned Delegate status — if the entity also has `aligned_delegate_for`, keep both edges. Do not subtype the entity; the ranking is purely an edge property.

### Pattern 11: Role bindings (`holds_role_for`)

Ad-hoc role assignments where a named entity holds a specific atlas-defined role. Each role has a "Designated [Role Name]" doc whose content contains `"role is held by [Name]"`.

**Structure** (under `A.1.7.1.*`):

```
A.1.7.1.X       {Role Name}                   ← role definition
A.1.7.1.X.1     {Role Name} Requirements
A.1.7.1.X.2     Designated {Role Name}        ← binding doc; contains "role is held by [Name]."
```

**Detection** (UUID-anchored — no title scanning): start from `ACTIVE_ECOSYSTEM_ACTORS_UUID` (`1ef5767b-60bc-446a-af45-4eccdb20c023`). Each direct child of that section is a role definition doc (`A.1.7.1.X`); its `.2` child is the binding doc. Check binding doc content for `/role is held by\s+([^.]+)\./i`. For each match:

- Holder name = capture group, trimmed
- Role slug = role definition doc title `.toLowerCase().replace(/\s+/g, "_")` (e.g. `"Core Council Risk Advisor"` → `core_council_risk_advisor`)
- Structural check: `CCRA_BINDING_UUID` (`51b1fe46-2251-4078-a805-e2b40aaaf729`) must be found in the walk — warns if the section has restructured

Currently known bindings (discovered by the walk, not hardcoded):

| binding doc UUID | binding doc_no | Role slug                           | Holder |
| ---------------- | -------------- | ----------------------------------- | ------ |
| `51b1fe46` (pinned) | `A.1.7.1.1.2` | `core_council_risk_advisor`      | BA Labs |
| `57fa2bd5` (PR #227) | `A.1.7.1.2.2` | `protocol_security_workstream_lead` | Vamsi |

New roles added under `A.1.7.1` are picked up automatically — no code changes needed.

Emit for each binding doc found:

- `holds_role_for`: `entity(holder) → doc(binding_doc)`, `meta.role = "<role_slug>"`, source: `[binding_doc_no]`

Destination is the binding doc because the atlas does not give the role a distinct entity target. The `roleBindingTitles` set (used to suppress duplicate ecosystem_actor creation in Pattern 6) is populated from the same UUID-anchored walk — role definition titles (e.g. `"core council risk advisor"`) are added directly.

### Pattern 12: Composite accord parties

Source: `A.2.8.2.Y.1.1` ("Parties To The Accord"). Each party has a details subdoc at `A.2.8.2.Y.1.1.N` with content shaped like:

> `"The party 'NAME' comprises X, Y, and Z."`

**Both the composite and its members are entities.** Users directed: "we definitely want A [composite as entity] but we might also need B [members as entities] — both."

**Examples from the atlas:**

- `A.2.8.2.2.1.1.2` — "The party 'Spark' comprises the Spark Prime Agent, Spark Foundation, and Phoenix Labs."
- `A.2.8.2.2.1.1.3` — "The party 'Grove' comprises the Grove Prime Agent, and Grove Foundation."
- `A.2.8.2.3.1.1.2` — "The party 'Keel' comprises the Keel Prime Agent, Keel Foundation, and Elodin."
- `A.2.8.2.4.1.1.2` — "The party 'Obex' comprises the Obex Prime Agent, Rubicon, and Treadstone."
- `A.2.8.2.6.1.1.2` — "The party 'Launch Agent 6' comprises the Launch Agent 6 Prime Agent, Launch Agent 6 Foundation, and Stablewatch."
- `A.2.8.2.7.1.1.2` — "The party 'Skybase' comprises the Skybase Prime Agent, Skybase Foundation, and Development Company."
- `A.2.8.2.8.1.1.2` — "The party 'Amatsu' comprises the Amatsu Executor Agent." (single-member composite)
- `A.2.8.2.9.1.1.2` — "The party 'Ozone' comprises the Ozone Executor Agent." (single-member composite)
- `A.2.8.2.N.1.1.1` — always "The party 'Sky' comprises Sky Core."

**Atomic parties (no `comprises` phrase).** A handful of party-details docs describe parties that do not decompose further, using a different sentence shape:

> `"The party 'NAME' is <descriptor>."`

Known case: `A.2.8.2.2.1.1.4` — "The party 'Moonbow' is the entity owning relevant intellectual property." Moonbow has no members — it is a single atomic party within the Prime Program accord.

Extractor must match a fallback regex after the `comprises` regex fails:

```js
const COMPRISES_RE = /The party ['‘]([^'’]+)['’] comprises\s+(.+?)\./i;
const ATOMIC_PARTY_RE = /The party ['‘]([^'’]+)['’]\s+is\b/i;
```

Atomic parties are modelled as `composite_party` entities with **zero** `comprises` edges. This keeps the `ecosystem_accord` edge shape uniform (accord → composite_party) regardless of whether the party decomposes. See Editorial Decisions.

**Extraction:**

1. For each doc_no matching `A.2.8.2.\d+.1.1.\d+`, match `/The party ['‘]([^'’]+)['’] comprises\s+(.+?)\./i`. Handles both ASCII `'` and typographic `‘’` quotes.
2. Create/reuse a `composite_party` entity for the party name (e.g. `Spark`). Distinct slug from member entities (`spark` vs `spark-prime-agent`).
3. Parse the member list: split on `,\s*` then on `\s+and\s+`. Strip leading articles (`the\s+`).
4. Resolve each member to an existing entity first (Spark Prime Agent → via defining_doc_id from A.6.1.1.1; Sky Core → bootstrap). For unresolved members, type by shape:
   - Title ends in `"Foundation"` → `foundation`
   - Known dev-co pattern (Phoenix Labs, Elodin, Treadstone, Stablewatch, Rubicon, "Development Company") → `development_company`
   - Title ends in `"Executor Agent"` and matches an existing agent → reuse that agent entity
   - Otherwise → `ecosystem_actor`
5. Emit `comprises`: `composite_party → member entity`, source: `[A.2.8.2.Y.1.1.N]`, one edge per member.
6. The `ecosystem_accord` edge (Pattern 4) points to the **composite** entity, not individual members. Members are reached via `comprises`.

The single-member case (Ozone, Amatsu) is still modelled as a composite_party entity with one `comprises` edge — this keeps the edge shape uniform across accords and lets the UI render any party consistently.

### Pattern 13: Bootstrap entities (Sky Core / Sky Governance)

These atlas concepts are targets of role edges but have no single defining doc to key on. Bootstrap them by name with stable slugs:

| Slug             | Name           | entity_type         | Target of                                                                               |
| ---------------- | -------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `sky-core`       | Sky Core       | `operational_party` | `prime_agent_for`, `ecosystem_accord`, `comprises` (inbound from "Sky" composite party) |
| `sky-governance` | Sky Governance | `governance_body`   | `aligned_delegate_for`, `ranked_delegate_for`                                           |

These are the only hardcoded entities. Everything else is pattern-derived from atlas docs. Bootstraps have no `defining_doc_id`.

**`sky-ecosystem` is intentionally not a bootstrap.** See Editorial Decisions for rationale.

**Sky Frontier Foundation** and **Sky Fortification Foundation** are NOT bootstraps — they have defining grant docs under `A.2.13.1` and surface through ordinary `foundation` extraction (grants recipients list + address labels).

### Pattern 14: Primitive Instance entities

Every ICD under an allowlisted primitive becomes an `et="instance"` entity. Entity id == ICD doc UUID, `st` = primitive slug, `did` = ICD UUID, meta carries `{primitive_doc_no, agent_doc_no, status, params}`.

**Scope allowlist** (`scripts/lib/graph-instances.mjs:8`). Add here when a new primitive should get instance entities:

```javascript
const INSTANCE_SCOPED_PRIMITIVES = {
  "Distribution Reward Primitive": "distribution-reward",
  "Integration Boost Primitive": "integration-boost",
  "Allocation System Primitive": "allocation-system",
  "Pioneer Chain Primitive": "pioneer-chain",
  "Core Governance Reward Primitive": "core-governance-reward",
  "Agent Creation Primitive": "agent-creation",
  "Prime Transformation Primitive": "prime-transformation",
  "Agent Token Primitive": "agent-token",
  "Executor Accord Primitive": "executor-accord",
  "Root Edit Primitive": "root-edit",
  "Distribution Requirement Primitive": "distribution-requirement",
  "Upkeep Rebate Primitive": "upkeep-rebate",
  "Ecosystem Upkeep Fee Primitive": "ecosystem-upkeep-fee",
};
```

**Instance display name for "Single" ICDs.** Some ICDs are titled `"Single Instance Configuration Document"` — stripping "Instance Configuration Document" yields the useless name `"Single"`. For these, extract the display name from `primRoot.content` instead: match `/for (.+?)\. See/i` to get the full actor-scoped phrase (e.g. `"Spark's Instance of the Agent Token Primitive"`). Normalize `instance`/`instances` → `Instance` to paper over atlas casing inconsistencies. Implemented in `scripts/lib/graph-entities.mjs`.

**Kind + status derivation.** Each ICD resolves to either an Instance (`entity_type=instance`, status Active/Suspended/Completed) or an Invocation (`entity_type=invocation`, status InProgress). `{status}` lives on both the entity meta and the corresponding `instance_of`/`invocation_of` edge meta. Derive by **reading the tier doc's title**, not its position — Allocation System inserts a Multi-Instance Coordinator Document that shifts every tier down by one. Walk up the ancestor chain (`classifyIcd` in `graph-instances.mjs`) since tier docs sit at variable depth (flat `.2`/`.3` layouts vs nested `.1.5.1.2` Suspended):

```javascript
export function classifyIcd(icd, primRoot, docByDocNo) {
  let cur = icd;
  while (cur && cur.doc_no.startsWith(`${primRoot.doc_no}.`)) {
    const title = cur.title.toLowerCase();
    if (title.startsWith("active instances"))      return { kind: "instance",   status: "Active" };
    if (title.startsWith("completed instances"))   return { kind: "instance",   status: "Completed" };
    if (title.startsWith("suspended instances"))   return { kind: "instance",   status: "Suspended" };
    if (title.startsWith("in progress invocations")) return { kind: "invocation", status: "InProgress" };
    const lastDot = cur.doc_no.lastIndexOf(".");
    if (lastDot < 0) break;
    cur = docByDocNo.get(cur.doc_no.slice(0, lastDot));
  }
  return { kind: null, status: null };
}
```

`scripts/lib/graph-instances.mjs`.

**Walk by title, not by doc_no position.** The ICD sub-structure is inconsistent across primitives:

| Primitive                           | ICD.1                               | ICD.2                            | Reward Code location            |
| ----------------------------------- | ----------------------------------- | -------------------------------- | ------------------------------- |
| DR/IB/Agent Token (Active instance) | `Parameters`                        | `Operational Process Definition` | `ICD.1.1`                       |
| DR/IB (In-progress invocation)      | `Invocation Status`                 | `Parameters`                     | `ICD.2.1`                       |
| Allocation System                   | `RRC Framework Full Implementation` | `Parameters`                     | deeper under `ICD.2.{subdir}.N` |

Walk children of the ICD until you find `title === "Parameters"`, then walk that subtree. Never assume `ICD.1 = Parameters`.

**Params extraction** (`scripts/lib/graph-instances.mjs:130`, `extractInstanceParams`). BFS from the Parameters doc; each leaf becomes a key/value pair in `meta.params`. Leaf = doc with no children, content not matching `DIRECTORY_RE = /^The documents? herein (define|contain|organize|govern|specify|describe|set|compose|hold)\b/i`. On title collision (e.g. Pioneer Chain has two `Network` leaves), disambiguate with `"{parentTitle} / {leafTitle}"`. The `Custom Instance Parameters` subtree is skipped at every level — it's a reserved extension slot that's empty in practice.

**Params shape: tuple `[value, srcUuid, srcDocNo]`.** Each param key maps to a 3-tuple, not a bare string:

```json
"params": {
  "Reward Code": ["128", "1e5d71a8-…", "A.6.1.1.1.2.5.1.2.1.1.1"],
  "Integration Partner Reward Address": ["0xac140648…", "5b5f88ff-…", "A.6.1.1.1.2.5.2.2.1.1.2"]
}
```

The source UUID is the leaf doc's id; `docs[uuid].content` is always the raw pre-formatted content. Consumers get display strings + navigation targets without re-walking the tree at render time.

**Per-key formatters** (`scripts/lib/graph-instances.mjs:70`, `PARAM_FORMATTERS`). Each well-known leaf title has a registered formatter that turns raw prose into the value slot. Unknown keys fall through to `unwrapBackticks + trim`. Current registry keys:

```
Reward Code / Integration Partner Name / Integration Partner Reward Address /
Integration Partner Chain / Integration Boost Cadence / Token Name /
Token Symbol / Genesis Supply / Token Address / Underlying Asset Address /
Allocator Role Address / Pool Address / Address / Network / Target Protocol /
Token / Asset Supplied By Spark Liquidity Layer
```

**Regex-keyed fallback** (`scripts/lib/graph-instances.mjs:71`, `RATE_LIMIT_ID_RE`). After the exact-match registry, `formatParam` checks a regex. Titles matching `/^(Inflow|Outflow|Swap) Rate ?Limit ?ID/i` (9 variants including token qualifiers like `(AUSD)`, `(USDC)`, and both spaced and unspaced forms) are dispatched to `extractRateLimitId`, which:
- Extracts the backtick-wrapped 64-char hex hash → bare `0x…` string
- Preserves `N/A` and `N/A - swap only` for conduits where the direction is unused
- Falls through to `unwrapBt` for any other content (e.g. placeholder prose)

Content pattern: `"The inflow RateLimitID is: \`0x{64hex}\`."` (also handles newline before backtick). 77 param entries across ~40 Allocation System instances use this path today.

**Per-key expanders** (`scripts/lib/graph-instances.mjs:98`, `PARAM_EXPANDERS`). When a single leaf packs multiple values into prose, a registered expander returns `Array<[key, value]>` and each tuple becomes its own param entry (sharing the source doc). The expander runs before the formatter; returning `null` falls through to the regular formatter path. Currently one entry:

- `Token Address` (Agent Token only). Pattern:
  _"The address of SPK on the Ethereum Mainnet is `0x…`. The address of SPK on Base is `0x…`."_
  Expands to `Token Address (Ethereum Mainnet)` + `Token Address (Base)` tuples — one per chain clause. When the content doesn't match (e.g. Allocation System's single backtick-wrapped address, or unset Agent Token prose like _"The address of KEEL will be specified in a future iteration"_), the expander returns `null` and the regular formatter runs — preserving the single-`Token Address`-key behaviour for those consumers.

**Generic bullet-list expansion** (`scripts/lib/graph-instances.mjs:117`, `expandBulletList`). Runs AFTER per-title expanders as a fallback. Matches the atlas convention used for rate limits and similar parameter groupings:

```
The {variant} rate limits are:

- `maxAmount`: 200,000,000 USDS
- `slope`: 400,000,000 USDS per day
```

Any leaf whose content contains `- \`key\`: value`bullets is expanded into`{leafTitle} / {bulletKey}`sub-keys. Produces 343 rate-limit sub-keys today across 95 Allocation System instances (Inflow / Outflow / Deposit / Withdrawal / Swap rate limits, each with`maxAmount`/`slope`/`maxSlippage`). Consumers get direct field lookup instead of regex-parsing prose.

Regex: `/^\s*[-*]\s+\`([^\`\n]+)\`\s*:\s*(.+?)\s*$/gm`. Single-bullet leaves still expand — the backtick-key + colon shape is distinctive enough that false positives haven't appeared in the atlas today. If a future doc uses casual backtick-bullet prose that shouldn't be expanded, add an intro-anchor gate (e.g. require `/\bare\s*:\s\*\n/` preceding the bullets).

**Known key variations** — the atlas doesn't always use the same title for structurally similar params. Record normalisation is a consumer problem, not an extractor one:

- `Token Address` vs `Token Address (ERC4626 Vault)` — Allocation System ICDs suffix vault type
- `Token Address` vs `Pool Address` vs `Underlying Asset Address` — Allocation System uses whichever matches the protocol shape
- `Token Address` vs `Token Address (<Chain>)` — Agent Token's per-chain expansion. Agents with deployed tokens get one chain-qualified key per chain; agents whose token is unannounced still emit a single `Token Address` key carrying the placeholder prose.

### Pattern 15: `invoked_by` — instance → agent affiliation

Every in-scope Instance entity emits an entity→entity `invoked_by` edge to its Prime Agent. Purpose: the `/constellations` graph clusters Instances under their owning agent instead of leaving them as 170+ floating nodes.

- `invoked_by`: `entity(instance) → entity(agent/prime)`, source: `[ICD doc_no]`, meta mirrors the `instance_of` status payload
- Resolver: match the ICD doc_no against `/^(A\.6\.1\.1\.\d+)/` to locate the prime agent doc, then its entity via `entityByDocId`
- `scripts/lib/graph-doc-edges.mjs:98`

### Pattern 16: Active Data table entity extraction (Phase 2.7)

Three Active Data nodes contain structured registry tables whose rows become named entities. Parsed by `scripts/lib/table-parser.mjs` and processed in Phase 2.7 of `build-graph.mjs` (runs after Phase 2.5, before Phase 3).

**Target nodes — keyed by UUID, never by doc_no:**

| UUID | Title | `entity_type` | `is_active` |
|------|-------|---------------|-------------|
| `5f584db8-f8d8-4118-988c-b2bc3f68ceb7` | Current Aligned Delegates | `delegate_org` | 1 |
| `e7aec672-ed19-4329-aaf7-736950be2eb7` | Derecognized Alignment Conservers | `delegate_org` | 0 |
| `d9c6ed16-5b0d-4a6f-bb43-387398090afc` | SRC Membership Registry List | `src_member` | 1 |

**Column → field mapping:**

*Current Aligned Delegates (`5f584db8`):*
- `Delegate Name` → entity `name`
- `EA Address` → first `0x…` in cell → `has_address` edge, `meta.role = "ea_address"`
- `Delegation Contract` → first `0x…` in cell → `has_address` edge, `meta.role = "delegation_contract"`
- `Forum Post` → first URL in cell → entity `meta.forum_url`

*Derecognized Alignment Conservers (`e7aec672`):*
- `Identity` → entity `name`
- `Date` → entity `meta.derecognition_date` (YYYY-MM-DD)
- `Reasoning Post` → first URL in cell → entity `meta.forum_url`
- No addresses; no `has_address` edges emitted.

*SRC Membership Registry (`d9c6ed16`):*
- `Name or Alias` → entity `name`
- `Domain Expertise` → entity `meta.domain_expertise`
- `Verified Governance Address` → `has_address` edge, `meta.role = "governance"` — **skipped when cell value is `"N/A"`**
- `Start Date` → entity `meta.start_date`
- `Term Status` → entity `meta.term_status`
- `Standing` → entity `meta.standing`

**`listed_in` edges:** every table entity emits `listed_in` → the Active Data doc UUID. This is a structural `entity → doc` edge — it records table membership, not primitive instantiation. Do **not** use `instance_of` here; that type is reserved for ICD doc → Primitive root (Patterns 2 and 14). `listed_in` is exempt from the auditable-edge `source_doc_nos` requirement (derived from table structure, not from prose attribution).

**Identity lookup for existing entities:** entities are matched by EA address via the `has_address` edges built in Phase 2u, **not by slug**. Slug matching is fragile when the label in `addressesRaw` differs from the table's Delegate Name column.

**`ecosystem_actor → delegate_org` upgrade rule:** if an entity already exists as `ecosystem_actor` (e.g. from the ERG list, Pattern 7) and its EA address appears in the Current Aligned Delegates table, its `entity_type` is upgraded to `delegate_org` in place. The delegates table is the authoritative governance record; ERG membership is incidental.

**Table parser utilities (`scripts/lib/table-parser.mjs`):**
- `parseMarkdownTable(content)` — splits on `|`, skips separator rows (cells of only `-`, `:`, spaces), returns `Array<Record<columnHeader, cellText>>`
- `extractEthAddresses(cell)` — returns all lowercase `0x[0-9a-f]{40}` addresses from a cell (handles Etherscan URL format and bare addresses)
- `extractUrl(cell)` — returns the first `(https://…)` URL from a markdown link in the cell

These utilities are reusable for any future Active Data table added to Phase 2.7.

**Table 4 — Current Authorized Forum Accounts (`b71564fd-22e0-4c69-99d1-5b23fc1fa329`, `A.2.7.1.1.1.1.4.0.6.1`):**
- Columns: `Entity Name` | `Role` | `Entity Handle` | `Handles of Authorized Representatives`
- Row entity resolved via `normalizeKey` name index ("Redline" → Redline Facilitation Group); created as `ecosystem_actor` if unknown (e.g. Rune). Gets `meta.forum_handle` + `meta.forum_role` and a `listed_in` edge with `{handle, role}` meta.
- Each rep handle (parentheticals like "(and their authorized representatives)" stripped; split on commas) resolves via the same index — org handles like "SoterLabs" / "Endgame-Edge" reuse the org entity; unknown handles become `ecosystem_actor` `st="individual"` (Le_Bateleur, redlexic, ldr, votewizard, …). Emits `authorized_rep_for`: `entity(rep) → entity(org)` (table-derived, no source_doc_nos).
- This table is the atlas's primary source for **named individuals**.

**Table 5 — Aligned Delegate Breach Registry (`1ddd9cf6-3f93-4a33-8c1d-80405eec1ffb`, `A.1.6.6.1.3.0.6.1`):**
- Columns: `Date` | `Identity` | `Breach Tier` | `Reasoning Post`
- Each row emits `listed_in` → the registry doc with `{date, breach_tier, reasoning_url}` meta on the delegate entity (resolved via `normalizeKey`; created as `delegate_org` if missing). Dated governance events, one edge per breach.

**`aligned_delegate_for` emission moved here:** the Current Aligned Delegates doc is a table (no longer a prose list), so Phase 2.7 Table 1 also emits `aligned_delegate_for`: `entity(delegate) → entity(Sky Governance)` per row, source `[registry doc_no]`. The Phase 2 prose path (Pattern 10) remains as a fallback should the atlas revert to a list.

**Drift detector:** after table extraction, every `type="Active Data"` doc with ≥1 non-empty table row that is neither extracted (`HANDLED_TABLE_UUIDS`) nor deliberately ignored (`KNOWN_UNEXTRACTED_TABLES` — currently only Registered Spell Checklists `93f5b36b`, external URLs) produces a loud `[drift]` warning. This is the tripwire for the **29 per-instance payment-ledger Active Data stubs** ("List Of Integration Boost Payments" etc. — all empty today) and the empty Registered Multisigs registry (`7d966e5e`): the moment the atlas populates one, the build says so.

### Pattern 17: Multisigs (`scripts/lib/graph-multisigs.mjs`, Phase 2.8)

Every multisig in the atlas is a parent doc with a regular set of child Cores, matched by **title suffix** (prefixes vary; some roots aren't even titled "…Multisig" — "Core Council Buffer", "Multisig Freeze Of SparkLend"):

```
{root}            multisig root (entity id = this doc's UUID)
{root}.N  …Address                        "The address of the X on {Chain} is `0x…`."
{root}.N  …(Required )Number Of Signers   "The X (currently )has a M/N signing requirement."  ← 27/27 uniform
{root}.N  …(Current )Signers              three shapes, below
{root}.N  …Usage Standards                purpose prose → meta.purpose_doc_no
{root}.N  …(Signer )Modification(s)       "{Parties} can change the signers …"
```

- **Detection:** group candidate children by parent doc_no; a parent with both a threshold doc and a signers doc is a multisig root. Do not key on the root title.
- **Display name** = subject of the threshold sentence (uniform), agent-prefixed for `A.6.1.1.X` subtree roots ("Keel Freezer Multisig"). Collisions: chain suffix when the colliding pair is on different chains ("… (Solana)"), else scope-title suffix ("Operator Multisig (The Protocol Scope)").
- **Signer shapes** (`parseSignerGroups`): (a) `"N (N) address(es) controlled by {Party}"` runs — the dominant shape; (b) bullet `"- {Party}: N signers"`; (c) plain bullet roster after `"has the following signers"` (each = 1 signer, may be individuals like VoteWizard/LDR).
- **Party resolution:** bare role references ("the Core Facilitator", "Core GovOps") resolve to the current holder via role edges and stamp `meta.via_role` — so signer edges follow the holder on rebuild. Prefixed names ("Operational GovOps Soter Labs") strip the role prefix. Unknown names create `ecosystem_actor` (or `foundation` by name suffix): Osero (note: also a Prime Agent name — resolves to the agent), Spark Assets Foundation, VoteWizard.
- **Edges:** `signer_of` (`meta.signer_count`), `can_modify_signers_of` (skipped when the Modification subject is "The signers" — self-referential — or a governance-process sentence), `has_address`, `defines_entity`. Prose-derived edges carry `source_doc_nos`.
- **Never-silent:** detected roots whose threshold/address/signers don't parse emit per-doc warnings; stats line reports roots/edges/warnings.
- ~28 multisigs today: 4 SkyLink Freezers (A.1.10.4.1.\*), SparkLend Security Access, Demand Side Buffer (A.2.2.4.3), Core Council + Aligned Delegates Buffers (A.2.3.1.2.2.2.\*), 2 Operator Multisigs (A.3/A.4), Skybase USDS Demand Subsidies, per-agent Relayer/Freezer multisigs (A.6.1.1.{1,2,3,5,6}).
- **The five-child convention is editorial, not spec-guaranteed** — robustness comes from the warnings, not from assuming stability.

### Pattern 18: Transfer/grant events (`scripts/lib/graph-transfers.mjs`, Phase 2.8)

Three shapes become `funds_transfer` edges (`entity(sender) → entity(recipient)`, meta `{kind, status, amounts, tx_hash?, period?, period_months?, begin_date?, recipient_address?}`):

- **A. Grants (`A.2.13.1.X.Y`, `isGrantDoc`):** structured bullets — Recipient / Recipient Address / Transaction Hash / per-token `{TOKEN} amount:` lines. Sender = `sky-core`. `kind="grant"`, status `disbursed`/`approved`.
- **B. Genesis distributions:** docs titled `Minting Of Tokens…` / `Transfer Of Tokens…` under agent artifacts. Mint sentence → `kind="genesis_mint"` (agent → account holder). Transfer sentence `"X transferred 6.5 billion SPK tokens … to the Sky Pause Proxy"` → `kind="genesis"`; "will transfer" → `status="planned"`. **Strip markdown links before matching** — citation link text carries doc_no dots that break sentence-boundary `[^.]` classes. Party aliases: "Sky Pause Proxy"/"Sky" → `sky-core`; `"X SubProxy( Account)?"` → agent X.
- **C. Accord grant authorizations:** docs titled `…Grant Authorization…` (directory docs starting "The documents herein" skipped). `"grant of {N} USDS per month to the {Recipient} from {Sender}'s Prime Treasury for a three (3) month period"`. `kind="authorization"`; `meta.period` from the title suffix ("December 2025"), `begin_date` from a separate "beginning on …" match. Multi-grant docs only capture the first grant (known limitation).
- `funds_transfer` is **graph.json-only** (filtered from `relations.json`) — event data for the chatbot/MCP, not the canvas.

### Pattern 19: Integration partners (Phase 2.8, from Phase 2.5 params)

Every `Integration Partner Name` param value on an integration-boost instance/invocation becomes an `ecosystem_actor` `st="integration_partner"` (reusing an existing entity when the slug matches) plus `integration_partner_of`: `entity(partner) → entity(instance)`, source `[param leaf doc_no]`. Answers cross-agent "all Integration Boost vendors" queries; 10 partners today (Aave, Kamino, Drift, Save, Lifinity, MarginFi, Euler, Curve, Morpho, Compound).

### Pattern 20: Spell Team + org-to-org prose

- **Spell Team** (`SPELL_TEAM_UUID = 4862ed4e-097b-42fa-a197-1d407d220a77`, "Spell Team Configuration"): `"Sky has two teams of technical contributors for Spell development, Dewiz, and Sidestream."` → each team gets `holds_role_for` → the doc with `meta.role = "spell_team_member"` (rides the Pattern 11 roleBindings mechanism).
- **Org prose** (`graph-entity-edges.mjs` 2x): two conservative shapes, edges emitted **only when both endpoints already resolve to entities** (unresolved matches are logged and skipped — recall deliberately low):
  - `"X is the Prime Foundation associated with Y."` → `prime_foundation_for`
  - `"X is a development company that provides services to the Y"` → `provides_services_to`

### Not in the atlas (verified 2026-06; do not extract — chatbot should say so)

- **Reward payout amounts/history** — 29 per-instance payment-ledger Active Data slots exist but are ALL empty. The drift detector fires when one gains rows.
- **Spell execution history** — only process docs (Crafter/Reviewer rules) + the Registered Spell Checklists table (external GitHub URLs).
- **Pioneer Chain activation dates** — instances + networks only; derive dates from `atlas_history` (when the ICD doc appeared / status flipped).
- **Individual signer addresses for multisigs** — only org-level groupings (counts per controlling entity); a build-addresses Safe-owner enrichment could backfill this on-chain, not from the atlas.
- **Org hierarchy** — no reporting lines between Sky Core / facilitators / govops anywhere; Atlas Axis / Redline / Soter Labs are parallel role-holders. The only supervisory phrasing is "Executor Agents supervise other Agents" (A.1.14.4.6).

---

## Editorial Decisions

The extractor is not a neutral reading of the atlas — it makes judgment calls where the atlas underdetermines the graph shape, where literal extraction would over-fragment the model, or where downstream consumers (UI, MCP, reports) benefit from a uniform shape. Each choice is listed here so others can scrutinize (and contest) it.

### 1. `Sky Ecosystem → Sky Core` merge for `prime_agent_for`

**Atlas phrasing:** Prime Agents "serve as Prime Agent for the Sky Ecosystem" (A.6, A.6.1.1). Sky Ecosystem is a **Scope** (a markdown region that regulates Agents), not an acting party.

**Choice:** We do not emit a `sky-ecosystem` entity. `prime_agent_for` edges target `sky-core` instead.

**Why:**

- Sky Ecosystem has no legal, operational, or governance identity of its own — every concrete action attributed to "Sky" in accords is performed by Sky Core ("The party 'Sky' comprises Sky Core" in all 8 accords).
- Emitting a separate `sky-ecosystem` entity created a second dangling hub in the entity subgraph with exactly one inbound edge kind, no outbound edges, and no usable defining doc.
- Downstream consumers always want the same answer to "who represents Sky here?" — this keeps that answer stable across `prime_agent_for`, `ecosystem_accord`, and `comprises`.

**What we lose:** the Scope-vs-party distinction is flattened in the graph. If a future consumer needs to reason about the Scope (regulatory framing) separately from the operational party, they will need to key on doc `A.6` directly rather than on an entity.

### 2. Sky party short-circuit in `comprises`

**Atlas phrasing:** every accord contains `A.2.8.2.N.1.1.1` — "The party 'Sky' comprises Sky Core."

**Choice:** The "Sky" composite party is not re-created per accord. The `ecosystem_accord` edge for the Sky side of every accord points directly to the shared `sky-core` entity, skipping a per-accord "Sky" composite.

**Why:** Sky's composite expansion is identical across all 8 accords and carries no per-accord information. Creating 8 identical `comprises` edges from 8 "Sky" composites to the same `sky-core` would inflate the edge set without adding signal.

**What we lose:** query shape asymmetry. For every other party you traverse `accord → composite_party → comprises → member`; for Sky you traverse `accord → sky-core` directly. Consumers must be aware of this.

### 3. Atomic parties modelled as `composite_party` with zero members

**Atlas phrasing:** `A.2.8.2.2.1.1.4` — "The party 'Moonbow' is the entity owning relevant intellectual property." No `comprises` phrase.

**Choice:** Moonbow is a `composite_party` entity with **zero** `comprises` edges, same entity_type as decomposing parties.

**Why:** we want a uniform `ecosystem_accord → party` edge shape. Introducing a distinct `atomic_party` entity_type would force every consumer to branch on party kind. A composite with zero members is a cheap unification.

**What we lose:** the `composite_party` name is slightly inaccurate for atomic parties — "accord_party" would read better. Left as-is to avoid churn.

### 4. Single-member parties modelled as `composite_party`

**Atlas phrasing:** `A.2.8.2.8.1.1.2` — "The party 'Amatsu' comprises the Amatsu Executor Agent." (one member).

**Choice:** Same shape as multi-member parties — `composite_party` entity with one `comprises` edge.

**Why:** uniformity across accords. The UI can render every party identically; no special casing for single-member parties.

### 5. `ecosystem_actor` as a catch-all

**Choice:** When a named actor surfaces through a pattern (ERG member, role binding, composite member with no other signal) and doesn't match any more specific entity_type, it gets `ecosystem_actor`.

**Why:** the alternative — refusing to extract or inventing ad-hoc types — either loses the relationship or fragments the taxonomy. `ecosystem_actor` is explicit about the uncertainty and lets downstream consumers group or ignore these uniformly.

**What we lose:** the type carries no semantic content. It functions as "there is a named thing here, but we don't know what it is."

**Filter:** `relations.json` (the lean browser artifact) drops all `ecosystem_actor` entities and any edges incident to them. They remain in the full `graph.json`. Most `ecosystem_actor`s have only one or two edges and produce visual clutter without advancing the Agent/Accord story.

### 6. `delegate_org` naming for individuals

**Atlas phrasing:** delegates like "BLUE", "Cloaky", "Bonapublica" are named as teams/brands/individuals — not organizations in the formal sense.

**Choice:** All delegates get `entity_type = delegate_org`, including single-person delegates.

**Why:** they act as delegates in exactly the same way regardless of legal form. A `delegate` vs `delegate_org` split would be noise — consumers care that it's a delegate, not that it's incorporated.

### 7. Dual output: `graph.json` vs `relations.json`

**Choice:** we emit two artifacts — a full `graph.json` with every entity and edge, and a lean `relations.json` that:

- drops `ecosystem_actor` entities and their edges
- drops all `parent_of` edges (structural hierarchy is recoverable from `doc_no`)
- drops entity-free doc→doc edges not needed by the entity UI

**Why:** the browser's entity-flow canvas becomes unreadable above ~150 nodes. The MCP needs the full set for graph queries.

**What we lose:** two contracts to maintain.

### 12. Table entities anchored by UUID, identity matched by address

**Context:** Pattern 16 targets three Active Data nodes by UUID. Each row in those tables becomes a named entity.

**Choice 1 — UUID anchoring, not doc_no.** Phase 2.7 hard-codes the three target node UUIDs, not their doc_nos.

**Why:** Active Data doc_nos follow a structural suffix convention (`.0.6.X`) but their prefix can change if the parent section is renumbered. PR #235 proved doc_nos are editorial labels — they changed when the atlas was renumbered. UUIDs are the stable identity for any specific document.

**Choice 2 — Address-based entity lookup, not slug.** When searching for an existing entity to enrich (rather than create), Phase 2.7 builds a reverse map from `has_address` edges (`addr → entity_id`) and looks up by EA address.

**Why:** the label in `addressesRaw` (which drives the slug via `slugify(label)`) may differ from the table's Delegate Name column in casing or punctuation. Address values are exact — they're the same on-chain fact regardless of the prose context they were extracted from.

**Choice 3 — `ecosystem_actor → delegate_org` upgrade.** If a Phase 1 pattern already created an entity with `entity_type = "ecosystem_actor"` (e.g. ERG membership, Pattern 7) and Phase 2.7 later finds that entity's EA address in the Current Aligned Delegates table, the `entity_type` is mutated to `delegate_org` in the live `entityMap`.

**Why:** the delegates table is the authoritative governance record — inclusion there means Sky Governance formally recognises this actor as an Aligned Delegate. ERG membership is a weaker signal (it just means the actor contributes risk analysis). The more specific classification wins. Mutation happens in-place so Phase 3's `entityRows` picks up the upgraded type without duplication.

**What we lose:** the ERG membership signal is not separately preserved on the entity; it survives only via the `erg_member_for` edge, which remains in the graph regardless of entity_type.

### 8. Edge `weight = 1.0` is a placeholder

**Current state:** every edge has `weight: 1.0`. No heuristic, no propagation, no calibration.

**Future:** edge weights may eventually reflect something like "strength of institutional coupling" — but this is deferred until we have a concrete consumer and a principled scoring rule. Treating weight as meaningful today would be false precision.

### 9. Instance-as-entity scope is an allowlist, not every ICD

**Atlas phrasing:** every Primitive can be invoked, and every invocation produces an ICD (A.2.2.1.3). A uniform reading would emit an `et="instance"` entity for every ICD the atlas contains.

**Choice:** all 13 primitives currently in `INSTANCE_SCOPED_PRIMITIVES` get instance entities — including `Agent Creation`, `Prime Transformation`, and `Ecosystem Upkeep Fee`. The allowlist still exists to keep the door closed on any future primitives that don't warrant entity-level representation; add a new entry only when you want its instances to appear in constellations/radar.

### 10. Instance params are `[value, srcUuid, srcDocNo]` tuples with per-key formatters

**Atlas phrasing:** ICD Parameters children encode structured configuration (`Reward Code: 128`, `Integration Partner Chain: Ethereum Mainnet`, `Token Address: 0x…`) as prose — usually one-sentence leaves like _"The partner for the Aave Integration Boost is Aave."_

**Choice:** at build time, every Parameters leaf becomes a 3-tuple on the Instance entity's `meta.params`: `[formattedValue, srcDocUuid, srcDocNo]`. A per-key formatter registry (`PARAM_FORMATTERS`) strips the prose so the value slot is the clean datum ("Aave", "Ethereum Mainnet", "0x…"). Unknown keys fall through to a backtick-unwrap + trim fallback.

**Why:**

- Consumers get display strings without re-implementing prose-stripping at render time
- Source UUID + doc_no always accompany the value, so the raw content is one navigation away (`docs[uuid].content`) if a consumer wants it
- Formatters live in one place — adding a new key means one registry entry, not per-consumer duplication
- Builds the foundation for future MCP queries: "what's the Reward Code for Spark's SparkLend instance?" is a direct lookup, no regex

**What we lose:** the value slot is destructive — the formatter has a single authoritative output. Compound prose like Agent Token's Token Address (multi-chain addresses in one blob) gets the first address only; accessing the rest requires walking the source content. Key variations (`Token Address` vs `Pool Address` vs `Token Address (ERC4626 Vault)`) are preserved as-written; consumer-side normalization is on the consumer.

### 11. Walk by title, not by doc_no position within an ICD

**Atlas phrasing:** ICD sub-structure is _not_ uniform. Active instances start with `.1 = Parameters`. In-progress invocations interpose `.1 = Invocation Status`, shifting Parameters to `.2`. Allocation System starts with `.1 = RRC Framework Full Implementation`, with Parameters at `.2` and deeper nesting (`Parameters → Instance Identifiers → Network`).

**Choice:** every ICD-descent traversal in the extractor (`extractInstanceParams`, `instanceStatusFor`, and consumer helpers like `rewardsIndex.findParamDoc`) walks by matching titles ("Parameters", "Active Instances", "Reward Code") rather than by tier index.

**Why:** tier indexing silently breaks when the atlas introduces a new sibling doc at `.1` or renumbers. The extractor from v1.5 assumed `{ICD}.1.1 = Reward Code` for DR — which was correct for active instances but missed every in-progress invocation's Reward Code because its path is `{ICD}.2.1`. Title-match is structurally stable.

**What we lose:** a handful of ms per ICD for the title match. In exchange, resilience to atlas restructures.

---

## Global Primitive Categories (A.2.2)

Derive category from the `implements` citation target's parent section:

| doc_no     | Category               |
| ---------- | ---------------------- |
| `A.2.2.4`  | Genesis                |
| `A.2.2.5`  | Operational            |
| `A.2.2.6`  | Ecosystem Upkeep       |
| `A.2.2.7`  | SkyLink                |
| `A.2.2.8`  | Demand Side Stablecoin |
| `A.2.2.9`  | Supply Side Stablecoin |
| `A.2.2.10` | Core Governance        |

---

## Edge Type Vocabulary

**Role edges** (entity → entity):

```
prime_agent_for                    entity  → entity   agent(prime)       → Sky Core  (see Editorial Decisions)
operational_executor_agent_for     entity  → entity   agent(op-exec)     → agent(prime)
core_executor_agent_for            entity  → entity   agent(core-exec)   → agent(prime)
operational_facilitator_for        entity  → entity   facilitator_org    → agent(executor)
core_facilitator_for               entity  → entity   facilitator_org    → agent(executor)
operational_govops_for             entity  → entity   govops_org         → agent(executor)
core_govops_for                    entity  → entity   govops_org         → agent(executor)
aligned_delegate_for               entity  → entity   delegate_org       → Sky Governance
ranked_delegate_for                entity  → entity   delegate_org       → Sky Governance; meta.level
```

**Composition / membership / affiliation**:

```
comprises                          entity  → entity   composite_party → member entity
erg_member_for                     entity  → doc      ERG member → ERG membership doc (ERG_MEMBERSHIP_UUID)
responsible_party_for              entity  → doc      Responsible Party → Active Data Controller
holds_role_for                     entity  → doc      Named role binding; meta.role (incl. spell_team_member, Pattern 20)
invoked_by                         entity  → entity   instance → agent(prime); meta.status
authorized_rep_for                 entity  → entity   forum rep (individual) → org (Pattern 16 Table 4); table-derived, no sources
integration_partner_of             entity  → entity   integration partner → instance (Pattern 19)
prime_foundation_for               entity  → entity   foundation → agent (Pattern 20 prose)
provides_services_to               entity  → entity   dev company → org (Pattern 20 prose)
```

**Multisigs (Pattern 17)**:

```
signer_of                          entity  → entity   signer org/individual → multisig; meta.signer_count, meta.via_role?
can_modify_signers_of              entity  → entity   authorized modifier → multisig; meta.via_role?
```

**Events (Pattern 18; graph.json-only, filtered from relations.json)**:

```
funds_transfer                     entity  → entity   sender → recipient; meta {kind: grant|genesis|genesis_mint|authorization,
                                                       status, amounts, tx_hash?, period?, period_months?, begin_date?}
```

**Accord / definition**:

```
ecosystem_accord                   doc     → entity   Ecosystem Accord doc → each party (composite_party)
defines_entity                     doc     → entity   Defining doc → the entity it names
```

**Addresses**:

```
has_address                        entity  → address  Entity owns an on-chain address (1:N).
                                                       meta.role disambiguates when multiple per entity:
                                                         "ea_address"          — delegate's EA wallet
                                                         "delegation_contract" — delegate's voting contract
                                                         "governance"          — SRC member governance address
proxies_to                         address → address  Proxy → implementation address
mentions                           doc     → address  addressRefs in doc content
```

**Structural (doc → doc)**:

```
parent_of                          doc     → doc      Structural hierarchy (from parentId, reliable for depth ≤ 6)
cites                              doc     → doc      UUID markdown link [text](uuid) in content
annotates                          doc     → doc      Annotation/Tenet/Variation (*.0.3.X, *.0.4.X, *.varX)
active_data_for                    doc     → doc      Active Data (*.0.6.X) → its controller
located_at                         doc     → doc      ICD Location → ICD (via UUID in content)
instance_of                        doc     → doc      ICD → primitive root (strip 2 segments)
invocation_of                      doc     → doc      In-progress invocation ICD → primitive root; meta.status = "InProgress"
listed_in                          entity  → doc      Table entity → Active Data node (Pattern 16); structural, no source_doc_nos required; breach rows carry {date, breach_tier, reasoning_url} meta
has_status                         doc     → doc      Primitive root → Global Activation Status (strip 2)
implements                         doc     → doc      Agent primitive → global def in A.2.2 (via "See" cite)
```

**Total: 35 edge types** — verify against the artifact with `new Set(graph.edges.map(e => e.edge_type)).size`.

### Entity meta serialization

Participants ship with an optional `m: string` field in `relations.json` carrying JSON-serialised meta (see `Participant` in `src/types.ts`). Previously meta was dropped at serialisation; the `m` field is now forwarded to browser consumers. Reader shape:

```typescript
interface Participant {
  id: string;
  slug: string;
  name: string;
  et: string;
  st: string | null;
  did: string | null;
  m?: string; // JSON-stringified meta; present for et="instance"
}
```

For `et="instance"`, the parsed meta is:

```typescript
{
  primitive_doc_no: string; // e.g. "A.6.1.1.1.2.5.1"
  agent_doc_no: string; // e.g. "A.6.1.1.1"
  status: "Active" | "Completed" | "Pending" | null;
  params: Record<string, [value: string, srcUuid: string, srcDocNo: string]>;
}
```

**v1.3 diff from v1.2:**

- **Added (role edges):** `prime_agent_for`, `operational_executor_agent_for`, `core_executor_agent_for`, `operational_facilitator_for`, `core_facilitator_for`, `operational_govops_for`, `core_govops_for`, `aligned_delegate_for`, `ranked_delegate_for`
- **Added (other):** `comprises`
- **Renamed:** `member_of_erg` → `erg_member_for`; `responsible_for` → `responsible_party_for`; `holds_role` → `holds_role_for`
- **Removed (replaced by role edges):** `member_of` (flat Facilitator/GovOps edge), `executor_accord` (flat Prime→Executor edge)

**v1.4 diff from v1.3:**

- **Editorial Decisions section added** — surfaces the 8 judgment calls baked into the extractor (Sky Ecosystem → Sky Core merge; Sky party short-circuit; atomic parties as composite_party; single-member parties; ecosystem_actor catch-all; delegate_org naming; dual output shape; edge weight placeholder).
- **Sky Ecosystem → Sky Core merge:** `prime_agent_for` now targets `sky-core`; `sky-ecosystem` entity and `ecosystem` entity_type removed from the schema.
- **Pattern 12 — Atomic parties:** documents the `ATOMIC_PARTY_RE` fallback for party-details docs that use "The party 'X' is ..." phrasing (e.g., Moonbow at `A.2.8.2.2.1.1.4`). Atomic parties are `composite_party` entities with zero `comprises` edges.
- **Pattern 13 — Bootstrap table:** `sky-ecosystem` row removed; only `sky-core` and `sky-governance` remain.
- **Output shape note:** dual `graph.json` / `relations.json` contract formalized in Editorial Decision §7.

**v1.6 diff from v1.5:**

- **Entity Types table:** `instance` added. Entity id = ICD doc UUID; `st` = primitive slug from `INSTANCE_SCOPED_PRIMITIVES` (10 primitives).
- **Pattern 2 — primitive root resolver:** `primitiveRootFor(doc)` via `A.6.1.1.X.2.G.P` regex replaces the previous `ancestorByStripping(d, 2)` convention. The old heuristic landed 77 Allocation System edges on directory intermediaries (e.g. "Ethereum Mainnet Instances").
- **Pattern 2 — ICD Location content fallback:** `isICDLocation` now also matches by content (`This Instance's associated Instance Configuration Document is located at …`) so misnamed Location docs don't pollute the ICD entity set.
- **Pattern 14 (new) — Primitive Instance entities:** documents the scope allowlist, status-from-tier-title derivation, walk-by-title rule, `extractInstanceParams` traversal, the `[value, srcUuid, srcDocNo]` tuple shape, and the `PARAM_FORMATTERS` registry.
- **Pattern 15 (new) — `invoked_by` edge:** entity→entity edge from each Instance to its Prime Agent; mirrors `instance_of` status meta.
- **`instance_of` edge meta:** now carries `{status: "Active"|"Completed"|"Pending"}` for in-scope primitives.
- **`Participant.m`:** meta field is now shipped in `relations.json` (previously dropped); the `m` reader shape is documented in Entity meta serialization.
- **Editorial Decisions added:**
  - §9 Instance-as-entity scope is an allowlist (excludes Agent Creation + Prime Transformation)
  - §10 Instance params are `[value, srcUuid, srcDocNo]` tuples with per-key formatters
  - §11 Walk by title, not by doc_no position within an ICD
- **Edge total:** 25 → 26 (`invoked_by`).
- **Vocabulary tests:** `KNOWN_ENTITY_TYPES` gained `instance`; `KNOWN_EDGE_TYPES` gained `invoked_by`.
- **`PARAM_EXPANDERS` added:** Agent Token's `Token Address` compound prose is now split into per-chain keys (`Token Address (Ethereum Mainnet)`, `Token Address (Base)`, …). Unset agents keep the single `Token Address` key with placeholder prose. Backward-incompatible for any consumer that expected a plain `Token Address` on Spark or Grove.
- **Generic bullet-list expansion:** any leaf whose content contains ``- `key`: value`` bullets splits into `{leafTitle} / {bulletKey}` sub-keys. Primary use: Allocation System rate limits — 343 new sub-keys across 95 instances, replacing opaque "Inflow Rate Limits" prose values with direct `{Inflow,Outflow,Deposit,Withdrawal,Swap} Rate Limits / {maxAmount,slope,maxSlippage}` lookups. Fires after per-title `PARAM_EXPANDERS`.

**v2.0 diff from v1.7:**

- **Skill renamed** from `graph-atlas` to `parse-atlas`. Description updated to centre on parsing the atlas into graph form.
- **Pattern 16 (new) — Active Data table entity extraction:** documents the three target Active Data UUIDs, column→field mappings for Current Aligned Delegates / Derecognized Delegates / SRC Membership Registry, the `entity → doc` variant of `instance_of`, the address-based identity lookup, the `ecosystem_actor → delegate_org` upgrade rule, and the `scripts/lib/table-parser.mjs` utilities.
- **Entity Types table:** `delegate_org` row updated to reference Active Data UUIDs and note `is_active=0` for derecognized. `src_member` row added.
- **Edge vocabulary — `has_address`:** documents `meta.role` values (`ea_address`, `delegation_contract`, `governance`) that disambiguate multiple addresses on one entity.
- **Edge vocabulary — `listed_in` (new):** structural `entity → doc` edge for table membership (Pattern 16). Replaces the incorrect `instance_of` `entity → doc` variant. `instance_of` remains `doc → doc` only.
- **Editorial Decision §12 (new):** rationale for UUID anchoring, address-based identity lookup, and `ecosystem_actor → delegate_org` upgrade.
- **Edge total:** 26 → 27 (`listed_in` added; `instance_of` reverts to `doc → doc` only — the `entity → doc` variant described in v2.0 was incorrect and has been replaced).

**v2.1 diff from v2.0** (2026-06 chatbot gap-analysis sweep):

- **UUID-anchor bug fix:** the A.1 renumbering (A.1.5→A.1.6, A.1.8→A.1.9) had silently zeroed `aligned_delegate_for`, `ranked_delegate_for`, and `erg_member_for` — the doc_no constants in `graph-patterns.mjs` pointed at docs that no longer exist. Replaced with `ALIGNED_DELEGATES_UUID`, `ERG_MEMBERSHIP_UUID`, `RANKED_DELEGATE_UUIDS`, each warning to console when missing. `aligned_delegate_for` is now emitted from the registry table rows in Phase 2.7 (the doc became a table; prose path kept as fallback).
- **Pattern 16 — Tables 4+5:** Current Authorized Forum Accounts (`b71564fd`; `meta.forum_handle`/`forum_role`, rep individuals, `authorized_rep_for`) and Aligned Delegate Breach Registry (`1ddd9cf6`; dated `listed_in` breach events).
- **Pattern 16 — drift detector:** loud `[drift]` warning for any non-handled Active Data table with rows (tripwire for the 29 empty payment ledgers + Registered Multisigs `7d966e5e`).
- **Pattern 17 (new) — Multisigs:** five-child structural convention, threshold/signer prose shapes, role-reference resolution with `meta.via_role`, `multisig` entity type, `signer_of` + `can_modify_signers_of` edges. `scripts/lib/graph-multisigs.mjs`, Phase 2.8.
- **Pattern 18 (new) — Transfer/grant events:** A.2.13 grants, genesis distributions, accord grant authorizations → `funds_transfer` (graph.json-only). `scripts/lib/graph-transfers.mjs`, Phase 2.8.
- **Pattern 19 (new) — Integration partners:** `Integration Partner Name` params → `ecosystem_actor/integration_partner` entities + `integration_partner_of` edges.
- **Pattern 20 (new) — Spell Team + org prose:** `holds_role_for` `meta.role="spell_team_member"` (Dewiz, Sidestream); `prime_foundation_for` + `provides_services_to` prose edges (emit only when both endpoints resolve).
- **"Not in the atlas" section (new):** payout history, spell execution history, pioneer dates, individual signer addresses, org hierarchy.
- **relations.json filter:** `KEEP_ACTOR_EDGE_TYPES` grew `signer_of`/`can_modify_signers_of`/`integration_partner_of`; `OMIT_EDGE_TYPES` (new) drops `funds_transfer` + `authorized_rep_for` from the browser artifact.
- **Entity types:** 14 → 15 (`multisig`; `ecosystem_actor` subtypes `individual`, `integration_partner`). **Edge total:** 28 → 35.

---

## Out of Scope (Atlas-excluded)

Categories the atlas itself excludes or frames as non-entities. Do not extract.

- **Shadow Delegates** (`A.1.9.2.2.4.2`): atlas says verbatim "They are not officially recorded in the Atlas and do not receive any compensation from Sky." Do not create entities for them.
- **Core Council** (`A.0.1.1.46`): defined as a _group of Executor Agents_, not a distinct actor. Already covered as the set of `agent/core_executor` entities whose titles start "Core Council Executor Agent". No separate entity kind.
- **SPK Company Ltd** (`A.6.1.1.1.2.1.4.2.1.2.1`): named legal entity with no atlas-level category. Surfaced as `ecosystem_actor` by Pattern 18 (genesis transfer party) since v2.1.

---

## Open Questions

- **Halo Agents**: mentioned in `A.6.1.1.5.1` as a future category — no structural pattern yet; do not classify
- **Proto-Agents**: atlas defines the stage but names no current instances. `agent/proto` subtype reserved; pattern will land if/when named
- **Multi-party Ecosystem Accords**: `A.2.8.2.2` (Prime Program) covers Sky + Spark + Grove + Moonbow — parse from party-details docs, not title
- **Executor Accord position**: currently `.2.2` for all checked agents — derive from citation, not position
- ~~**Spell Roster roles**~~ — **addressed (v2.1)**: Spell Team membership extracted via `SPELL_TEAM_UUID` (Pattern 20). Per-spell Crafter/Reviewer assignments and execution history are not in the atlas.
- ~~**Grant events**~~ — **addressed (v2.1)**: Pattern 18 extracts grants, genesis distributions, and accord authorizations as `funds_transfer` edges. Known limitation: multi-grant authorization docs only capture the first grant.
- ~~**Compound prose values**~~ — **addressed**: `PARAM_EXPANDERS["Token Address"]` splits multi-chain prose into per-chain `Token Address (<Chain>)` keys for Agent Token. Unset agents (Keel, Skybase, Obex, Pattern, Launch Agent 6/7) still emit a single `Token Address` key with the placeholder prose. Future compound-prose patterns in other primitives can be handled by adding more expanders.
- **Key-variation normalisation**: `Token Address` vs `Pool Address` vs `Token Address (ERC4626 Vault)` are preserved as-written. A consumer-side normaliser (e.g. "any `*Address` key is an on-chain contract") has not been specified. Document the taxonomy once use cases converge
- ~~**Integrator partners as entities**~~ — **addressed (v2.1)** for Integration Boost partners (Pattern 19, `st="integration_partner"`). Allocation System target protocols (Morpho vault operators, CoW Swap, …) remain param values only — promote if per-protocol queries become a need.
