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
