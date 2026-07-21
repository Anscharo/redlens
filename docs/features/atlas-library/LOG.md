# Atlas Library — work log

Append-only. Newest entry LAST. Every commit on `atlas-library` gets a note here; a
fresh session reads PROMPT.md first, then this file bottom-up. Update this file in the
same commit as the change when practical, or the next one.

## 2026-07-20 — session 1 (feature start)

Branched `atlas-library` off `main` (post risk-report-rendering merge, atlas db87434).

### Research + plan (pre-branch, committed in 7e5bed76)
- `docs/atlas-map.md`: chunk taxonomy v1. Key findings: 69% of docs live in A.6 agent
  artifacts; spec/instance split (A.2.2 primitive classes vs per-agent copies); prime
  artifact anatomy Introduction/Sky Primitives/Omni Documents → families → primitives →
  hub/instances/invocations; 494-entity layer; depth-6 cap flattens parentId inside
  artifacts. Staleness probe: 8–12 of 17 active-instance dirs per prime are EMPTY
  scaffolding (Spark/Grove most live, Launch Agent 7 most hollow).
- `docs/plans/atlas-library.md`: product plan — /library with Shape / Contents / Chunk
  pages / Glossary; 7 staleness signals; phases P0 (seed) → P4 (scholarship).

### Commits

- **7e5bed76** "Add Atlas Library section: shape, contents, and glossary pages"
  P0 + first UI. Generated docs/library/{toc,shape,glossary}.md via scripts/aux/atlas-shape.mjs;
  /library routes + LibraryPage tabs + Shape/Contents/Glossary pages; homepage card;
  patch-notes bullet; `public/library.json` added to .gitignore (atlas-artifact convention).
- **7633830f** "Wire library.json into the build pipeline and live-update path"
  User asked how updates flow; answer: worker → sync_state.atlas_sha → in-process updater
  → per-sha bundle → SSE. library.json was deploy-only + flat-root-loaded (two staleness
  bugs). Fixed: scripts/required/build-library.mjs (+ shared scripts/lib/library-shape.mjs),
  pnpm build chain, Dockerfile (+gzip), updater runRefreshFromDb, bundle allowlist,
  manifest, dev preflight; loader → liveAtlasBase()+handledStale. Artifact timestamp-free
  (REPRO verified: two builds, identical sha256).
- **bd228911** "Segment the library weight bars by sub-element composition"
  User request: bars broken into sub-sections, biggest-left, shade gradient. Added
  `segments` to library.json rows; SegmentedBar with descending opacity + thin-tail merge
  ("N smaller sections") to kill barcode noise on short bars.
- **e4b4c591** "Use the app Tooltip (instant) for weight-bar segments"
  Swapped native title → shared Tooltip component; delay={0} for segments ONLY (app
  default 800ms untouched — user explicit about that).
- **085a2cdb** "Make scope rows expandable with reader link icons"
  Scope section only (user said "only this section for now"): plain-text title toggles
  expansion, link-out SVG icon carries the reader link, expanded articles get PlainBar
  scaled to the WHOLE Atlas + caption. SegmentedBar split to own file (size convention).
- **c825efd3** "Replace flat chunk groups with a recursive chunk tree"
  User caught the flaw: Agent artifacts had no breakdown (single-root group → degenerate
  single segment) and taxonomy was flat. Reassessed: semantic doc_no tree (parentId flat
  past depth cap), recursive chunkTree (MIN_CHUNK_DOCS=5, 2,041 nodes, ~293KB raw),
  single-child hoisting at group roots, LibraryChunkTree bars-with-sub-bars (sibling
  scaling, %-of-Atlas, segments mirror children). Removed groups/primes/executors from
  library.json (still computed for md docs). Revealed: Spark's Supply Side primitives
  alone = 14% of the whole Atlas.

### State at end of session 1
- Dev server running: CHOKIDAR_USEPOLLING=1 DEV_NO_DB=1 pnpm dev (no Docker on this
  machine; inotify limit → polling; footer sha display stale — PRE-EXISTING bug, not ours).
- All committed; working tree clean except pre-existing strays (.cache/*.mjs debug
  scripts, docs/plans/Agent-system.md — NOT ours, leave alone).
- Not yet done: push/PR (repo pushes as darkstar-covenant; ASK USER before first push).
- Next: see PROMPT.md "Next steps" (P1 registry + drift guard, staleness badges, chunk
  digest pages).

- **(this commit)** "Add feature folder: continuation prompt + work log"
  docs/features/atlas-library/{PROMPT.md,LOG.md} — recovery point for context loss; user
  asked for commit-cadence + logging discipline going forward. Also saved a pointer
  memory (auto-memory: project_atlas_library_branch) so future sessions find this folder.

- **(next commit)** "Guard /library against artifact/app version skew"
  User hit "page failed to load / reading 'map'": tab open across the chunkTree change —
  module-cached pre-chunkTree library.json + HMR-swapped new components. Hard refresh
  fixes the tab; real fix: loadLibrary now validates the artifact shape (chunkTree/
  scopes/toc arrays) and throws a readable "reload the page" error instead of letting
  the page crash in the ErrorBoundary. Same skew can happen in prod (JS bundle and
  atlas artifact update independently). Note: old per-sha bundle dirs (72d03fd, f114a09)
  predate library.json and lack it — harmless, nothing references them; 404 there would
  StaleAtlasError→reload by design. Pre-existing oddity (NOT ours): /api/health reports
  72d03fd while HTML injects db87434 on this dev box.

- **(next commit)** "Bust immutable cache on library.json schema changes"
  Previous guard was necessary but not sufficient: user STILL saw the error after
  refresh because per-sha artifact URLs ship `cache-control: immutable, max-age=1y`
  and the flat→chunkTree change altered bytes UNDER THE SAME atlas sha → browsers
  keep the year-cached old artifact. Fix: SCHEMA_V const in src/lib/library.ts,
  fetched as library.json?v=N — bump in the same commit as any breaking LibraryData
  change (the shape guard remains the backstop). RULE FOR FUTURE SESSIONS: never
  change a per-sha artifact's shape without a cache-key change.

- **(next commit)** "Skip wrapper levels; unify scope view with the chunk tree"
  User: A.6 (7,459) expanding to only A.6.1 (7,458) with a 3/4 bar was confusing —
  wanted obvious chunks (Spark, Grove…). Two defects fixed: (1) chunkNode now hoists
  pass-through levels generally (single pruned child → descend until real branching),
  so A.6 opens to prime/executor lists, then the agents; (2) deleted the special-case
  LibraryScopeMass (its children were whole-Atlas-scaled while parents were
  sibling-scaled — mixed visual grammar). "Doc mass by scope" now renders scopeTree
  through the same recursive LibraryChunkTree (rootDocNo prop shows A.N on roots).
  library.json: scopes→scopeTree (SCHEMA_V=3 per the immutable-cache rule). Side
  benefit: semantic counts fixed A.1 (948, was 960 — the 12 NR docs no longer
  miscounted under A.1 by the parentId ancestor stack). PlainBar removed.

- **(next commit)** "Self-heal library schema mismatch with one auto-reload"
  User hit the guard message AGAIN after the scopes→scopeTree change — old-JS tab vs
  new artifact. Guard was correct but manual. Now: shape mismatch triggers ONE
  window.location.reload() (sessionStorage latch "library-schema-reloaded" prevents
  loops; latch cleared on successful load; second failure shows a readable error).
  Server + fresh-browser verified fine before this — the error only ever appears in
  tabs spanning a schema change.

## 2026-07-21 — session 1 continued (concept mining, "go all night" directive)

User directive: exhaustive cross-cutting concept discovery; wrote self-prompt
(CONCEPT-MINING.md, commit 889895a9) then executed: local censuses (title
templates ×174, normative language 1301 docs, math 120, registries 46, cite
hubs), MCP priors (30 Type Specifications, entity/edge inventories), 3 parallel
ask-atlas deep dives (normative / economic / instruments). Two agents died on
API errors mid-report; resumed via SendMessage and both delivered.

Deliverable: docs/library/concepts.md — Part I catalog (A meta / B lifecycle /
C procedural / D instruments+normative / E quantitative / Ep economic programs /
F entities / G duties / H registries / I cite hubs), Part II indexes (spread
matrix, signature types, lifecycle, process-category cross-check, containment,
duplication), Part III distinctions + dead ends + ghost layer.

Landmark discoveries (verified by census unless noted):
- 32/46 registries are EMPTY shells incl. all 26 reward payment lists — the
  Atlas's transactional record layer is unrealized.
- Ghost layer: 6+ spec'd-but-unused doc types (Budget/Translation/Archive…);
  budgets run as plain Core docs instead (24 docs, incl. three 0-USDS budgets).
- Most-cited doc = Distribution Reward Routine Protocol (22); true gravity
  centers are reward routine + Tau/BEAM params + emergency signaling.
- Normative families chain into a justice pipeline (eligibility→duty→breach→
  adjudication→suspension→derecognition); all 854 duty_for edges source in A.1.
- Omni Documents = the anti-template (agent-idiosyncratic; Spark 428 docs incl.
  "Confidential Strategic Integrations"); resolves atlas-map open question.
- NR numbering has gaps (6,11,13–16 missing) — resolved/deleted research items.
- CAUTION: normative agent's counts were pipeline-inferred garbage (claimed
  200–400 ADCs vs real 64) — merged its taxonomy only, corrected all numbers.
  Economic agent's report largely verified against censuses.
