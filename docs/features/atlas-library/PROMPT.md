# Atlas Library — continuation prompt

Paste (or read) this into a fresh Claude Code session in `~/Workspace/Sky/redlens` to
continue — or, if the branch were lost, recreate — the Atlas Library feature. Read
`LOG.md` in this folder first for the latest state; it is append-only and always current.

---

## Context (carry forward)

You are continuing the **Atlas Library** feature on branch **`atlas-library`** in the
RedLens repo (a search-first reader for the Sky Atlas; see CLAUDE.md for stack + commands).
The user's goal: escape the two bad ways of consuming the 10,780-doc Atlas (monolith
scroll, or atom-pile requiring tribal knowledge) with a scholarly in-app **/library**
section: the *shape* of the Atlas as hierarchical functional chunks with weights, a
distilled table of contents, a glossary, and eventually per-chunk digest pages with
staleness heuristics.

Locked decisions — do not relitigate:

1. **Chunks are hierarchical.** A flat taxonomy was built first and rejected by the user
   (Agent artifacts = 69% of the Atlas rendered as one bar). The data model is a recursive
   `chunkTree`: curated taxonomy groups on top, semantic subtree beneath.
2. **Inside agent artifacts, `parentId` is unreliable** (heading depth caps at 6; the tree
   goes flat). The real nesting is rebuilt from doc_no segments (`semParent`/`semChildren`
   in `scripts/lib/library-shape.mjs`). Doc_nos are NEVER used as lookup keys in curated
   config — UUIDs only, doc_no in a comment (CLAUDE.md rule; PR #235 proved it).
3. **`library.json` is a first-class atlas-versioned artifact**, same lifecycle as
   `glossary.json`: gitignored, built by `pnpm build:library`
   (`scripts/required/build-library.mjs`), in the `pnpm build` chain + Dockerfile + dev
   preflight + the runtime updater's `runRefreshFromDb` (`src/server/atlas-updater.ts`),
   allowlisted in the per-sha bundle (`src/server/bundle-store.ts`), digested in
   `build-manifest.mjs`, loaded in the app from `liveAtlasBase()` with `handledStale`
   (`src/lib/library.ts`). It must stay **timestamp-free** (REPRO builds byte-identical).
4. **Generated skeleton, curated flesh.** Structure/weights computed by build passes;
   scholarly prose will be authored markdown keyed by chunk id (P2+, not built yet).
5. **Weight bars**: stacked segments largest→smallest left→right, descending opacity of
   `--red`, thin tails merged into one faint "smaller sections" block; instant (`delay={0}`)
   app `Tooltip` on segments — the 800ms default elsewhere is untouched.
6. **Row pattern**: plain-text title toggles expansion (real `<button>`, chevron,
   aria-expanded); reader deep-link lives in a small link-out SVG icon after the title
   (stopPropagation); count + %-of-Atlas on the right. Bars scale to the largest *sibling*
   at each level.
7. The curated taxonomy groups (UUID roots) live in `scripts/lib/library-shape.mjs`
   `GROUPS`; the chunk-tree prune threshold is `MIN_CHUNK_DOCS = 5`; single-child chains
   hoist at group roots. Known accepted risk: if the Atlas restructures away a root UUID,
   `subtree()` throws — the fix (census/baseline drift pattern) is planned P1 work.

Companion docs (read on demand, all committed on this branch):
- `docs/atlas-map.md` — the chunk-taxonomy research (scope skeleton, prime artifact
  anatomy, entity layer, staleness findings, session log).
- `docs/plans/atlas-library.md` — the product plan: /library four faces (Shape, Contents,
  Chunk pages, Glossary), 7 staleness signals, phases P0–P4, open questions.
- The P0 seed markdown (`docs/library/{toc,shape,glossary}.md` via `scripts/aux/atlas-shape.mjs`)
  was removed post-P2: nothing read it once `/library` shipped against `library.json` +
  `glossary.json` directly, and it wasn't wired into any build script, so it went stale on
  arrival. The Shape/Contents/Glossary tabs are the live replacement.

## File inventory (this feature)

- `scripts/lib/library-shape.mjs` — shared compute: GROUPS taxonomy, subtree weights,
  semantic doc_no tree, `chunkTree`, toc. Consumed by both scripts below.
- `scripts/required/build-library.mjs` — build pass → `public/library.json`
  (fields: atlasCommit, totals, docTypes, scopeTree, neededResearch, chunkTree).
- `src/lib/library.ts` — types + sha-keyed cached loader.
- `src/components/library/` — `LibraryPage.tsx` (tabs), `LibraryShape.tsx` (Shape page:
  treemap, scope/chunk trees, overlays, Needed Research list), `LibraryChunkTree.tsx`
  (recursive bars-with-sub-bars), `SegmentedBar.tsx` (SegmentedBar + PlainBar),
  `LibraryGlossary.tsx`. (The Contents tab + `LibraryContents.tsx` + the `toc` artifact
  field were removed 2026-07-24 — superseded by Shape's "Doc mass by scope"; its Needed
  Research list moved into Shape. `/reports/library/contents` redirects to the report root.)
- Routes `/reports/library{,/concepts,/audit,/glossary}` in `src/lib/routes.ts` +
  `src/App.tsx` (legacy `/library/*` redirects); homepage card in `HomePage.tsx`;
  patch-notes bullet (2026-07-20).
- Pipeline touchpoints listed in decision 3.

## Working practices (the user asked for these explicitly)

- **Commit in reasonable chunks** as pieces finish, with commit messages that explain the
  why; no Claude co-author trailer (user memory). Repo identity: darkstar-covenant.
- **Append to `docs/features/atlas-library/LOG.md` at every commit** — what changed, why,
  and anything a context-less future session needs. Keep it current; it is the recovery
  point.
- Verify UI changes by screenshot: dev server via
  `CHOKIDAR_USEPOLLING=1 DEV_NO_DB=1 pnpm dev` (this machine: no Docker, inotify limit),
  then `node .cache/shot.mjs <url> <png> [w] [h]`. After changing library.json, also copy
  it into `public/atlas/<sha>/` (+ .gz) or restart dev to republish the bundle.
- `pnpm exec tsc -b` must be clean (ignore the pre-existing fake-indexeddb test errors).
- Patch-notes: one bullet per user-visible feature; follow-ups to the same unreleased
  feature get NO new bullet (validator: `pnpm check:patch-notes`).
- Max ~150 lines/file, ≤3 components/file; `node:` import prefix; semantic HTML.

## Next steps (in rough priority order — confirm with the user before big jumps)

1. **P1 chunk registry**: promote GROUPS into a curated `chunks` registry with stable
   slugs + census/baseline drift guard (mirror `census:*` patterns) so atlas restructures
   degrade gracefully instead of throwing.
2. **Staleness signals** (plan §heuristics): start with the two cheap ones — empty
   instance-directory scaffolding (validated: 8–12 of 17 active-instance dirs per prime are
   empty) and explicit status fields; render as badges in the chunk tree.
3. **Chunk digest pages** (`/library/chunk/<slug>`, markdown in `docs/library/chunks/`).
4. Possibly fold "Doc mass by scope" into the chunk tree (it partially overlaps now).
5. Reconcile chunk taxonomy with `public/processes.json` process inventory.

## Stop conditions

- Ask before adding dependencies, touching DB schema/migrations, deleting files, or
  changing anything outside the feature's file inventory + the pipeline touchpoints above.
- Do not add features beyond what the user asked for in the current turn.
- If `library.json` shape changes, update: `src/lib/library.ts` types, build-library field
  pick, LOG.md, and verify REPRO byte-stability (`pnpm build:library` twice → same sha256).
