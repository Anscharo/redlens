# Atlas Anatomy — work log

Append-only. Newest entry LAST. Every commit on `atlas-anatomy` gets a note here; a
fresh session reads PROMPT.md first, then this file bottom-up. Update this file in the
same commit as the change when practical, or the next one.

## 2026-07-20 — session 1 (feature start)

Branched `atlas-anatomy` off `main` (post risk-report-rendering merge, atlas db87434).

### Research + plan (pre-branch, committed in 7e5bed76)
- `docs/atlas-map.md`: chunk taxonomy v1. Key findings: 69% of docs live in A.6 agent
  artifacts; spec/instance split (A.2.2 primitive classes vs per-agent copies); prime
  artifact anatomy Introduction/Sky Primitives/Omni Documents → families → primitives →
  hub/instances/invocations; 494-entity layer; depth-6 cap flattens parentId inside
  artifacts. Staleness probe: 8–12 of 17 active-instance dirs per prime are EMPTY
  scaffolding (Spark/Grove most live, Launch Agent 7 most hollow).
- `docs/plans/atlas-anatomy.md`: product plan — /anatomy with Shape / Contents / Chunk
  pages / Glossary; 7 staleness signals; phases P0 (seed) → P4 (scholarship).

### Commits

- **7e5bed76** "Add Atlas Anatomy section: shape, contents, and glossary pages"
  P0 + first UI. Generated docs/anatomy/{toc,shape,glossary}.md via scripts/aux/atlas-shape.mjs;
  /anatomy routes + AnatomyPage tabs + Shape/Contents/Glossary pages; homepage card;
  patch-notes bullet; `public/anatomy.json` added to .gitignore (atlas-artifact convention).
- **7633830f** "Wire anatomy.json into the build pipeline and live-update path"
  User asked how updates flow; answer: worker → sync_state.atlas_sha → in-process updater
  → per-sha bundle → SSE. anatomy.json was deploy-only + flat-root-loaded (two staleness
  bugs). Fixed: scripts/required/build-anatomy.mjs (+ shared scripts/lib/anatomy-shape.mjs),
  pnpm build chain, Dockerfile (+gzip), updater runRefreshFromDb, bundle allowlist,
  manifest, dev preflight; loader → liveAtlasBase()+handledStale. Artifact timestamp-free
  (REPRO verified: two builds, identical sha256).
- **bd228911** "Segment the anatomy weight bars by sub-element composition"
  User request: bars broken into sub-sections, biggest-left, shade gradient. Added
  `segments` to anatomy.json rows; SegmentedBar with descending opacity + thin-tail merge
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
  single-child hoisting at group roots, AnatomyChunkTree bars-with-sub-bars (sibling
  scaling, %-of-Atlas, segments mirror children). Removed groups/primes/executors from
  anatomy.json (still computed for md docs). Revealed: Spark's Supply Side primitives
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
  docs/features/atlas-anatomy/{PROMPT.md,LOG.md} — recovery point for context loss; user
  asked for commit-cadence + logging discipline going forward. Also saved a pointer
  memory (auto-memory: project_atlas_anatomy_branch) so future sessions find this folder.

- **(next commit)** "Guard /anatomy against artifact/app version skew"
  User hit "page failed to load / reading 'map'": tab open across the chunkTree change —
  module-cached pre-chunkTree anatomy.json + HMR-swapped new components. Hard refresh
  fixes the tab; real fix: loadAnatomy now validates the artifact shape (chunkTree/
  scopes/toc arrays) and throws a readable "reload the page" error instead of letting
  the page crash in the ErrorBoundary. Same skew can happen in prod (JS bundle and
  atlas artifact update independently). Note: old per-sha bundle dirs (72d03fd, f114a09)
  predate anatomy.json and lack it — harmless, nothing references them; 404 there would
  StaleAtlasError→reload by design. Pre-existing oddity (NOT ours): /api/health reports
  72d03fd while HTML injects db87434 on this dev box.

- **(next commit)** "Bust immutable cache on anatomy.json schema changes"
  Previous guard was necessary but not sufficient: user STILL saw the error after
  refresh because per-sha artifact URLs ship `cache-control: immutable, max-age=1y`
  and the flat→chunkTree change altered bytes UNDER THE SAME atlas sha → browsers
  keep the year-cached old artifact. Fix: SCHEMA_V const in src/lib/anatomy.ts,
  fetched as anatomy.json?v=N — bump in the same commit as any breaking AnatomyData
  change (the shape guard remains the backstop). RULE FOR FUTURE SESSIONS: never
  change a per-sha artifact's shape without a cache-key change.

- **(next commit)** "Skip wrapper levels; unify scope view with the chunk tree"
  User: A.6 (7,459) expanding to only A.6.1 (7,458) with a 3/4 bar was confusing —
  wanted obvious chunks (Spark, Grove…). Two defects fixed: (1) chunkNode now hoists
  pass-through levels generally (single pruned child → descend until real branching),
  so A.6 opens to prime/executor lists, then the agents; (2) deleted the special-case
  AnatomyScopeMass (its children were whole-Atlas-scaled while parents were
  sibling-scaled — mixed visual grammar). "Doc mass by scope" now renders scopeTree
  through the same recursive AnatomyChunkTree (rootDocNo prop shows A.N on roots).
  anatomy.json: scopes→scopeTree (SCHEMA_V=3 per the immutable-cache rule). Side
  benefit: semantic counts fixed A.1 (948, was 960 — the 12 NR docs no longer
  miscounted under A.1 by the parentId ancestor stack). PlainBar removed.

- **(next commit)** "Self-heal anatomy schema mismatch with one auto-reload"
  User hit the guard message AGAIN after the scopes→scopeTree change — old-JS tab vs
  new artifact. Guard was correct but manual. Now: shape mismatch triggers ONE
  window.location.reload() (sessionStorage latch "anatomy-schema-reloaded" prevents
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

Deliverable: docs/anatomy/concepts.md — Part I catalog (A meta / B lifecycle /
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

- **(next commit)** "Add Concepts tab to /anatomy"
  Concept catalog is now in-app: /anatomy/concepts renders docs/anatomy/concepts.md
  via ?raw bundling + react-markdown (RubricPage pattern — curated content ships
  with deploys, not atlas commits, per the generated-skeleton/curated-flesh
  principle). Full UUIDs in code spans linkify into the reader; short-form
  pointers and doc_nos stay plain (reader ?id= is UUID-only — a doc_no resolver
  would need the atlas bundle; noted as possible follow-up). Patch-notes bullet
  revised (same unreleased feature).

- **(next commit)** "Add DR partner onboarding checklist doc"
  docs/anatomy/dr-partner-onboarding.md — operational checklist from an ask-atlas
  deep dive on "what does Operational GovOps collect from Prime + partner to
  onboard a DR partner". All 28 UUID citations verified against docs.json before
  publishing (script check, 0 mismatches). Links are full
  atlas.redline.support/atlas?id=<uuid> URLs with section numbers as link text.
  First instance of the "chunk digest" doc genre (P2/P3 in the plan) — candidate
  for a future /anatomy guides section.

- **(next commit)** "DR onboarding doc: remove invented content, exact-relay pass"
  USER CORRECTION (standing rule): never present inferred/invented content as
  Atlas-derived. The "implied minimum" application-fields list was subagent
  speculation — replaced with what the Atlas actually requires downstream
  (Integrator Name registry field + the two gates). Also fixed while re-reading
  source text: Current Integrators registry fields are name/Reward Code/
  TRACKING METHODOLOGY (not "proposal reference"); Phase 3 rewritten as exact
  quotes from the invocation pipeline (facilitator review → Snapshot vote →
  Powerhouse update) with per-step citations; Phase 5 compliance line now
  quotes the consequence provision instead of inventing "monitor/escalate".
  RULE FOR ALL FUTURE ATLAS-DERIVED DOCS: every statement is either an exact
  relay (quote/cite) or explicitly labeled as our own procedure-design note.

- **(next commit)** "DR onboarding: Reward Code is assigned BY OGO, not by the Prime"
  Second user correction on the same doc: I'd framed the Reward Code as collected
  from the Prime. Atlas is explicit — "Reward Codes are assigned by Operational
  GovOps" (may contract it out; A.2.2.9.1.2.1.1.1.1), issued to approved
  applicants, drawn from the managing Prime's RESERVED RANGE (a namespace, not
  authority; A.2.2.9.1.2.1.1.4), recorded by OGO (Management doc notes the
  registries exist so Primes/OEAs can onboard without a single party). Doc now
  has a standalone "Reward Code assignment" section; from-Prime section reduced
  to managing-Prime identity + tracking methodology + instance params. Also
  added exact-relay Marking/10-year Lifetime/no-double-counting rules.

- **(next commit)** "DR onboarding: full source audit, quote-or-gap discipline"
  Third user catch on this doc (leftover "Reward Code" in the instance-params
  bullet) triggered a full audit: read EVERY cited doc verbatim and rewrote all
  paraphrases as exact quotes. Fixes: instance-params bullet regrounded (Atlas
  doesn't enumerate draft fields; provable minimum = name/code/methodology
  because the Current Integrators rule reads them "from the approved Proposal");
  OGO review gate criteria corrected (operationalize + accurate + NO DOUBLE
  COUNTING — the "off-chain verifiable" bit belonged to Alternative Tracking
  Methodologies, not the review); alignment/compliance/recipient bullets now
  verbatim; dropped the invented "auxiliary-account registration" gap line
  (List Of Auxiliary Accounts exists but belongs to the Demand Side Buffer);
  scope note reworded to only what's quotable; gaps section scoped to audited
  sections. 38 cited docs, all verified, all quotes read from source.

- **(next commit)** "DR onboarding: two-regime application intake + Prime-as-Integrator"
  User prompt: the Application bullet presented the Sky Forum thread (near-term
  only) as THE process. Restructured as two verbatim regimes — near term
  (direct to OGO forum thread) vs long term (exclusively through Primes, their
  own intake) — with the full Process Flow confirming OGO approval + code
  issuance in BOTH. Also added from the full flow text: long-term plans "should
  include how the Prime will support the Integrator in including the Reward
  Code in their on-chain infrastructure", and the Prime-as-Integrator path
  (Prime deploys a code on its own frontend; must apply like anyone).

## 2026-07-22 — concepts.md audit plan

User asked for a scrutinize/leave/rewrite triage of the concept catalog.
Wrote docs/features/atlas-anatomy/CONCEPTS-AUDIT.md: 4-tier evidence rubric
(T1 censused → T4 agent-unverified), verdicts per section, prioritized check
worklist, process changes (verify-concepts.mjs, agent-reports-are-leads rule).
Calibration spot-checks run first: accord UUIDs 10/10 ✅, Safe Harbor address ✅,
SSR bounds ✅, Solana rate limit ✅ — but TWO failures: transitionary-measures
count was an uncensused guess ("~15+", actual 20; fixed) and the D6 Ranked
Delegate rule was INVERTED by the instruments agent (tenet: rank loss after
triggering is inconsequential; catalog claimed a rank-loss penalty — fixed
with visible correction note). Calibration: agent pointers reliable, agent
rule-characterizations dangerous.

- **(next commit)** "Add Audit tab to /anatomy"
  User wants the audit plan readable in-app: /anatomy/audit renders
  CONCEPTS-AUDIT.md. Refactored the ?raw markdown rendering into shared
  AnatomyMarkdown.tsx (components map + UUID linkification); AnatomyConcepts.tsx
  now exports thin AnatomyConcepts + AnatomyAudit wrappers. Route + tab wired.
  No patch-notes change (same unreleased Anatomy feature).

- **(next commit)** "Concepts formatting: expand Def/Sig/Rel into full labeled fields"
  User couldn't parse the terse Def/Sig/Rel legend. Script-transformed all 42
  templated entries (.cache/expand-concepts.mjs, one-shot): each field now its
  own indented list item with bold full word, blank line between fields; 3
  non-templated Dn blocks converted by hand; legend expanded into a 4-bullet
  plain-language explanation. No content changes — formatting only.

- **(next commit)** "Move Anatomy under /reports as the Atlas Anatomy report"
  User request; done per .claude/skills/new-report/SKILL.md checklist. Routes
  /anatomy* → /reports/anatomy* (legacy URLs redirect via wouter Redirect);
  ReportId "anatomy"; REPORT_TITLES entry; ReportsIndex card (General Reports);
  report_view tracked on mount; title "Atlas Anatomy: ..."; DownloadCsvButton
  on Shape (full chunk-tree export via new pure flattenChunkTree/
  anatomyChunksToCSV in src/lib/anatomy.ts + colocated anatomy.test.ts, 3
  tests passing). Homepage card retargeted. Patch bullet revised (same
  unreleased feature). CONSCIOUS CHECKLIST DEVIATIONS (rubric-page precedent
  for prose content): no FilterPills/useUrlState filters and no q-param
  in-report search yet (tabs are prose/tree, not tabular rows) — hence no
  filtered-CSV state (button correctly hides) and no REPORT_SCOPE_CONFIG
  entry. Revisit if the Shape tree grows filtering. PROMPT.md file-inventory
  routes line now outdated on /anatomy paths — superseded by this LOG entry.

## 2026-07-23 — pushed & PR opened

Branch atlas-anatomy pushed to origin (github-darkstar alias, darkstar-covenant).
PR: https://github.com/Anscharo/redlens/pull/194 (27 commits, base main).

- **(next commit)** "Chunk tree: full child listing + label tooltips"
  User caught two defects on A.2.2.10.1.2: (1) truncated labels had no
  full-name affordance — labels now wrapped in Tooltip (delay=300, full
  doc_no + title + doc count); (2) bar segments promised "smaller sections"
  mass that expansion never revealed (children <5 docs were pruned from the
  DATA but still drawn in the bar). Rule adopted: a bar's composition must be
  fully expandable. chunkNode now emits EVERY direct child; MIN_CHUNK_DOCS
  only stops recursion (small children are leaf entries). Artifact: 1,733 →
  7,749 nodes, ~35KB → ~508KB gz (lazy-loaded on the anatomy route only;
  tunable if it hurts). Remainder tail only renders if ≥5 unaccounted docs
  (now only hoisted-wrapper self-docs remain, so effectively gone).
  SCHEMA_V=4 (bytes changed under same sha — immutable-cache rule).

- **(next commit)** "Add nested treemap chunk map to Shape"
  User spec: big square, largest chunk as square in upper-left, recursive,
  area ∝ size, hover = border + info bar to the right, placed above Doc mass
  by scope. Implemented as a squarified treemap (Bruls) — pure layout in
  src/lib/treemap.ts (+ tests: fill exactness, largest-at-origin, maxDepth),
  rendering in AnatomyTreemap.tsx (4 levels deep, minArea cutoff; single
  sequential --red deepening per depth per dataviz guidance — geometry+labels
  carry identity, not hues; mouseover-bubbling hover so the deepest rect
  claims it; info panel: breadcrumb, doc_no+title, docs, % of Atlas,
  sub-chunk count, reader link). Fixed during build: nested rects must stay
  in ROOT unit space with placement converted per-parent (mixing spaces
  produced phantom empty bands); square capped at 480px so the info panel
  fits beside it in the 768px report column. Patch bullet revised.

- **cee2a2bb + 3b34fb1d + fix**: treemap chunk map shipped; remote had a main
  merge (b3266433: TS7, OG cards, collections, chat harness) — rebased onto it,
  resolved patch-notes conflict (upstream re-dated wave to 2026-07-26; kept
  their date + our revised bullet), and fixed a merge-mangled legacy /anatomy
  redirect in App.tsx (missing closing tags — build was broken on the remote
  branch until this). All pushed to PR #194.

- **Branch cleanup pass** (derived-artifact audit): removed `scripts/aux/atlas-shape.mjs`
  and its outputs `docs/anatomy/{toc,shape,glossary}.md`. They were never wired into any
  pnpm script and nothing in the app read them — `/anatomy`'s Shape/Contents/Glossary tabs
  already read `anatomy.json`/`glossary.json` directly (confirmed by grep before deleting).
  Updated the stale references in `docs/atlas-map.md`, `docs/plans/atlas-anatomy.md`,
  `PROMPT.md`, and the two `scripts/lib|required` header comments that pointed at the
  deleted script.

- **Removed the Contents tab** (user decision: superseded by Shape's "Doc mass by scope",
  which gives the same scope→article→section drill-down with weights and reader links).
  Its one non-redundant piece — the linked Needed Research list — moved into the Shape tab
  below Overlay chunks. Deleted `AnatomyContents.tsx`; dropped `toc` from `anatomy.json`
  (types, guard) and bumped `SCHEMA_V` 4→5; pruned the now-consumer-less parentId-based
  `subtree`/`childSegments`/`scopes`/`groups`/`primes`/`executors`/`_internals` compute
  from `anatomy-shape.mjs` (chunk trees run on the semantic doc_no tree; the field-pick in
  `build-anatomy.mjs` is gone — computeAnatomy returns exactly the shipped shape).
  `/reports/anatomy/contents` now redirects to `/reports/anatomy`. Revised the unreleased
  patch-notes bullet + reports-index card copy (no new bullet — same unreleased feature).

- **Dev-doc consolidation → `analyst-anatomy` skill.** The session docs in this folder
  dissolved into `.claude/skills/analyst-anatomy/SKILL.md` (auto-surfaced to every future
  session): CONCEPT-MINING.md (mission/method ladder/quality bar) and PROMPT.md's durable
  halves (locked decisions, session practices, the DR-saga standing rules) — both files
  deleted (a spent one-off prompt is deleted, not archived, per the plans-archive README).
  Moves: `docs/anatomy/dr-partner-onboarding.md` → the skill's
  `references/dr-partner-onboarding.md` (worked exemplar of quote-or-gap);
  CONCEPTS-AUDIT.md → `docs/anatomy/concepts-audit.md` (it ships in-app via the Audit
  tab's ?raw import — it belongs with the app content, import path updated). This LOG
  stays here until the branch merges (user decision). Older entries above reference the
  pre-move paths; this note is the forwarding pointer.

- **Folded `anatomy.json` away — shape is now computed client-side.** Measured the
  artifact at 2.0 MB raw / 528 KB gz (38% of docs.json gz) while being a pure projection
  of docs.json + a glossary term count — for the common reader→anatomy path it *added*
  transfer. Ported `scripts/lib/anatomy-shape.mjs` → `src/lib/anatomyShape.ts`
  (byte-identical output verified against the artifact before deletion); `loadAnatomy`
  now derives `AnatomyData` from `loadAtlas` + `loadGlossary` per base (anatomy works
  over previews now — previews never bundled anatomy.json). Deleted `build-anatomy.mjs`,
  `anatomy-shape.mjs`, the `SCHEMA_V`/skew-reload machinery, and the wiring in
  package.json build chain, Dockerfile, dev-preflight, build-manifest, bundle-store
  allowlist, atlas-updater refresh, .gitignore. Added `anatomyShape.test.ts` (semantic
  tree, gap-skipping, hoisting, NR, pruning) — which surfaced a carried quirk, now
  documented + locked: `.varX` docs attach to the scenario's parent, not the scenario
  (3 real docs; the `.var` strip + slice-before-check loop). Behavior kept identical
  pending a deliberate fix. Skill locked-decision #3 rewritten to match. Next (user-
  approved direction): a trimmed `atlas_describe` "shape" section on the MCP server
  reusing `computeAnatomy` against server `Indexes` — fills the doc-mass/orientation
  gap and the parentId-flat blind spot in server subtree reasoning.

- **MCP `atlas_describe` stats section** (the follow-up above, done; named `stats`,
  not "shape", per user). New opt-in
  section (`sections: ["stats"]`, in "all"): totals + per-scope masses + the curated
  groups trimmed to 2 levels / top-12 children per node, with a 0.2%-of-atlas floor
  per row — the sub-0.2% long tail (174 sliver rows, ~15 KB) folds into `(+N smaller)`
  rollups (masses still sum) — and `child_count` at the depth cap. Implementation:
  `src/server/tools-stats.ts` reuses `computeAnatomy` against `ix.docMap` (ChunkNode/
  AnatomyData types moved into `src/lib/anatomyShape.ts` so the server imports no
  DOM code; `anatomy.ts` re-exports), WeakMap-memoized per Indexes (updater swap
  invalidates), GROUPS exported. Server degrades on missing GROUPS roots (drops them)
  where the frontend stays loud — deliberate divergence, noted in code. Glossary term
  count identity-dedupes the alias-flattened lookup. Real-data smoke: ~13 ms compute,
  8.8 KB payload (111 rows); per-prime masses now one call (Spark:2284, Grove:1793, …) —
  previously not derivable server-side at all (atlas_filter walks flat parentId).
  Registry whenToUse/description updated; fixture in tools-graph.test.ts gained
  glossary/meta; new tools-stats.test.ts (totals, alias dedupe, pct floor, rollup,
  depth cap, opt-in-ness).

- **Dn1–Dn9 rewritten census-first** (concepts-audit rewrite item 1 / execution-order
  item 4). The old block was the normative-deep-dive agent's frame with corrected
  numbers bolted on — that agent's counts were provably garbage (200–400 ADCs vs the
  real 64), so the frame itself was re-derived rather than re-cited: for each family
  a detection pass was actually run over `public/docs.json` + `public/relations.json`
  (throwaway scripts), and a family kept its place only if a pass found it. Eight
  survived (Dn1 duties 854 edges/635 docs/8 roles; Dn2 prohibitions 11 title/52
  content; Dn3 suspension 5; Dn4 derecognition 14 + registry rows; Dn6 conduct 12;
  Dn7 adjudication 5; Dn8 alignment 22; Dn9 edit restrictions 10), each with a
  verbatim exemplar read from `vendor/next-gen-atlas/content/**` and a UUID. **Dn5
  (escalation/precedence) demoted** to a labeled 4-doc pointer list — no general
  signature exists. Three inherited claims were false and are corrected in place:
  Dn1's "all sourced from A.1" (real spread across 5 scopes), Dn3's signature (it was
  counting the B2 lifecycle machine: `has_status` runs primitive→its own Global
  Activation Status doc, and 136/141 `Suspen*` titles are empty scaffolding), Dn6's
  "Usage Standards ×22" (those 33 docs are per-multisig operating constraints). The
  justice-pipeline chaining is kept but relabeled **our interpretation, not Atlas
  structure**, with the doc-level links that *are* Atlas text listed separately.
  Found en route: a second, structurally parallel enforcement pipeline in Risk
  (A.3.2.2.7 capital-requirement breach → graduated penalties → conservatorship),
  same shape, different subject, no "misalignment" vocabulary. Promoted the seven
  title signatures to a standing census (`normative-title-families`, 79 member rows /
  72 distinct docs, overlapping buckets by design) + `:::census` marker + tests +
  baseline; Dn1 stays a documented one-off because it reads relations.json and
  conceptsCensus.ts is docs-bundle-only.
