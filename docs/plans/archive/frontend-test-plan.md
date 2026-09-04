# Frontend Test Plan

> **Archived 2026-09-03.** The three layers shipped: L2 component tests cover
> search, reader, sidebar, and preview; L3 Playwright runs in
> `.github/workflows/e2e.yml` against Railway PR envs (`e2e/search.spec.ts` and
> siblings). Read this for the layer split and the `deployment_status` wiring.
> Status tables and file inventories below are frozen as of the plan.

Bring tests to the four frontend feature areas: **sidebar**, **reader**, **search**, and **atlas-preview** (the `/preview` redline-of-upcoming-atlas feature). Three layers, split by what each layer can actually exercise.

## TL;DR

| Layer | Tool | Runs where | Status |
|---|---|---|---|
| **L1 — Pure logic** | Vitest (node env) | CI `pnpm test` | ✅ strong already |
| **L2 — Component** | Vitest + jsdom + React Testing Library | CI `pnpm test` | ⚠️ only 3 component tests; deps installed |
| **L3 — Browser E2E** | Playwright (new) | Railway **per-PR environment**, via `deployment_status` | ❌ to build |

The dividing line: **Web Workers (`search`/`atlas`/`graph` → MiniSearch/graphology), `scrollIntoView`, real markdown+KaTeX, SSE, and per-SHA caching do not run in jsdom.** If a behavior's whole point is one of those, it's L3. If it's reachable by mocking the worker/fetch, it's L2. Pure functions are L1.

## Infrastructure facts (load-bearing)

- **Railway auto-creates a per-PR environment** with its own deploy URL — configured in the Railway *console*, not in any repo file (so it's invisible in `.github/`/`railway.toml`). This is production parity: real Docker image, real workers, real `/api/preview` pipeline.
- **Each PR env gets its own Postgres** → no shared-DB contention; DB-backed E2E (preview build, history, chat) runs isolated per PR.
- Railway emits a GitHub `deployment_status` event (with `environment_url`) when a PR env finishes deploying — **that event is the "ready" signal** the E2E workflow keys off.
- Two distinct "PR" concepts — do not conflate:
  - **Railway PR env** = this lens app, deployed per *lens-repo* PR → the E2E **target URL**.
  - **`/preview/<id>`** = redline of an *upcoming atlas* PR/branch/fork from `next-gen-atlas` → a **feature under test**. `<id>` is an atlas ref.

## Layer 1 — Pure logic (Vitest, node)

Already the strongest layer (12 lib + 3 hook tests). Keep covering extractable helpers; no infra. Relevant pure modules per area:

- **Sidebar:** `buildAncestors`, `flattenTree` (`src/lib/atlasHelpers.ts`); `useDepth6Expand` hidden-count math (`src/components/atlas/useDepth6Expand.ts`); `segmentDepths`/`nrChiclets` (`src/lib/depth.ts`).
- **Reader:** `extractLinkedIds`, `stripMarkdownLinks` (`atlasHelpers.ts`); `buildSnippet`, `highlightTerms`, `applyHighlight` (`src/lib/searchHighlight.ts`).
- **Search:** `stripFieldTokens`, `effectiveMode`, `applyMode`, `isMixedQuotes` (`src/hooks/useSearchInput.ts`); `extractPhrases` (`searchHighlight.ts`).
- **Preview:** `parsePreviewInput` (`src/lib/previewLocal.ts` — already tested); `usePreviewDim`, `usePreviewChangedSet` set logic (`src/lib/previewFilter.ts`).

## Layer 2 — Component (React Testing Library + jsdom)

Highest ROI, **zero new infra** (RTL 16.3.2, jsdom 29, jest-dom already installed; `vitest.config.ts` already maps `src/components/**` → jsdom). Feed mocked `LoadedData` / props / contexts; mock the Worker, `fetch`, and `EventSource`.

### Sidebar
- `CollapsibleNode` — click-to-select vs title-click-to-toggle disambiguation + 4px drag threshold (extend existing `CollapsibleNode.test.tsx`).
- `AtlasReader` — depth-6 gating: "N hidden" affordance reveals gated descendants; `handleExpandParent` flips `expandedParents`.
- `JuniorPane` — Shift+Click split open + breadcrumb ancestors + close.
- Preview-dimming class applied to untouched nodes.

### Reader
- `RightPanel` — tab switching (annotations / glossary / history) + `?view=` URL sync.
- Glossary term grouping render.
- UUID-link interception in `NodeContentInner` → `onNavigate(id)` instead of navigation.
- Error/fallback boundary when `NodeContentInner` throws.
- `NodeHistory` with mocked `/api/history/:id` fetch → loading → rows → error states.

### Search
- `SearchBar` — mode pills (broad/phrase/strict) wrapping that preserves field tokens; scope chip; clear button.
- `useSearch` with a **mocked Worker** — ready gating, results-matched-by-id race guard, error state on worker error.

### Atlas-preview
- `PreviewGate` state machine with a **mocked EventSource**: resolving → fetching → building → ready / failed.
- `PreviewBanner` — PR vs FORK rendering from mocked `meta.json` (trust tier, new-address warning).
- `PreviewMark` / "changed only" filter from a mocked `previewDiff` context.
- `PreviewHome` — localStorage ⨯ DB-rows merge (`mergeEntries`).

## Layer 3 — Browser E2E (Playwright → Railway PR env)

Exercises the real stack: workers, MiniSearch index, markdown/KaTeX, scroll, SSE, the preview build pipeline.

### Wiring

```yaml
# .github/workflows/e2e.yml
on:
  deployment_status                      # Railway fires this when the PR env is live
jobs:
  e2e:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          BASE_URL: ${{ github.event.deployment_status.environment_url }}
```

- New script: `"test:e2e": "playwright test"`; Playwright `baseURL = process.env.BASE_URL`. No `webServer` block — the target is the live PR env.
- Keying off `deployment_status == success` removes the "tests started before deploy was ready" race.
- Headless **Chromium only** to start; add Firefox/WebKit later if cross-browser matters.

### Specs (the regression-prone surfaces)

- **Search quality** — type real queries against the live MiniSearch index; assert ranking, snippets, and highlight markup. Covers the heavy worker logic (chainlog reverse-map, doc-no fast-path, `in:`/`type:`/`title:` filters, phrase post-filter, three-tier merge) that's only meaningful against the real index.
- **Sidebar deep-node select / scroll / focus** — the last three bug-fix commits (NR sidebar width, focus bug, minitree deep-node selection) are geometric and invisible to jsdom. Navigate to a depth-6+ node, assert it auto-expands ancestors, scrolls into view, and lands focus.
- **Reader render-at-scale** — open docs with real markdown, on-chain address linkification, and KaTeX; assert addresses linkify and math renders.
- **Atlas-preview redline** — drive `/preview/<pinned atlas canary>` (a **stable** branch/PR in `next-gen-atlas` — see open question), assert SSE reaches `ready`, redline marks appear, and "changed only" filter narrows the tree. Each PR env's own DB makes the build safe to run.
- **Atlas-preview history** — in the same `/preview/<canary>` session, open a node that the canary **changed** (one in `diff.changed`/`diff.added`) and switch the right panel to the history tab (`?view=history`). Assert: (a) the top entry is the preview/PR change itself — the new, not-yet-on-live change (PR title/author/status from `PreviewHistory.tsx`), with the line-level `DiffView` when `patch.json` is present; (b) below it, the "On the live atlas" section still renders the node's real history. This is the one history path that diverges from live (`PreviewHistory` vs `NodeHistory`), so it can't be covered by the L2 mocked-fetch history test — it needs the real preview bundle's `diff.json` + `patches.json`.

### Optional add-on
Post-merge smoke against prod `atlas.redline.support` (3–4 assertions: home loads, search returns hits, a known doc renders). Lower priority now that the PR env covers pre-merge — keep as a cheap safety net for Railway-config-only breakage on `main`.

## Phasing

1. **L2 backfill** — RightPanel tabs, AtlasReader depth-6, `useSearch` (mock worker), `PreviewGate` (mock EventSource), `PreviewBanner`, CollapsibleNode. No infra; start here.
2. **Playwright scaffold** — config + `test:e2e` + `e2e.yml` on `deployment_status`. Port the existing `ci.yml` curl smoke (`/api/health`, `/mcp tools/list`) into a first spec.
3. **L3 search-quality + sidebar scroll/focus** specs.
4. **L3 atlas-preview** spec (needs the pinned canary).

## Open questions

- **Pinned atlas canary ref** for the preview E2E — pick a long-lived branch/PR in `next-gen-atlas` so the spec doesn't break when atlas content moves. Without a stable fixture, the preview redline assertions are non-deterministic. The canary must include **at least one changed/added node that also has prior live history**, so the history spec can assert both the new preview change (top) and the live history (below).
- Confirm Railway's GitHub integration emits `deployment_status` for PR envs (default, but verify once in the console).

## Inventory reference

- **Configs:** `vitest.config.ts` (jsdom for `src/components/**`), `vitest.snap.config.ts` (graph snapshots), `tsconfig.test.json`. Server tests run under Bun (`pnpm test:server` → `bun test src/server`), separate from this plan.
- **Scripts:** `test` (`vitest run`), `test:watch`, `test:server`, `test:snap`, `test:snap:update`. New: `test:e2e`.
- **Existing component tests:** `NodeContentInner.test.tsx`, `DocNoChiclets.test.tsx`, `atlas/CollapsibleNode.test.tsx`.
- **Existing hook tests:** `useCopyState`, `usePulseDom`, `useSearchInput`.
- **Key source files** — Sidebar: `atlas/AtlasReader.tsx`, `atlas/CollapsibleNode.tsx`, `atlas/JuniorPane.tsx`, `atlas/useDepth6Expand.ts`. Reader: `NodeContentInner.tsx`, `atlas/RightPanel.tsx`, `history/NodeHistory.tsx`, `history/PreviewHistory.tsx`. Search: `hooks/useSearch.ts`, `hooks/useSearchInput.ts`, `workers/search.worker.ts`, `lib/searchHighlight.ts`. Preview: `components/preview/PreviewGate.tsx`, `PreviewBanner.tsx`, `lib/previewDiff.tsx`, `lib/previewView.tsx`, `lib/previewFilter.ts`.
