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
- **op-duty/core-duty as an edge**: DONE — `duty_for` (section 2s-ter, `scripts/lib/graph-duties.mjs`). One edge per doc, `meta = { role_declared, match: title|active|passive|phrase|org, quote }`; the quote is the matched sentence (provenance, doubles as the row's duty text). The extractor also carries the precision/recall fixes from the 2026-07-02 data-quality audit: powers vocabulary (modals `may/can/should`, "at the discretion of", "has the ability to", `is/are controlled by`), passive power participles (adjudicated/permitted/held/modified/populated/specified by GovOps), org-name-subject scanning (GovOps org names resolved from the gov edges, so "Atlas Axis drafts …" counts), and misattribution guards ("GovOps meeting/channel" noun compounds, "in consultation with GovOps", modal passives like "must be added", and the ", the <Actor> <verb>" new-subject shape).
- **Row granularity**: one row per (doc, entity, declared role) — a doc with several identical-role steps collapses to one edge; a doc with both an Operational and a Core step keeps both even if they resolve to the same entity.

## 6. Status — migration complete
Shape #3 is now a graph edge (`process_step_responsible_party_for`, section 2s-bis in `graph-entity-edges.mjs`), and `govopsResponsibilities.ts` section 5 queries it instead of scanning content. Verified against the real atlas build (`2558632e09c0`): 32 edges across 41 non-ADC docs (19 unresolved, all non-GovOps roles). **Correction (2026-07-02):** the original claim here that the report's process-step row count was "unchanged at 22" described a mid-development state — the same commit's hardening (a `process_step_responsible_party_for` edge now excludes its doc from duty discovery) moved ~8 docs out of the duty sections, so the shipped report shows **32** process-step rows, all edge-backed. Full pipeline verified: `pnpm build:index && pnpm build:graph`, `pnpm test`, `pnpm test:snap` (accepted, one new edge type in the snapshot), `REPRO=1 pnpm test`, `tsc --noEmit`, `oxlint`, and a production `vite build`. A self-review pass (8-angle code review) caught and fixed three real issues before landing: an automation-annotation bug (`[if not automated]` was read as `automated: true`, inverted), a dedup key too coarse to survive a future same-entity-different-role collision, and two MCP server tools (`tools-graph.ts`, `tools-history.ts`) that hardcoded the old edge-type list and would have missed the new edge. No PR opened yet.

## 7. Status — duty discovery migrated + audited (2026-07-02)
A data-quality audit of the report (over/under-reporting) found the regex duty scan skewed toward chores and away from powers, missed org-name-attributed duties entirely, and pulled in ~11 false rows from the "GovOps meeting" Executive-Process family. Duty discovery now lives in build-graph as the `duty_for` edge (see §5) with expanded vocabulary and misattribution guards; `govopsResponsibilities.ts` section 3 consumes the edges and uses `meta.quote` as the duty text. Net effect at `2558632e09c0`: 293 duty edges — 54 docs added (adjudication/conservatorship/parameter-control powers, discretion phrases, multisig control, the Atlas Axis Atlas-Edit process steps), 11 false-positive docs removed, report total 243 → 282 rows. Duty rows also carry `govops` (entity attribution) so the org filter pills cover them. Pattern regressions are pinned by `scripts_tests/graph-duties.test.ts` (every case is a real atlas shape, doc_nos in comments); the derive logic is covered by the rewritten synthetic tests (edge fixtures) plus the artifact tests. Verified: `pnpm test` (666 passed), `pnpm test:snap:update` (one snapshot line: the new edge type), `REPRO=1 pnpm test`, `tsc --noEmit`, `oxlint`.

**Recall drift guard:** `pnpm census:govops` (`scripts/required/check-govops-census.mjs`) buckets every GovOps-mentioning doc — row (381) / preamble / other-rp / venue-only / residue (84, reviewed doc-by-doc: recipient mentions, signer rosters, tables, other actors' duties, and the two deliberately rejected false positives) — and warns `[drift]` when a doc enters the residue that isn't in `.github/govops-census-baseline.json`. atlas-update.yml runs it with `--update` per bump, so a new unrecognized GovOps phrasing surfaces as a baseline diff in the bump PR plus a warning in the drift log, instead of silently missing from the report.

## 8. Status — duty extraction generalized to all acting roles (2026-07-02, branch `claude/oea-duty-roles`)
The §5 "out of scope" item is done: duty discovery now runs per acting role — GovOps, Facilitator, Executor Agent — via a `DUTY_ROLES` config table in `graph-duties.mjs` (per-role subject/qualifier regexes, noun-compound guards, bare-label semantics, `titleScan` opt-out for the Executor's structural title stubs). `findGovOpsDuty`/`classifyGovOpsRole` remain as back-compat wrappers. Section 2s-ter emits `duty_for` per (doc, role); at `2558632e09c0`: 294 govops / 436 facilitator / 146 executor edges, 0 unresolved. Semantics decided along the way:
- **Bare labels**: unqualified "Facilitator"/"Executor Agent" duties keep the bare label (A.1.6-style universal duties) instead of defaulting to Operational the way bare GovOps does — and a duty that can't be pinned to one holder fans out to every holder of the role (both operational facilitator orgs + the core org for a bare-label duty) rather than being dropped or guessed.
- **Role-assignment docs** are now excluded via the actual role-edge source docs (any of the six `*_for` role edges), replacing the fragile `A.6.1.2.<n>.2` doc_no regex.
- **Type Specifications are excluded** from duty discovery: the A.1.2.2.* doc-type spec family names Facilitators pervasively ("The Facilitator Action Tenet Type") but tasks no one (11 false docs removed).
- **2s gained an `operational_facilitator` chain fallback** (mirrors `uniqueOpGovId`) — inert today because two orgs hold the role, so no unconditional fallback fires; the 19 unresolved RP declarations are unchanged.
- **Consumers filter by `role_declared`**: `govopsResponsibilities.ts` (report) and `check-govops-census.mjs` only count GovOps-declared `duty_for` edges, so the GovOps report and census are unchanged (294 duty edges, 382 census rows — one former residue doc now covered by the verb-vocabulary expansion: interprets/instructs/agrees/documents). No frontend consumes the facilitator/executor duties yet beyond entity panels/constellations (`duty_for` was already in `EDGE_LABELS` and the MCP tools); the OpFacilitators report migration to `duty_for` is a follow-up.
Verified: `pnpm test` (686), new pattern tests for both roles in `graph-duties.test.ts` (36 total), `pnpm test:snap:update` (duty_for 293 → 876), `REPRO=1 pnpm test`, `tsc --noEmit`, `pnpm census:govops` (0 drift, baseline refreshed). This is the extraction-parity milestone `docs/oea-assessment-rubric.md` §Scope depends on.

## 9. Status — OpFacilitators report migrated to duty_for (2026-07-02, same branch)
The follow-up flagged in §8 is done: `facilitatorResponsibilities.ts` is now edge-backed, mirroring `govopsResponsibilities.ts` — categories `universal` (bare-label duties, one row per doc with all fan-out holders accumulated for the pills) / `core-facilitator` / `op-duty` (per-agent-artifact copies collapsed by title, contextless fan-out to both op orgs collapsed with holders listed) / `assignment` (new — FAC_EDGES, mirrors the GovOps assignments) / `active-data` (now filtered by `role_declared`, not entity + doc_no prefix) / `process-step` (empty today; renders as soon as facilitator RP declarations become resolvable, see §8). Report grew ~48 → 310 rows at `2558632e09c0` (214 core-facilitator — the adjudication/misalignment machinery names the Core Facilitator across the whole atlas). Shared plumbing extracted along the way: `src/lib/dutyText.ts` (dutySnippet/firstLine, consumed by both derive modules), `reportChains.Chain` gained the facilitator link, `rolePills(graph, edgeSet)` is role-parameterized, and the report UI reuses `FilterPills`/`DocCell`/`AgentChips` with a facilitator-specific `OFCategoryTable`. One extraction fix fell out of the coverage diff: `triggers`/`triggered` joined the duty verb vocabulary (the agents-2–8 copies of "Root Edit Token Holder Vote" had no other actor verb), facilitator 436 → 444 edges, GovOps unchanged. The old content-scan path (`SCATTERED_UNIVERSAL_UUIDS`, `ROOT_EDIT_OF_TITLES`, opening-sentence classification) is gone; old `?filter=core` URLs decode to no-filter. Verified: `pnpm test` (695+), `test:snap:update` (876 → 884), `REPRO=1 pnpm test`, `tsc --noEmit`, census 0 drift.
