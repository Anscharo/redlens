# Deep Code Review — Redline Atlas

**Date:** 2026-07-09
**Scope:** whole codebase along three axes — inefficiency, messiness, true bugs / structural issues — plus architectural proposals and quick wins.
**Method:** five parallel read-only reviewers, one per subsystem (build pipeline, frontend, shared data logic, server, cross-cutting), followed by an orchestrator verify pass that re-read the code behind every high-severity bug claim before it was accepted.

> **Provenance note.** This report was reconstructed from an interrupted review session (agent "Execute validated floating Stearns research plan", session `0f78de95` resumed as `8f34da47`, 2026-07-09). All five reviewers completed and the orchestrator verified the strongest findings, but the run terminated on a spend-limit wall before the report file was written. The findings below are recovered verbatim from the sub-agent transcripts (`.claude/projects/-Users-m7-lens/…/subagents/`), annotated with the orchestrator's own verification verdicts where it re-checked a claim. **CONFIRMED** = the code path was fully traced (by the reviewer and, for high-severity items, re-verified by the orchestrator). **SUSPICIOUS/PLAUSIBLE** = plausible but not fully traced. No code was changed.

---

## Resolution status (updated 2026-07-09)

| Finding | Status | Where |
|---|---|---|
| Exec #1 — PostHog proxy forwards the auth cookie/JWT | ✅ fixed | `0191520d` (review-followups) — `cookie`/`authorization` added to a `CREDENTIAL_HEADERS` strip set; not hashed |
| Exec #2 / BUILD B2(sync) / SERVER #2, #9 — Solana casing corrupted by sync→updater | ✅ fixed | `2aeb0458` (main) — canonical `normalizeAddress` at ingest, `atlas_get_address` read side, `(address,chain)` dedupe + stale-row GC |
| Exec #3 / X-cutting #1, #2 — updater DB→disk drops `addressRefs` + `contentHash` | ✅ fixed | `2aeb0458` (main) — migration 013 adds `node_content_hash` (parser hash, distinct from embed-text `content_hash`) + `address_refs` jsonb; round-trip DB-verified |
| BUILD B1 — ICD slug collision merges instances + dangling `invoked_by` | ✅ fixed | `2aeb0458` (main) — uuid-suffix slug disambiguation; new referential-integrity test |
| X-cutting #11 — duplicate `AtlasNode` type (root of the drop) | ✅ fixed | `2aeb0458` (main) — unified to one declaration |
| SERVER inefficiency #5 — query embed has no cache / unbounded backoff | 🟡 mitigated | `52cd8520` (review-followups) — bounded with `SEMANTIC_EMBED_TIMEOUT_MS` + lexical fallback; a real embed cache is still open |
| Exec #4 (graph worker hang), #5 (`useLoaded` no rejection), #6 (apostrophe phrase quotes), BUILD B2(build), and all other findings | ⬜ open | — |

Everything below is the original report, unchanged.

---

## Executive summary — highest-severity, orchestrator-verified

Ranked by blast radius. Every item here was re-read at the cited location by the orchestrator during the verify pass.

> ✅ = fixed, 🟡 = mitigated, ⬜ = open (per the Resolution status table above): #1 ✅ · #2 ✅ · #3 ✅ · #4 ⬜ · #5 ⬜ · #6 ⬜ · #7 ✅.

1. **PostHog proxy incidentally forwards the browser auth cookie to a third party** — `src/server/posthog-proxy.ts:58-63`. The header-copy loop drops IP/hop-by-hop headers but not `cookie`, so on browser analytics traffic the HttpOnly `sky_session` JWT is forwarded to `us.i.posthog.com` on every event once a user signs in. It's forwarded incidentally (same-origin `fetch`/`sendBeacon` attach the cookie automatically) and contributes nothing — the browser side already groups events via posthog-js's client-generated `$session_id` (`persistence: "sessionStorage"`, `person_profiles: "never"` — analytics is deliberately anonymous). **This is unrelated to MCP session analytics**, which never goes through this proxy: MCP posts server-to-server via `captureServerEvent` and correctly groups on the `mcp-session-id` header (`index.ts:135`, `mcp.ts:83`), an opaque non-credential correlation id — no cookie, nothing to hash. (CONFIRMED — flagged by the orchestrator as "the most severe claim yet.") *Fix: add `cookie` and `authorization` to `DROP_HEADERS` — do not hash the JWT (that would inject a user-linked id into a pipeline whose design forbids it).*

2. **Solana address case destroyed by the sync → updater loopback** — `src/server/sync.ts:109` lowercases *all* addresses into Postgres (base58 is case-sensitive), and `src/server/atlas-updater.ts:177-186` rewrites `public/addresses.atlas.json` keyed by those lowercased values. After the first hot refresh on Railway, all ~40 Solana keys are corrupted; address cards/roles/labels vanish and explorer URLs point at invalid addresses. (CONFIRMED — orchestrator: "fully confirmed.") The build-pipeline reviewer independently found the same casing split *within the graph build* (57 `:solana` node ids for 40 real addresses — see BUILD B2).

3. **The in-process updater's DB→disk rebuild silently drops `addressRefs` and `contentHash` from every node** — `src/server/atlas-updater.ts:146-172` + `src/server/indexes.ts` `docRowToNode`. `atlas_doc_meta` has no `address_refs` column and the SELECT omits `content_hash`, so after the first post-deploy atlas advance: (a) RightPanel address cards and chainlog reverse-search go silently empty, and (b) the OEA report flips every assessed row to "stale" (`src/lib/oeaReport.ts:63-70` compares an `undefined` hash). (Both CONFIRMED.) *Fix: add `content_hash AS "contentHash"` to the SELECT; decide whether `addressRefs` must be re-derived.*

4. **Graph worker init failure hangs every consumer forever, with no retry** — `src/lib/graph.ts:114-121,155-168`. Any non-stale worker error (500/network/parse on `relations.json`) logs and returns without settling `readyCallbacks`/`constellationInitWaiters`; `getEdges`/`constellationQuery`/`getConstellationInit` await `whenReady()` forever, and the worker singleton is never re-spawned. One transient 500 kills constellations + right-panel relations until full reload. (CONFIRMED.)

5. **`useLoaded` has no rejection handling → permanent "Loading…" + unhandled rejection** — `src/hooks/useAtlasData.ts:16-18`. `loadGraph`/`loadDocs` delete their cache and rethrow on failure; the reports that consume `useLoaded` (`OpGovOpsReport`, `ProcessesReport`, `OFReport`, `ActiveDataReport`) show a forever-spinner or empty body with no retry. Same missing-catch at `SearchResults.tsx:82`. (CONFIRMED.)

6. **Apostrophes parsed as case-sensitive phrase quotes → zero results** — `src/lib/searchHighlight.ts:102-106`. Any query with two apostrophes (`don't won't`, `Sky's Facilitator's duties`) captures the text *between* them as a required case-sensitive phrase; `search.worker.ts:243-255` then drops every hit. Searching `don't slash won't work` returns nothing though every term matches. (CONFIRMED.)

7. **ICD slug collision merges two instances, hijacks the entity id, leaves a dangling edge** — `scripts/lib/graph-entities.mjs:459-466`. `addEntity` is get-or-create but the caller unconditionally reassigns `ent.id`; two ICDs with the same slug collapse to one entity and the second's params are never extracted. Verified in the live graph: 193 ICD docs → 192 entities, one dangling `invoked_by` edge. (CONFIRMED — reviewer verified against the built graph.)

Lower-severity confirmed bugs (filter reset on report expand, scroll-jump on "show more", stale NodeHistory results, ARIA-less tree rows, the "Goverance" typo, non-strict server tsconfig, dead `environmentMatchGlobs`, unbounded `diffCache`, etc.) are in the per-subsystem sections below.

---

## Part 1 — Build pipeline (`scripts/required/` + `scripts/lib/`)

### Bugs (ranked)

- **B1. CONFIRMED — ICD slug collision silently merges two instances, hijacks entity id, leaves a dangling edge.** `scripts/lib/graph-entities.mjs:459-466` (same pattern `:83-84`, `:95-96`). `addEntity` returns the existing entity on slug hit (`:47`), then the caller does `ent.id = icd.id` unconditionally — the second ICD re-ids the first's entity while keeping the first's meta/params; the second's params never extract (Phase 2.5 iterates entities, not ICDs). Live graph: 193 ICD docs → 192 entities; docs `…6.1.3.1.6.1` and `…6.1.3.1.6.2` (identical titles) collapse; one dangling `invoked_by` edge whose `from_id` matches no entity. *Fix: disambiguate the slug (include ICD uuid or tier) or warn loudly like graph-multisigs.*
- **B2. CONFIRMED — Solana address node ids exist in two casings, splitting the graph.** `build-graph.mjs:347` keeps base58 case for `has_address`; `graph-entities.mjs:180` and `graph-entity-edges.mjs:599` lowercase for other edges; `build-graph.mjs:784` lowercases addressRows keys. Live graph: 57 `:solana` ids for 40 real addresses — 17 appear under both casings. Violates `normalizeAddress` (`address-chains.mjs:16-18`, the canonical "leave Solana alone" rule). Any join of `has_address` against `mentions`/address rows disconnects around Solana. (Root of server bug #2.)
- **B3. SUSPICIOUS — Phase 2.7 Table 1 clobbers pre-existing entities; stale `addrToEntityId`.** `build-graph.mjs:423-431,474`. Unlike Tables 2/3 (guarded with `entityMap.has`), the Current-Delegates create path calls `addTableEntity` unconditionally (`entityMap.set` with no existence check) — a delegate whose slug matches a Phase-1 entity silently replaces it, losing original meta. `addrToEntityId` (`:415-420`) is a snapshot, so addresses registered by earlier rows in the same loop are invisible to later rows.
- **B4. SUSPICIOUS — `parseMarkdownTable` merges all tables in a doc under the first table's headers.** `scripts/lib/table-parser.mjs:9-41` treats line 1 as the header for every `|`-line in the content. Single-table today, but the drift detector (`build-graph.mjs:655-666`) runs it over every Active Data doc; future multi-table docs mis-parse with no warning.
- **B5. SUSPICIOUS — `extractEthAddresses` drifted from the canonical regex (no hex-boundary lookarounds).** `table-parser.mjs:44-48` uses `/0x[0-9a-fA-F]{40}/g` while `ETH_ADDR_RE` guards with `(?<![0-9a-fA-F])…(?![0-9a-fA-F])`. A 64-hex tx hash in a table cell yields a bogus "address" (first 40 hex chars) that Phase 2.7 registers.
- **B6. SUSPICIOUS — `fetchImplABIs` always fetches/caches implementation ABIs under chainid 1.** `address-enrich.mjs:211-215`. Proxy implementations on Base/Arbitrum are looked up on mainnet, poisoning `.cache/etherscan/1/` with wrong-chain empties that are never retried. Harmless today only because chain-state is mainnet-only.
- **B7. SUSPICIOUS — `computeLevels` NR recursion has no cycle guard.** `atlas-parser.mjs:234-249`; the emit path carries a "paranoid cycle guard" (`:296`) but the levels path doesn't → stack overflow on a cyclic/self-referential NR target.
- **B8. SUSPICIOUS — `localeCompare` in an artifact-shaping sort risks cross-machine nondeterminism.** `build-graph.mjs:201` decides `entityLabel`/`aliases` written to artifacts; ICU/locale-dependent, so a CI-vs-dev divergence breaks the committed-manifest contract that `REPRO=1` (same machine) can't catch. Same pattern in the census baseline writers (`check-atlas-census.mjs:150`, `check-govops-census.mjs:146`, `check-risk-census.mjs:69`). *Use a code-unit comparator.* (Orchestrator: verified at the cited line.)
- **B9. LOW/SUSPICIOUS — build-index and Phase 2.6 use different chain-preference rules for the same address.** `build-index.mjs:151-153` (first non-ethereum doc wins) vs `build-graph.mjs:193-195` (insertion order). `addresses.json` and `addresses.atlas.json` can disagree on `chain`.
- **B10. LOW — `public/manifest.json` embeds a wall-clock timestamp.** `build-manifest.mjs:81` `generatedAt: new Date().toISOString()` violates the project's own no-timestamps determinism convention in its own provenance file. (Orchestrator: verified.)

### Inefficiency

- **I1. graph-duties recompiles regexes in the hottest loop of the build.** 2s-ter (`graph-entity-edges.mjs:533-570`) runs `findRoleDuties` for ~10,370 docs × 3 roles; `allValidMatches`/`firstValidMatch` build fresh `new RegExp` per call (~250k compiles/build), `citationSpans` re-scans per role (3× redundant, role-independent), org matchers rebuilt per doc×org. *Compile `g`-variants once, reset `lastIndex`, hoist org regexes, compute citation spans once per doc.*
- **I2. Phase 3 builds full `docRows`/`addressRows` that are never written.** `build-graph.mjs:768-799` slices up to 50 KB/doc × 10,370 docs and does chain-state lookups per address — then only `.length` is used. Dead weight on every build and updater cycle (or a leftover D1-sync payload that should ship).
- **I3. Duplicate ICD classification across phases.** `graph-doc-edges.mjs:85-92` re-runs the exact `buildKnownPrimitives`/`isICD`/`classifyIcd` computation `graph-entities.mjs:431-465` already did.
- **I4. 2j accord matching is O(paramDocs × allDocs).** `graph-entity-edges.mjs:97-103` — `allDocs.find` with `isEcosystemAccord` per candidate inside the executor-param loop. Hoist the few accord docs once.
- **I5. Phase 2.7 delegate enrichment scans all edges per table row.** `build-graph.mjs:464-469` iterates ~16k edges per delegate row.
- **I6. Phase 2.6 re-scans every doc's content with the address regexes build-index just ran.** `build-graph.mjs:156-186`; the redundant *chain detection* is the avoidable half — Phase 2.6 could trust the chain already in `addressesAtlas`.

### Messiness

- `UUID_LINK_RE` copy-pasted: `graph-entity-edges.mjs:65-66` redefines the regex it already imports from `graph-patterns.mjs:83-84`.
- `parseNameList` + member resolution duplicated across `graph-entity-edges.mjs:202-223`, `graph-patterns.mjs:193-204`, `graph-entities.mjs:353-386` — two of three copies can drift.
- Dead map: `graph-doc-edges.mjs:50-61` `citedByDoc` written but never read.
- Unused `entityContext` fields: `graph-entities.mjs:503-517` returns `entityByName`/`resolveAccordMember`/`childrenByDocNo`/`roleBindingTitles`, none consumed.
- Duplicate section numbering: two "1i" and two "1j" sections in `graph-entities.mjs`.
- `build-graph.mjs` (1,019 lines) hosts full extraction phases (Phase 2.7's ~270-line five-table block, Phase 2.5 ICD-param block) that the project's own "each phase in `scripts/lib/`" layout says belong in libs.
- Bare stdlib imports (violates the `node:` convention): `build-glossary.mjs:22-24`, `build-manifest.mjs:15-19`, `build-at.mjs:27-30`, `fetch-chain-state.mjs:20-22`.
- Stale header docs: `build-addresses.mjs:7` documents a nonexistent input; `address-chains.mjs:128` comment says "100 chars" but slices 120; `annotationWindow` hardcodes a duplicate `ANNOT_WINDOW = 300`.
- `matchKeywords` non-global `title.match(SINGLE_RE)` under-reports keywords (`process-keywords.mjs:106-107`).
- `build-graph.mjs:975-984` (Phase 4.5c) resolves parent by doc_no string-stripping — an unannotated cousin of the "fragile: doc_no prefix" pattern.

### Explicitly checked, not a finding
`annotates` via `parentId` at the depth-6 cap (verified correct — `.0.3`/`.0.4` folders are phantom); `parseTree`/`cleanContent`/depth-stack parent resolution reproduce `parse()` faithfully; census scripts + `check-processes-dirty` + `atlas-worker` clean beyond B8.

---

## Part 2 — Frontend (`src/App.tsx`, `src/components/**`, hooks, workers)

### Bugs (ranked)

- **B1. CONFIRMED — ProcessesReport row expand/collapse wipes all active filters.** `src/components/reports/ProcessesReport.tsx:275-278` — `toggle()` rebuilds the URL from scratch (`?expanded=<uuid>`), dropping `status`/`shape`/`category`/`ignored` from `useUrlState`. Contrast `ConstellationsPage.tsx:33-42`, which folds `id` into existing params.
- **B2. CONFIRMED — "show N more" jumps the list back to the top.** `src/hooks/useScrollRestore.ts:19-45` keys saved scroll on the full query string; `SearchResults.tsx:38,207` stores pagination in `n`. Changing `n` changes the key → restore runs with no saved value → `el.scrollTop = saved ?? 0` scrolls to top exactly when the user reaches the end.
- **B3. CONFIRMED — NodeHistory applies stale async results.** `src/components/history/NodeHistory.tsx:51-59` — `loadHistory(nodeId).then(...)` with no `cancelled` flag / id check. Fast A→B navigation shows A's history under B. Every sibling hook has the guard; this one doesn't.
- **B4. CONFIRMED — `useLoaded` has no rejection handling.** (See executive summary #5.) `src/hooks/useAtlasData.ts:16-18`; same at `SearchResults.tsx:82`.
- **B5. SUSPICIOUS — reports read the live atlas while in preview mode.** Preview mounts `<App/>` under a preview `DataSourceContext` (`PreviewGate.tsx:99-112`), but every report loads with the default base (`RewardsReport.tsx:111`, `StaleDatesReport.tsx:110`, `ActiveDataReport.tsx:75-76`, `OpFacilitatorsReport.tsx:48-49`, `OpGovOpsReport.tsx:48-49`, `ProcessesReport.tsx:209`, `SearchResults.tsx:82`). Radar does it right (`RadarPage.tsx:30-31`). Under a preview banner, radar shows the proposed atlas while reports show live data.
- **B6. SUSPICIOUS — failed KaTeX chunk load is cached forever and rejects unhandled.** `NodeContentInner.tsx:102-114,120-124` — `katexPromise` set once; a flaky dynamic-import failure caches the rejection, no catch, math never renders for the session.
- **B7. CONFIRMED — tree rows are interactive divs without treeitem semantics.** `TreeSidebar.tsx:376-380` sets `role="tree"` but `TreeRow.tsx:152-168` renders plain `div`+`onClick` with no `role="treeitem"`/`aria-expanded`/`aria-selected`/`aria-level`; toggle is a `span`+`onClick`. Screen readers see an empty tree.
- **B8. CONFIRMED (trivial) — typo.** `SearchResults.tsx:126` "Goverance Operators" → "Governance Operators".

### Inefficiency

- **I1. Unmemoized `AtlasActionsContext` provider values defeat `CollapsibleNode`'s memo on the hottest path.** `AtlasView.tsx:71` and `AtlasReader.tsx:182` create fresh context-value objects every render (AtlasView's includes an inline `toggle: () => {}`). Every `CollapsibleNode` calls `useAtlasActions()`, so any reader render re-renders all ~1000+ rows through context, bypassing `memo`. `JuniorPane.tsx:106-109` memoizes correctly; the reader should too (also stabilize `handleExpandAll`).
- **I2. `relations.json` (~1.4 MB) fetched and parsed twice for the reader route.** The graph worker fetches its copy (`graph.worker.ts:36-39`) while `AtlasView.tsx:37` (`useLoaded(loadGraph)`) pulls a second main-thread copy used only for `doc_view` analytics.
- **I3. Side-effectful, always-fresh `expandedSet` memo.** `AtlasReader.tsx:60-65` mutates `seenExpanded.current` inside `useMemo` and returns a new `Set` per `[data, id]` even when unchanged, invalidating `docList`/`fullyExpanded`.
- **I4. `useChatStream` recreates `send`/`stop` every ChatPanel render.** `useChatStream.ts:213` deps include `handlers`; `ChatPanel.tsx:39-42` passes a fresh inline object each render, so the `useCallback`s are no-ops.

### Messiness

- **M1.** Three parallel filter-pill implementations: `FilterPills`/`PrimePills`/`CategoryPills` exist, yet `ProcessesReport.tsx:303-355` and `ActiveDataReport.tsx:160-194` hand-roll near-identical `scope-pill` groups.
- **M2.** RightPanel navigates with `<button onClick>` instead of anchors (`RightPanel.tsx:131-139,164-170,181-187,224-238`) — no middle/cmd-click, against project convention. Also index keys on refilterable lists.
- **M3.** `NodeHistory.tsx:47` `useState<HistoryEntry[] | null>(undefined as unknown as null)` — just pass `null`.
- **M4.** Doc drift: CLAUDE.md calls AtlasView "a flat virtualized list" but `AtlasReader.tsx:113-179` renders every visible node, relying on `content-visibility: auto` (only `TreeSidebar` is virtualized). *Correct the doc.*
- **M5.** Duplicated resize-handle markup: `AtlasAnnotations.tsx:61-73` hand-rolls the same 6px handle `Drawer.tsx:108-122` implements.
- **M6.** Double context layering: `AtlasView.tsx:71` provides `AtlasActionsContext` with a stub `toggle`, then `AtlasReader.tsx:182` re-provides the real one — an indirection that hides I1.

---

## Part 3 — Shared data logic (`src/lib/`)

### Bugs (ranked)

- **B1. CONFIRMED — graph worker init failure hangs every consumer forever.** (Executive summary #4.) `src/lib/graph.ts:114-121,155-168`. Contrast `docs.ts:98-99`, which drops its worker cache on failure.
- **B2. CONFIRMED — apostrophes parsed as case-sensitive phrase quotes, zeroing results.** (Executive summary #6.) `src/lib/searchHighlight.ts:102-106` → `search.worker.ts:161,243-255`.
- **B3. SUSPICIOUS — cross-base contamination of the module-global doc_no reference index.** `src/lib/docs.ts:33-39` — `knownNodeIds`/`docNoIndex` are module-global but `registerRefs` is fed by every bundle including preview. After viewing a renumbering-PR preview, `resolveAtlasRef("A.2.3")` (consumed by `NodeContentInner.tsx:43`) can resolve a live doc_no to the preview's node id.
- **B4. SUSPICIOUS — glossary loader has no `res.ok` check.** `src/lib/glossary.ts:22-28` uses raw `fetch` (not `fetchJson`); a JSON-bodied 4xx/5xx gets cached as the glossary, and it bypasses `StaleAtlasError`/force-forward. (Also reported by cross-cutting as #6.)
- **B5. SUSPICIOUS — chain-state failure cached as permanently empty.** `src/lib/chainstate.ts:16-22` — `.catch(() => ({block:"",values:{}}))` resolves the module promise with the empty fallback and never clears `cached`. One blip → no on-chain values for the session. (Orchestrator: verified.)
- **B6. SUSPICIOUS — per-node history cache poisons on transient failure.** `src/lib/history.ts:93-96` maps any rejection to `null` and caches per nodeId; the batch path (`:130-137`) explicitly guards against exactly this, the single-doc path doesn't.
- **B7. SUSPICIOUS — CSV export breaks on embedded double quotes.** `src/lib/activeDataIndex.ts:352-365` wraps fields in `"` but never doubles embedded `"`. Any quoted title/RP text shifts every subsequent column in Excel/Sheets. (Orchestrator: verified.)
- **B8. SUSPICIOUS — highlighter can mark inside HTML entities.** `src/lib/searchHighlight.ts:16-39` escapes then runs patterns over the escaped string; a term like `amp`/`quot`/`lt`/`gt` produces `&<mark>amp</mark>;` rendered via `innerHTML`.
- **B9. SUSPICIOUS — concurrent scroll glides fight each other.** `src/lib/animatedScroll.ts:11-25` — `glide` has no cancellation token; two calls within 220ms leave two rAF loops writing `scrollTop`.
- **B10. SUSPICIOUS — rewardsIndex builds doc_nos by arithmetic, unannotated.** `src/lib/rewardsIndex.ts:199,202,54-55` — `.2.5.1`/`.2.5.2`/`.3.4`/`.4.4` are **not** spec-defined structural suffixes; this is the editorial-layout coupling the UUID rule forbids, and unlike `activeDataIndex.ts:96` it carries no `// fragile: doc_no prefix` annotation. An agent-artifact reshuffle silently empties the DR/IB sections of `/reports/rewards` and radar. (Orchestrator: verified.)
- **B11. SUSPICIOUS — single-executor assumption in `buildChainMap`.** `src/lib/activeDataIndex.ts:125` `execEdges.find(e => e.t === prime.id)` picks an arbitrary first executor; `actorIndex.ts:195` handles multiple. Same pattern in `reportChains.ts:37`, `rewardsIndex.ts:108`.

### Inefficiency

- `facilitatorResponsibilities.ts:68-69` and `govopsResponsibilities.ts:72-73` rebuild `docByDocNo` with a full `Object.values(docs)` scan though the bundle already carries `docNoToId`. Free O(n) win, twice.
- `actorIndex.ts:244-286` — `buildActorProfile` builds `edgesFrom`/`edgesTo` then does four more full `graph.edges` scans; all of it rebuilt per slug navigation.
- `rewardsIndex.ts:258` — `participants.find` inside the per-agent map when `ctx.entityById` answers in O(1).
- `reportChains.ts:30,67,95` — `buildChains`/`holderExecutorSlugs`/`rolePills` each rebuild `entityById`; `resolveChain` scans `ctx.edges` twice per prime.

### Messiness

- **Four parallel implementations of the prime→executor→fac/gov chain walk** (`activeDataIndex.buildChainMap:111`, `actorIndex.buildActorProfile:192-228`, `rewardsIndex.resolveChain:107`, `reportChains.buildChains:29`) that differ subtly — B11 is a direct consequence.
- `govopsResponsibilities.ts:96` hardcodes exec-edge strings inline; its mirror uses `EXEC_EDGES` — looks like drift from `roleEdges.ts`.
- `primitiveStats.ts:109,201` uses the entity id as a doc id; works only because prime-agent entities happen to have `id === defining_doc_id`.
- `searchHighlight.ts:5-9 vs :22` — comment promises `\w*` word-extension, code applies bare substring.
- `entityById = new Map(participants.map(...))` re-derived in 8+ modules.
- Loader-pattern inconsistency: glossary uses raw `fetch`, addresses/graph use `fetchJson`+`handledStale`, chainstate/history swallow into fallbacks — five different failure policies in one directory.
- `atlasHelpers.ts:34` `buildAncestors` returns `[]` for `NR-` docs, dropping breadcrumb/analytics ancestors.
- `facilitatorResponsibilities.ts:167-184`/`govopsResponsibilities.ts:198-215` — active-data section never consults `seenDocIds`, so a doc that is both a duty and an active-data RP double-lists.

**Notably clean:** `staleDates.ts`, `diffCore.ts`, `oeaReport.ts`/`riskAssessmentIndex.ts` (correct cache-eviction), and the `addresses.ts` merge.

---

## Part 4 — Server (`src/server/`, ~70 files)

### Bugs (ranked; auth/injection/data-corruption first)

- **1. CONFIRMED — PostHog proxy incidentally forwards the browser auth cookie to a third party.** (Executive summary #1.) `src/server/posthog-proxy.ts:58-63` — on browser posthog-js traffic the `sky_session` JWT rides through unstripped. Unrelated to MCP session grouping (which uses the `mcp-session-id` header, not this cookie, and never traverses this proxy). *Add `cookie`/`authorization` to `DROP_HEADERS`; don't hash — browser grouping already works via `$session_id`.*
- **2. CONFIRMED — Solana address case destroyed by sync → updater loopback.** (Executive summary #2.) `src/server/sync.ts:109`, `src/server/atlas-updater.ts:177-186`. Also `chainStateByAddr[addr.toLowerCase()]` (`sync.ts:95`) can never match a Solana `chain-state.json` key. (MCP `atlas_get_address` masks the corruption by lowercasing its query too.)
- **3. SUSPICIOUS — preview rate limiter likely keyed to the proxy's IP.** `src/server/preview/handler.ts:256` uses `server.requestIP(req)?.address` (socket peer). Behind Railway's edge every request shares the LB address, making `rateLimited()` (30 req/10 min) one global bucket. *Parse a trusted `X-Forwarded-For`.*
- **4. SUSPICIOUS — in-place index mutation breaks the snapshot guarantee for in-flight async handlers.** `src/server/atlas-refresh.ts:68-131` (`patchDocs`/`applyInPlaceUpdate`) mutate the live `Indexes`; `indexes.ts:259-265` documents the swap model as snapshot-safe, true only for the `setIndexes` fallback path. `atlasSearch` (`tools.ts:121-137`) and the chat loop (`chat.ts:93`, holds one `ix` across ≤6 LLM rounds) can observe a mid-request mutation → mixed-version responses (not crashes). The comment's invariant is false as written.
- **5. CONFIRMED — preview `diffCache` grows without bound.** `handler.ts:54,197,206` keyed `${previewSha}:${mainSha}`, never evicted. Same file caps `resolveCache` (1000) and sweeps `ipHits` — this one was missed.
- **6. SUSPICIOUS — silent degrade of the swapped-address fork screen.** `preview/build.ts:148-162` `countNewAddresses` `catch { return 0 }`. If main's `addresses.atlas.json` is momentarily torn (updater writes it non-atomically, `atlas-updater.ts:186`) or unparseable, a fork that *does* introduce new payment addresses reports `newAddresses: 0` — the exact banner this screen exists for (swapped-payment-address attack) shows nothing.
- **7. CONFIRMED — malformed preview id → uncaught `URIError` → 500.** `handler.ts:257` `decodeURIComponent(a)` throws on invalid percent-encoding (`GET /api/preview/%E0%A4%A/events`), propagating an unhandled 500 instead of a 404. (Orchestrator: verified — no surrounding try/catch on the route branch.)
- **8. CONFIRMED (bounded) — preview SSE unsubscribe race leaks subscribers.** `handler.ts:121-152` — `unsub` starts as a noop, assigned only when `drive()` resolves; a client cancel during the await calls the stale noop, so the real unsubscribe never runs and the dead `send` stays in `subscribers` until the build ends.
- **9. SUSPICIOUS — case-variant address keys can abort the whole sync transaction.** `sync.ts:104-127,161-177` — `addrRows` keyed by lowercased address from original-case artifact keys; two keys differing only in case for the same `(address, chain)` hit "cannot affect row a second time" and roll back the entire structural sync. *Dedupe `addrRows` by `(address, chain)` after lowercasing.*
- **10. SUSPICIOUS — chat reuses the MCP output budget, which can exceed the chat model's context.** `output-budget.ts:8` `MCP_MAX_RESULT_CHARS` = 200,000 (~50k tokens) applied to chat tool results (`chat-loop.ts:134`). `config.chatModel` defaults to `qwen/qwen3-32b`; one bulk tool round can exceed context → the next completion fails and the turn dies after streaming.
- **11. CONFIRMED (low) — no length cap on chat input.** `chat.ts:61` validates only `body.message?.trim()`; a multi-MB message is persisted and shipped, and the rate-limit gate counts only past usage so the first oversized request always lands.
- **12. SUSPICIOUS (low) — preview build quota is check-then-act.** `preview/build.ts:220` reads the count before `upsertPreview` commits; bounded by `previewMaxConcurrentBuilds` (2).

### Inefficiency

1. `atlasTraverse` is O(hops × V × E) — `tools-graph.ts:55-74` re-scans the flat `ix.edges` for every dequeued node while a graphology adjacency (`ix.graph`) sits unused. On the unauthenticated `/mcp` endpoint. *Use `graph.forEachOutEdge/forEachInEdge`.*
2. Chat resends the full conversation every turn; compaction is dead schema — `chat.ts:89-97` reloads every message; `migrations/003_chat.sql` `summary`/`summary_upto_id` are written by nothing.
3. `atlas_pr`/`pr_number` filters have no index — `tools-history.ts:134-142` seq-scans `atlas_history`.
4. `/api/health` + `/api/freshness` do two serial DB queries per poll — `freshness.ts:95-115` (already `TODO(#7)`).
5. `embedQuery` has no cache — `embed.ts:58`, every semantic search is a fresh OpenRouter round-trip (≤5 attempts / ~15s backoff).
6. SPA fallback re-reads `index.html` from disk per request — `index.ts:184`.
7. `atlasDescribe` computes heavy opt-in sections unconditionally — `tools.ts:29-56`.
8. `entity_broad` inner `find` is O(n²) — `query.ts:236`.

### Messiness

1. Inconsistent error response shapes across routes (`history.ts:93,108` empty body; `chat.ts:26`/`preview/handler.ts:231` `{error}` JSON; `index.ts:44` null; `index.ts:128` plain text).
2. `change_type` mapping duplicated three times (`history.ts:9-14`, `tools-history.ts:12-16`, `history-db.ts:13`).
3. `UUID_RE` re-defined locally in `tools-history.ts:9` vs the shared `src/lib/patterns.ts`.
4. Pointless dynamic `await import("./indexes.ts")` at `tools-history.ts:191` in a file that already statically imports it.
5. Env handling scattered despite `config.ts` — direct `process.env` reads in `atlas-updater.ts`, `freshness.ts`, `output-budget.ts`, `bundle-store.ts`, `preview/*`, `posthog-capture.ts`.
6. Chain-state parsing duplicated (`sync.ts:90-102` vs `build-graph.mjs:110-126`).
7. gzip-negotiation duplicated (`index.ts:157-168` vs `bundle-store.ts:189-216`).
8. Offline-only modules live in `src/server/` (`history-curate.ts`, `history-timeline-db.ts` imported only by `scripts/htmlhist/*`).
9. The long `atlas_history` SELECT column list is duplicated four times with variations.

### Verified-clean (checked, no finding)
SQL injection (all `sql.unsafe` sites build only `$N` placeholders; user values ride params); path traversal (bundle stores gate `name` by allowlist, `sha` by `^[0-9a-f]{40}$`); transactions (structural sync is one txn with `sync_state` last; migrations advisory-locked + idempotent); chat loop (`maxIterations` cap, forced final `tool_choice:"none"`, abort propagation); auth (`/api/chat` + `/api/usage` gate on `getSessionUser`, ownership verified, OAuth state/PKCE sound; `/mcp`/history/preview deliberately public).

---

## Part 5 — Cross-cutting (config, artifact contracts, test gaps)

> The reviewer's dedicated env-var and test-coverage sub-audits did not fully return; env-var and test-gap items below are its own direct spot checks. Dead-files / duplicate-types / circular-imports completed fully.

### Bugs / structural risks (ranked)

- **1. CONFIRMED — the in-process updater's DB→disk rebuild silently drops `addressRefs` from every node.** `src/server/indexes.ts` `docRowToNode` + `atlas-updater.ts:146-172`. `atlas_doc_meta` has no `address_refs` column; nothing downstream recomputes it. After the first post-deploy atlas advance, every bundle node loses `addressRefs` — RightPanel address cards vanish and chainlog reverse search returns nothing, silently. Enabled by the duplicate `AtlasNode` (optional `addressRefs` in `indexes.ts:25` vs required in `src/types.ts:23`).
- **2. CONFIRMED — same path drops `contentHash` → OEA report marks every row "stale" after the first updater cycle.** The SELECT (`atlas-updater.ts:146-150`) omits `content_hash` (which `sync.ts` stores); `oeaReport.ts:63-70` compares `undefined` to the stored hash → every row flips `stale`. *Fix: add `content_hash AS "contentHash"` to the SELECT and map it in `docRowToNode`.* (Orchestrator re-read the current SELECT and `docRowToNode` in the resumed session — the fields are still omitted; the "stays in lockstep… never silently drops a field" comment on `DocMetaRow` is contradicted by the code.)
- **3. CONFIRMED — `tsconfig.server.json` has no `"strict": true`.** The entire Bun server (auth, SQL, chat, MCP, preview) typechecks non-strict while `tsconfig.app.json`/`tsconfig.test.json` are strict; CI's server job enforces the weak config. `tsconfig.node.json` is also non-strict.
- **4. CONFIRMED — `vitest.config.ts:20` `environmentMatchGlobs` was removed in Vitest 3/4** (zero occurrences in installed vitest 4.1.5) and is silently ignored. Component tests only work via per-file `// @vitest-environment jsdom` pragmas; a new test trusting the config comment gets `document is not defined` or silently passes under node.
- **5. SUSPICIOUS — `Dockerfile:11-12`/`Dockerfile.worker` run `bun install` with no committed `bun.lock`.** (Orchestrator confirmed `bun.lock` absent.) Direct deps are exact-pinned but the transitive graph re-resolves every image build; a broken transitive release can ship to prod while CI (pnpm-lock, frozen) stays green.
- **6. CONFIRMED — `src/lib/glossary.ts:22` raw `fetch` with no `res.ok` / `StaleAtlasError`.** (Also shared-lib B4.) On a pruned sha other loaders force-forward; glossary parses a JSON-bodied 404 as the glossary.
- **7. CONFIRMED — CI never exercises the production build path.** The Dockerfile's inline build (index→graph→glossary→oea-report→bundle→ts→vite) and `build-bundle.ts`/`bundle-store.ts` run only on Railway; `e2e.yml` triggers only on `deployment_status` success, so a broken deploy yields no red check. `ci.yml` builds only index/glossary/graph — `build:manifest`/`build:oea-report`/`build:bundle`/`build:at`/`snap:chainstate` never run in any gating workflow.
- **8. CONFIRMED — `scripts_tests/artifacts.test.ts:18,136` artifact-gated assertions silently no-op when the artifact is absent.** Combined with #7, consistency checks touching manifest.json/oea-report.json have never actually executed in CI.
- **9. CONFIRMED — convention-only "KEEP IN SYNC" contract with no test.** `SHALLOW_MAX_DEPTH` duplicated at `build-index.mjs:198` and `indexes.ts:70`; the two docs-split writers' node shapes are not parity-tested (contrast the enforced MiniSearch-options parity test). A `docRowToNode` round-trip test would have caught #1–2.

### Messiness

- **10.** `package.json` `build:railway` is dead and drifted (referenced nowhere; includes `build:manifest` the Dockerfile omits). (Orchestrator confirmed via grep.)
- **11.** Duplicate type declarations: `indexes.ts:15` `AtlasNode` vs `src/types.ts:11` (optional vs required `addressRefs` — root of #1); `indexes.ts:31` vs `sync.ts:22` `DocMetaRow` (camelCase/`order` vs snake_case/`ord`/`content_hash`); `indexes.ts:82/93` `Entity`/`Edge` vs `GraphEntity`/`RelationEdge` (DB vs compact payload form, undocumented).
- **12.** `tsconfig.app.json` excludes `src/**/*.test.ts` but not `.test.tsx`, and excludes a nonexistent `src/server.ts`.
- **13.** Two type-only 2-node import cycles: `ChatWidget.tsx:5` ↔ `ChatPanel.tsx:11` (`type Placement`); `PreviewHome.tsx:4` ↔ `PreviewPrTabs.tsx:3` (`type Entry`).
- **14.** Stale comment `indexes.ts:269` claims `meta.atlasCommit` is re-read from manifest.json; `readArtifactsFromDisk` reads graph.json/docs.json.

### Inefficiency

- **15.** Runtime Docker image ships devDependencies (`Dockerfile` copies the builder's full `node_modules` — vite, playwright, typescript, jsdom — into the lean runtime stage).
- **16.** knip is configured (`knip.json`, `pnpm knip`) but wired into no workflow. (Manual scan found no unused deps or version conflicts.)
- **17.** `.dockerignore` omits `.claude/worktrees/`, `graph-snapshots/`, `e2e/`, `docs/` — local `docker build` context bloat.

### Dead files / test coverage / env vars

- **Dead files: none (CONFIRMED).** Full import-graph BFS from all entry points reached every non-test file in `src/` and `scripts/lib/`.
- **Test infra present:** ~60 colocated vitest units (jsdom pragmas), `scripts_tests/` (27 files incl. parser/graph/history/REPRO/search-options-parity), `bun test src/server` (13 files, CI), `graph-snapshots/` (CI), `e2e/` Playwright (deploy-gated only).
- **Highest-risk untested surfaces (verified directly):** the `docRowToNode`/docs-split round-trip (#1–2, 9); `atlas.worker.ts:13-51` `resolveParentId` (nontrivial doc_no-suffix remapping, zero direct tests); `bundle-store.ts` publish/prune (only in Docker builds). The three workers appear to have no direct tests (SUSPICIOUS, not exhaustively confirmed).
- **Env vars (partial):** undocumented outside code comments — `BUILD_SKIP_SEARCH_INDEX`, `ATLAS_SRC_DIR`/`ATLAS_OUT_DIR`/`ATLAS_COMMIT`, `API_PORT`, `PREVIEW_CACHE_KEEP`, `ATLAS_UPDATE_ENABLED`. (The env sub-audit reported 9 read-but-undocumented and 2 documented-but-never-read; that fuller list did not survive in the parent transcript.)

---

## Part A — Architectural changes (high-leverage)

*The orchestrator was cut off before writing this synthesis; the items below are drawn directly from the recurring cross-subsystem patterns the reviewers found.*

1. **One canonical chain-walk module.** Four parallel prime→executor→fac/gov implementations (`activeDataIndex`, `actorIndex`, `rewardsIndex`, `reportChains`) drift on multi-executor handling — shared-lib B11 is the direct symptom. Extract one chain module with options; kills the drift and centralizes the `entityById` map re-derived in 8+ places.
2. **Make the DB→disk updater path shape-complete and test it.** The single root cause behind three high-severity bugs (#1, #2, OEA staleness) is that `docRowToNode` / the updater SELECT silently diverge from the build-time node shape. Unify the `AtlasNode`/`DocMetaRow` type (one declaration, required fields), add the missing columns, and add a round-trip parity test — the same pattern already enforced for MiniSearch options and `SHALLOW_MAX_DEPTH` would have caught all three.
3. **Normalize address casing at one boundary.** Solana case corruption appears independently in the graph build (BUILD B2), sync (SERVER #2), and the sync transaction abort risk (SERVER #9). Route every address through `normalizeAddress` at ingestion and keep it canonical end-to-end.
4. **One loader failure policy.** Five sibling loaders in `src/lib/` (glossary, chainstate, history, graph, addresses) have five different failure behaviors — several cache failures permanently. Standardize on `fetchJson` + `handledStale` + cache-eviction-on-failure.
5. **Split `build-graph.mjs` (1,019 lines) into `scripts/lib/` phases**, per the project's own layout convention — the Phase 2.7 table block and Phase 2.5 ICD-param block are full extraction phases living in the orchestrator.
6. **Gate the production build path in CI.** The Railway Docker build (bundle/manifest/oea-report) runs in no gating workflow and E2E only fires on deploy success — a whole class of regressions can only be caught after they ship.

## Part B — Quick wins (small, safe, high value/effort)

- Add `cookie`/`authorization` to `posthog-proxy.ts` `DROP_HEADERS` (**stops a session-token leak** — do first).
- Add `content_hash AS "contentHash"` to the updater SELECT and map it in `docRowToNode` (un-breaks the OEA report after hot refresh).
- Fix the "Goverance Operators" typo — `SearchResults.tsx:126`.
- Wrap the preview `decodeURIComponent(a)` (`handler.ts:257`) in try/catch → 404 instead of 500.
- Cap chat input bytes before persisting — `chat.ts:61`.
- Add `.catch` cache-eviction to `useLoaded` (`useAtlasData.ts:16-18`) and `SearchResults.tsx:82` (kills forever-spinners).
- Add a `cancelled`/id guard to `NodeHistory.tsx:51-59` (matches every sibling hook).
- Fold existing URL params into `ProcessesReport.toggle()` (`:275-278`) instead of rebuilding the URL.
- Replace `localeCompare` in `build-graph.mjs:201` (and the census baseline writers) with a code-unit comparator (protects the reproducibility/manifest contract).
- Memoize the `AtlasActionsContext` provider values in `AtlasView.tsx:71`/`AtlasReader.tsx:182` (removes a ~1000-row re-render on every reader interaction).
- Evict `diffCache` in `preview/handler.ts` (add a cap like the sibling `resolveCache`).
- Dedupe `addrRows` by `(address, chain)` after lowercasing in `sync.ts` (prevents a whole-sync rollback).
- Fix the apostrophe/case-phrase parse in `searchHighlight.ts:102-106` (require whitespace/start before the opening quote) so contractions don't zero out results.
- Correct the CLAUDE.md "flat virtualized list" description of AtlasView (it isn't virtualized).
