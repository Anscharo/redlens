# Handoff — GovOps Responsibilities report + shape #3 graph migration

**Branch:** `claude/govops-responsibilities-report-ndrbqs` (4 commits)
**Atlas commit these findings were researched against:** `2558632e09c0dde26173c5af015362743192fc3b`
**Route:** `/reports/gov-ops-responsibilities`

The report ships now, reading only existing artifacts (`docs.json` + `relations.json`) — **no pipeline change was made**. One section ("Process-Step Responsibilities", aka *shape #3*) is currently a frontend content-scan and is the thing to migrate into the graph. This doc explains the whole report so you have context, then the migration plan.

---

## 1. What was built

**New files**
- `src/lib/govopsResponsibilities.ts` — pure derive logic (`deriveGovOpsResponsibilities`), the report's brain.
- `src/components/reports/OpGovOpsReport.tsx` — the page (mirrors `OpFacilitatorsReport.tsx`; filter pills for GovOps / Executor / Prime).
- `src/lib/govopsResponsibilities.test.ts` — 12 deterministic synthetic-fixture tests (run without a build).

**Wired into**
- `src/lib/routes.ts` (`REPORTS_GOVOPS_RESPONSIBILITIES`), `src/types.ts` (`ReportId`), `src/App.tsx` (lazy route), `src/components/ReportsIndex.tsx` (index card), `src/components/chat/pageContext.ts` (page name), `patch-notes.md`.

## 2. The five data categories and where each comes from

| Category | Source | Graph-modeled? |
|---|---|---|
| `definition` | 2 curated Preamble UUIDs (`A.0.1.1.47`, `A.0.1.1.48`) | frontend (curated) |
| `op-duty` / `core-duty` | content/title scan for GovOps as an actor (`ROLE_ACTION_RE`) | **no edge exists** (frontend) |
| `assignment` | `operational_govops_for` / `core_govops_for` edges | ✅ graph |
| `active-data` | `responsible_party_for` edges filtered by **declared role** (`meta.role_declared` contains "GovOps"), NOT entity type | ✅ graph |
| `process-step` | **content scan** for bulleted `Responsible Party: <GovOps role>` in non-ADC docs | **frontend — MIGRATE THIS** |

Key correctness note on `active-data`: we filter on `meta.role_declared`, not on "entity is a `govops_org`". A GovOps org (Soter Labs) also holds Responsible-Party duties in other capacities (named directly), and those are **not** GovOps duties. Preserve that principle in any graph work.

---

## 3. The migration: shape #3 → a graph edge

### Why it isn't a graph edge yet
`build-graph`'s Responsible-Party extraction (`scripts/lib/graph-entity-edges.mjs`, **section 2s**) runs **only** on `type === "Active Data Controller"` docs:

```js
for (const d of allDocs.filter((d) => d.type === "Active Data Controller")) {
  const raw = extractRP(d.content);      // graph-patterns.mjs — FIRST match only
  ...
  addEdge(entity.id, "entity", d.id, "doc", "responsible_party_for", [d.doc_no],
          JSON.stringify({ role_declared: raw, resolution }));
}
```

The shape-#3 docs are `type: "Core"` process-step "Update" docs (mostly under `A.2.2.9.*`) carrying a bulleted `- Responsible Party: <role>` field, so they never enter that loop.

### Recommended design
Emit a **new, distinct edge type** — do **not** overload `responsible_party_for` (that one means governance data-ownership; this means per-step execution):

```
process_step_responsible_party_for
  from = resolved role entity (e.g. Soter Labs)   ft = "entity"
  to   = the process-step doc                       tt = "doc"
  meta = { role_declared, resolution, automated: bool }
```

Resolve the role→entity with the **same** logic already in section 2s (`rpRoleAndName` + the chain/uniqueOpGov/coreGov fallbacks) — for `A.2.2.9.*` docs there's no agent prefix, so `operational_govops` → `uniqueOpGovId` (Soter Labs) and `core_govops` → `coreGovId` (Atlas Axis). That fallback path already exists in 2s.

### Data quirks the extractor MUST handle (verified against the atlas)
1. Casing: `Responsible Party:` **and** `Responsible party:`.
2. Trailing `[automated]` — strip before name resolution.
3. **Multiple RP lines per doc** — `extractRP` returns only the first; you need a global/multiline scan (add an `extractAllRP` or loop `RP_RE_COLON` with the `g` flag).
4. Indentation before the `-` bullet.
5. Role spelled `CoreGovOps` (no space) appears in prose (e.g. `A.2.2.1.1.13`).
6. Role+name form: `Operational GovOps Soter Labs`.
7. Scope out ADCs (avoid duplicating section 2s) — scan non-ADC docs only.
8. Dedupe per `(from, to)` — a doc with several same-role steps should yield one edge (or carry a count in meta).

Consider emitting for **all resolvable roles** (facilitators too), not just GovOps — then the Facilitator report can reuse it later. Minimum viable is GovOps-only.

### Sample docs to test against (UUID — doc_no — shape)
- `e7fc7c2e-b6fc-4e0f-ae10-debb54124e8e` — A.2.2.9.2.2.3.3.4.2.1 "Primitive Hub Document Update" — single Operational
- `11161730-6568-445f-a250-ba5c67857390` — A.2.2.9.1.2.3.1.4.2 "Agent Artifact Updates" — **two** Operational `[automated]`
- `0ab76a83-ca8d-4ebf-83c1-b7e7dced0970` — A.2.2.9.2.2.4.1.4.4.1.1 — **Core** GovOps
- `6f457b50-a98c-4516-9b37-932603a59627` — A.2.2.9.1.2.3.2.4.2.2 — Operational `[automated]`
- `adfb66a3-4f73-4fcc-bfa2-f5126503187c` — A.2.2.9.2.2.3.5.4.2 "Agent Artifact Updates" — Operational

`grep -rl "Responsible Party" vendor/next-gen-atlas/content` then filter for GovOps to enumerate the full set (rough estimate from search: ~15–20 GovOps process-step docs).

### Files to touch for the graph change
- `scripts/lib/graph-patterns.mjs` — add a global multi-match RP extractor (keep `extractRP` as-is for 2s).
- `scripts/lib/graph-entity-edges.mjs` — new section (e.g. 2s-bis) emitting `process_step_responsible_party_for`.
- `scripts_tests/graph.test.ts` — add the new edge type to the valid-edge-type set (~lines 98–140); optional Pattern test.
- `graph-snapshots/graph.snap.test.ts` — deliberate snapshot change → `pnpm test:snap:update`.
- `src/lib/entityGraph.ts` — add an `EDGE_LABELS` entry (forward/reverse) so it renders in the entity panel/constellations.
- Check `KEEP_ACTOR_EDGE_TYPES` in `scripts/required/build-graph.mjs` (~line 851): fine for `govops_org` sources, but if you also emit to `ecosystem_actor`-typed roles, add it there or the edge gets pruned.

### Then swap the frontend to the edge (in `govopsResponsibilities.ts`, section 5)
Replace the `STEP_RP_RE` content scan (marked `TODO(graph)`) with an edge query mirroring the `active-data` section:
```js
for (const e of edges) {
  if (e.e !== "process_step_responsible_party_for") continue;
  const declared = parseMeta(e.m)?.role_declared ?? "";
  if (!ANY_GOVOPS_RE.test(declared)) continue;
  // ...same row shape; role from declared; govops = entityById.get(e.f)?.name
}
```
Keep the `(doc, role)` dedupe (or rely on edge dedupe). Update `govopsResponsibilities.test.ts` shape-#3 fixtures to feed `process_step_responsible_party_for` edges instead of raw content. Remove `STEP_RP_RE` + `firstLine` once unused.

---

## 4. Local verification (you can build; the cloud env can't — submodule is 403-blocked)

```bash
pnpm pull-atlas                       # populate vendor/next-gen-atlas
pnpm build:index && pnpm build:graph  # docs.json + relations.json + graph.json
# inspect the new edges:
grep -o 'process_step_responsible_party_for' public/relations.json | wc -l
pnpm test                             # incl. govopsResponsibilities + artifact-reading report tests
pnpm test:snap                        # will FAIL until you accept the graph delta:
pnpm test:snap:update                 # accept deliberate snapshot change
REPRO=1 pnpm test                     # reproducibility (two builds byte-identical)
pnpm dev                              # eyeball /reports/gov-ops-responsibilities
```

Added `src/lib/govopsResponsibilities.artifact.test.ts` (mirrors `facilitatorResponsibilities.test.ts`) so the report is checked against real `docs.json`/`relations.json`, not just synthetic fixtures.

## 5. Open questions — resolved
- **Edge scope**: extraction is role-agnostic (`resolveResponsibleParty` is shared with 2s and resolves whatever role/entity it can), but only GovOps declarations currently have an unconditional no-prime-context fallback (`uniqueOpGovId`/`coreGovId`) — 19/51 raw declarations are unresolved (`Operational Facilitator`, `Prime Agent(Team)`, `Agent`), all non-GovOps. Facilitator edges will start emitting for free once that chain gets a fallback for `operational_facilitator` (out of scope here).
- **op-duty/core-duty as an edge**: still not done — noted, lower priority.
- **Row granularity**: one row per (doc, entity, declared role) — a doc with several identical-role steps collapses to one edge; a doc with both an Operational and a Core step keeps both even if they resolve to the same entity.

## 6. Status — migration complete
Shape #3 is now a graph edge (`process_step_responsible_party_for`, section 2s-bis in `graph-entity-edges.mjs`), and `govopsResponsibilities.ts` section 5 queries it instead of scanning content. Verified against the real atlas build (`2558632e09c0`): 32 edges across 41 non-ADC docs (19 unresolved, all non-GovOps roles), and the final report's GovOps process-step row count is **unchanged at 22** — byte-identical to the pre-migration content-scan, confirmed via a real-artifact test run. Full pipeline verified: `pnpm build:index && pnpm build:graph`, `pnpm test` (642 passed), `pnpm test:snap` (accepted, one new edge type in the snapshot), `REPRO=1 pnpm test`, `tsc --noEmit`, `oxlint`, and a production `vite build`. A self-review pass (8-angle code review) caught and fixed three real issues before landing: an automation-annotation bug (`[if not automated]` was read as `automated: true`, inverted), a dedup key too coarse to survive a future same-entity-different-role collision, and two MCP server tools (`tools-graph.ts`, `tools-history.ts`) that hardcoded the old edge-type list and would have missed the new edge. No PR opened yet.
