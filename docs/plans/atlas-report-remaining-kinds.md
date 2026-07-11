# atlas_report — Remaining Report Kinds Plan

**Parent:** [`chatbot-readiness-remediation-plan.md`](./chatbot-readiness-remediation-plan.md) workstreams #5 (shared report builders) + #6 (`atlas_report` tool).
**Status:** `atlas_report` tool shipped with two **server-native** kinds — `multisigs` and `primitive_matrix` (both pure over the server `Indexes`, in `src/server/reports/`, budget-guarded, fixture-tested). This plan covers the four remaining kinds and the shared-builder (`ReportGraph`) decision that #5 turns on.

Remaining kinds: **`active_data`**, **`rewards`**, **`actors`** (all backed by an existing frontend builder) and **`transfers`** (server-native, data already emitted).

---

## The #5 decision: when to introduce `ReportGraph`

Two kinds shipped without any shared abstraction — correct, because each had a single caller (the server). The neutral interface earns its keep at the **first FE-backed kind**, where two real shapes must both satisfy it:

- **Frontend** `RelationEdge` `{ f, ft, t, tt, e, s?, m? }` + `GraphEntity` `{ id, slug, name, et, st, did, m? }` (from `relations.json`).
- **Server** `Edge` `{ from_id, from_type, to_id, to_type, edge_type, source_doc_nos, meta }` + `Entity` `{ id, slug, name, entity_type, subtype, defining_doc_id, meta }` (from `graph.json`).

These are the **same data, different field names** — so `ReportGraph` is a thin normalization layer, not an algorithmic fork.

**Design:**
- Define `ReportGraph` in `src/lib/reports/` (lib-level, **no server imports**) as a minimal accessor over normalized edges/entities/doc-lookups — expose only what the first consumer (`active_data`) needs, then widen per kind. Do **not** front-load a maximal interface.
- Two adapters: `graphDataToReportGraph(GraphData)` (frontend) and `indexesToReportGraph(Indexes)` (server).
- Shared builders move to `src/lib/reports/<kind>.ts`, importing `ReportGraph`. Both the UI (`src/components/reports/*`) and the server (`atlasReport` dispatcher) call the same builder.
- **Regression guard:** the existing `*Index.test.ts` suites must still pass after extraction — that is what proves the shipped FE report is unchanged.
- Model-facing output is a **provenance-rich superset** of the FE table rows (the FE narrows it); provenance (`source_doc_nos`, evidence chains) on by default.

---

## Per-kind

### 1. `active_data` — do FIRST (sets the `ReportGraph` pattern)

- **Source builder:** `buildActiveDataRows(docs, { participants, edges })` in `src/lib/activeDataIndex.ts` — already React-free and unit-tested (`activeDataIndex.test.ts` = the regression guard).
- **Edges used (bounded):** `active_data_for`, `responsible_party_for`, `holds_role_for`, `core_facilitator_for`, plus the role-as-edge sets (`EXEC_EDGES`/`FAC_EDGES`/`GOV_EDGES`).
- **Effort:** M. The algorithm is done; the work is the `ReportGraph` interface + two adapters + server dispatch wiring + emitting the provenance superset (evidence steps already carry doc_nos).
- **New logic (plan §active_data):** population status / shell detection — flag Active Data docs whose content ends at introductory text with no rows (`populated: false` + reason). `buildActiveDataRows` does not compute this yet; add a content-shape check.
- **Output:** one row per Active Data doc — controller, agent, responsible party (+ evidence chain), facilitator (+ evidence), process, `populated` flag.

### 2. `transfers` — server-native (data already emitted; no `ReportGraph` needed)

- **Data present in `graph.json`:** `funds_transfer` (23 edges), `funds_data_gap`, `funds_authorization` — meta carries `{ kind, status, period, amounts, … }`. Build it directly over `Indexes` like `multisigs`.
- **Effort:** M.
- **Output (plan §transfers):**
  - actual event refs from `funds_transfer`: sender, recipient, asset, amount, status, date, source doc, and whether the date is `content`-derived or `first_seen`-derived;
  - silent recording locations from `funds_data_gap`: `populated: false` + the expected fields (reward period, payee, payment address, amount, tx hash, tx date);
  - keep `funds_authorization` **separate** — authorizations are not completed transfers.
- **Depends on:** Phase 0.4 transfer-reference audit (keep only well-provenanced events) and, for accurate dates, #7 `first_seen` enrichment (currently ⬜) — until then, label derived dates clearly or omit.

### 3. `rewards` — reuses `ReportGraph`

- **Source builder:** `buildRewardsIndex(docs, graph)` in `src/lib/rewardsIndex.ts` — the most complex (nested instances/invocations, ICD param extraction, payment controllers, chain resolution, 329 lines).
- **Effort:** L. Flatten to one row per instance/invocation (the `rewardsIndexToCSV` flatten I just wrote is a ready-made shape). Add empty/unpopulated payout-record flags (plan §rewards).
- **Depends on:** `ReportGraph` from `active_data`.

### 4. `actors` — reuses `ReportGraph` (largest; do LAST)

- **Source builder:** `buildActorProfile(slug, graph, docs)` + `buildSidebarActors(graph, docs)` in `src/lib/actorIndex.ts` (437 lines, per-actor graph walks).
- **Effort:** L. Output (plan §actors): organizations by type + typed relationship edges + individuals (with prose-only-not-exhaustive caveat) + a role/position summary.
- **Overlap:** partially served by `atlas_edges` / `atlas_entity` — scope this to a curated org + relationship rollup, not a re-implementation of graph traversal.

---

## Recommended order

1. **`active_data`** — introduces `ReportGraph`; smallest FE-backed builder; tested regression guard.
2. **`transfers`** — server-native, data ready, high chatbot value (honest silent-data answers).
3. **`rewards`** — reuses `ReportGraph`; flatten shape already exists.
4. **`actors`** — largest; benefits from a settled `ReportGraph`.

## Open questions

- **`active_data` shell detection:** define "empty" precisely (content ends at intro prose, no table/rows) — needs a concrete rule + fixtures.
- **`transfers` date provenance:** distinguishing `content`-derived vs `first_seen`-derived dates depends on #7 `first_seen` enrichment (⬜). Ship transfers with content-derived dates only until then, and label the gap.
- **`ReportGraph` scope creep:** resist adding accessors a current kind doesn't use. Widen at each new consumer, guided by that kind's actual edge/entity needs.
