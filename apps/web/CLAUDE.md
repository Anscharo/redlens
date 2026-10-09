# apps/web — the SAbR frontend

This is the React and Vite frontend. `apps/web/src/App.tsx` is the shell, `apps/web/src/components/atlas/` is the atlas reader, and `apps/web/src/components/radar/` is the entity view. Some shared frontend code lives outside this folder, in the repo-root `src/lib/` (`searchSemantic.ts`, `wordShape.ts`, `radarSearch.ts`).

Two subsystems have their own CLAUDE.md, which loads when you work there:

- `apps/web/src/components/chat/CLAUDE.md`: the chat widget and its reliability harness.
- `apps/web/src/components/reports/CLAUDE.md`: building a report page.

## Layout and workers

`App.tsx` is the shell (search bar, tree drawer, layout, shell-wide hooks). Its routes are in `apps/web/src/components/routes/` (`AppRoutes.tsx` is the `<Switch>`), behind `RouteErrorBoundary`; the tree sidebar mounts through `components/tree/TreeDrawer.tsx`. The main atlas view is `apps/web/src/components/atlas/AtlasView.tsx`.

Three workers, all under `apps/web/src/workers/`:

- `search.worker.ts`: MiniSearch.
- `atlas.worker.ts`: the tree view.
- `graph.worker.ts`: a graphology `MultiDirectedGraph` over `relations.json`.

The atlas view is `apps/web/src/components/atlas/`, the entity view is `apps/web/src/components/radar/` (`/radar`, `/radar/:slug`, and a Prime Agent's subpages `/radar/:slug/:page`, declared once in `src/lib/radarPages.ts`), and reports are in `apps/web/src/components/reports/`.

## Non-obvious reader behaviours

- **Search phrase post-filter.** `"quoted"` and `'strict'` phrases are stripped before the MiniSearch query. Then every hit is re-checked for literal substring containment (no word-boundary anchors). The `/search-hints` cheat sheet and the mode-pill tooltips must stay on that contract, not "whole-word".
- **Search boot.** `useSearch` spawns the worker with `name: base` (Vite requires the `new Worker(new URL(...))` to stay inline). The worker fetches `{base}search-index.json`. The main thread forwards already-loaded docs and addresses via `{type:"preload"}`, so the worker does not re-download them. `"ready"` unblocks queries. A query typed during load is queued.
- **Search query.** `SearchBar` is URL-controlled (`?q=`). `useSearchInput` applies mode wrapping, then `useSearch` posts `{type:"query", id, lane, sem}` (stale ids are dropped). Results render on `/` only (`SearchResults`). Other routes idle the worker. Report pages reuse the bar to filter their own rows, not MiniSearch. Chat and MCP retrieval is a separate server-side hybrid (see `docs/chat-system.md`).
- **Depth ≥ 6 nodes are hidden.** They sit behind a "view all descendants" button until expanded (`CollapsibleNode.tsx`). This follows from the parser capping heading depth at 6 (`scripts/CLAUDE.md`).
- **Glossary lookup flattens parenthetical aliases.** `"Accessibility Scope (ACC)"` yields keys for both `"accessibility scope"` and `"acc"`.

## The reader's semantic search lane (client side)

The search bar can also read the pgvector index that chat retrieval uses. The server side of this lane (the route, scoped SQL, embed failures, the embedding model and its settings, budgets, leaf attribution, briefings) is described in `src/server/retrieval/CLAUDE.md`. This section covers the client.

### One knob: the lane

There is ONE knob, in `src/lib/searchSemantic.ts`: the **lane** (`?lane=`, either `lexical` or `semantic`). The two pills on the result-count line set it. **Meaning-matched rows appear on the `semantic` lane and nowhere else.**

There used to be a second knob, a blend strategy (`?sem=`), which let the leg run under the wording lane too. Both strategies are gone:

- `woven` always ran the leg and fused both sets by RRF. **Dropped 2026-09-29.** The interleaved list read worse than either lane alone, and it bought an embedding call on every settled search to do it.
- `fallback` ran the leg whenever wording found nothing. **Dropped 2026-09-30.** A reader on the wording lane asked for a wording search. Quietly answering with an index whose rows can share no word with the query is worse than an honest empty answer next to a pill offering that index. It also silently disabled the spelling correction, which is offered only for a wording search that found nothing, so the correction never survived the leg replacing that result set.

With them went `config.searchSemanticStrategy`, `window.__SEMANTIC_STRATEGY__` and `semanticLegQuery`'s lexical-count thunk. `semanticSearchAvailable()` is all the client reads now.

### The worker leg

The leg lives in `apps/web/src/workers/searchSemanticLeg.ts`. It handles the debounce, allows one in-flight request, and fuses by RRF through the shared `rrfFuse`. It hydrates results through the worker, which already owns docs.json and the highlighting.

- **Caching by query text.** Scored ids are cached by query text. A lane flip re-sends the SAME text, so without the cache every flip between the pills would re-embed and re-query pgvector.
- **A DEGRADED response is never cached.** Otherwise a timeout would pin an outage to that query for the worker's life.
- **Both caches remember what the search COST** alongside the result. A cache or memo hit takes about 1 ms. Reporting that would make the time on the count line change every time the reader flipped lanes and came back, so it would measure the click rather than the search.
- **The worker is rebuilt whenever the data-source base changes.** This stops the cache serving ids from another atlas commit.

### Entity search and the lexical pass

Entity search lives on Radar (`src/lib/radarSearch.ts`). The lexical pass is memoised and taken lazily, so a lane flip and the meaning lane do not pay for a whole-corpus MiniSearch run they discard.

### Spelling correction

A wording search that finds nothing offers a **clickable spelling correction** (`didYouMean` on the results message). It comes from MiniSearch's `autoSuggest` over the indexed terms, with two corrections:

- The suggestion is trimmed to the word count the reader typed. `autoSuggest` returns several near terms for one word (`facilitater` → `facilitators facilitator`).
- Every candidate is **re-run before it is offered**. A "did you mean" that also finds nothing is worse than silence, and fuzzy term matching alone cannot promise that the corrected phrase matches a document.

It replaced a `try fuzzy: accounting~2` hint, which asked the reader to learn an operator to recover from a typo. `~N` still works and is still documented. It is just no longer suggested.

### What never reaches the lane

Two invariants worth keeping.

- **An identifier never reaches the lane.** A UUID, doc_no or known chainlog id is answered exactly by the lexical fast paths.
- **Structured syntax is stripped and reported, not honoured.** `type:`, `-word`, `~N` and quoting are enforced only on the lexical side, so a semantic hit would come back unfiltered. The lane also scores whole documents, so there is no string for those filters to act on.
  - `semanticLaneLimit` names each dropped token verbatim. `SearchStatusLine` puts the note above the results ("`type:Core` ignored — meaning search scores whole documents, not strings").
  - For the same reason the broad/phrase/strict pills are **disabled** on this lane, and `useSearchInput` skips `applyMode` there. A stale `?mode=strict` would quote the query, and the lane would then report back quotes the reader never typed.
  - The one case that must NOT read as "ignored" is a query that stripping leaves too short (`-fees`). There the lane stands down and the lexical leg answers, and that leg *did* apply the filter. So `semanticLaneLimit` returns `too-short` instead, and the note says what emptied the query.
  - A query under `MIN_SEMANTIC_QUERY` with nothing stripped says so in the same place.
- **`in:` is exempt from all of this.** It is a doc_no subtree, and the server pushes it into the pgvector query instead of stripping it. It is split out of the embedded text, so the model never scores documents against the literal string `in:A.6.1`. The details are in `src/server/retrieval/CLAUDE.md`.

### Two replies per query

The worker code allows **two** `results` messages under one id: a lexical half with `semantic: "pending"`, then the fused set. Consumers must accept a second reply rather than treat it as stale. Nothing may render "no results" while a leg is pending.

Today the leg runs only on the meaning lane, and that lane posts no interim reply. Its whole wait is the `searching` state, so anything shown during a meaning search (`SemanticProgress`) must key on `searching` on that lane, not on `semantic: "pending"` alone.

### Sign-in prompt

When the shared budget is spent, the 429 shows a centred "Log in for more meaning search" heading with the sign-in buttons (`SemanticLoginPrompt`, only where logins work). A spent own allowance shows a note with the wait. The client turns the 429 into a readable note rather than a status code. The budgets themselves are server side.

### The leg holds words that do not look like words

The leg holds a query whose words do not look like words (`src/lib/wordShape.ts`, `heldWords`). A token that is not an exact term of the atlas index and fails the spelling-shape rules sends no embed request. The rules reject:

- no vowel
- a letter three times running
- seven or more consonants in a row
- a letter-number mix
- an impossible letter pair

Behaviour:

- The words are judged when the pre-send pause ends, not on each keystroke. A word still being typed (`str` on the way to `strategy`) is never reported.
- The worker answers with the wording hits, `semantic: "none"` and the held words. The count line names them.
- Enter re-posts the same query with `force` (`searchAnyway` in `useSearchInput`).
- There is no word list. The rules measured 0 held of the 358 retrieval-eval queries and about 0.5% of a 36,900-word English frequency list.
- The index probe reads MiniSearch's `protected _index` radix tree (`isIndexedTerm`). The worker test pins it against a real index, so a MiniSearch upgrade that moves the field fails the suite.

## Base path

`apps/web/vite.config.ts` sets `base: '/'`. The app is served from the domain root on Railway. GitHub Pages is only a redirect stub (`gh-pages-redirect/`, the one place `/redlens/` survives), not a deployment target, so there is no non-root base variant anymore.

`import.meta.env.BASE_URL` is therefore always `"/"`. Existing references still work (they evaluate to `"/"`) and don't need stripping, but new code can use root-relative paths directly.

Note the distinct **data-source base** abstraction (`apps/web/src/lib/atlasBase.ts` `liveAtlasBase()`, `apps/web/src/lib/dataSource.tsx`). Atlas-versioned artifacts are served under `/api/atlas/<sha>/` (or a preview base) and fall back to `import.meta.env.BASE_URL`. That base parameter is unrelated to `/redlens/` and is load-bearing for sha-keyed and preview serving.

## Styling

Color tokens live as CSS variables in `apps/web/src/index.css`. The dark default sits on bare `:root` (charcoal-with-red-undertone bg, red/accent, tans). Each additional theme adds one **full** `[data-theme="<id>"]` override block.

### Two axes

Both are set on `<html>` by `apps/web/src/lib/theme.ts`:

- `data-theme` is WHICH palette.
- `data-scheme` is light-vs-dark.

Token blocks key off `data-theme`. Rules whose meaning merely flips with the background key off `data-scheme`. Examples are row overlays going translucent-white→black, font-smoothing, and chat.css's surface re-binding. A new light palette then inherits them without being added to a dozen selector lists.

The selectable themes are declared once in the `THEMES` registry in `apps/web/src/lib/theme.ts`. Adding one is documented there.

### Rules that must not be broken

- **Every colour token must exist in every theme, and every audited pair must pass WCAG AA.** `apps/web/src/admin/theme-contrast.test.ts` enforces both. It parses `index.css` itself, so a token added to `:root` without a value in every theme fails the suite rather than silently shipping dark.
- Audited pairs live in `AUDIT_PAIRS` (`apps/web/src/admin/contrast.ts`). Add one when you add a foreground token.
- **Components must never name a colour.** That means no `#hex`, `rgb()`, `bg-white`/`text-black`/`bg-gray-500`, `bg-[#…]`, or `color-mix()` toward literal `white`/`black`. A literal is invisible to the contrast test (which only parses `index.css`), looks right in the theme it was written for, and breaks in every other one. That is exactly how eleven components stayed dark when the light themes landed.
- `apps/web/src/admin/theme-hardcoded-colors.test.ts` enforces this across `apps/web/src/**`. Genuinely absolute colours (a third-party logo, a modal scrim) go in its `ALLOWED` map with a reason.
- `apps/web/index.html`'s pre-paint script holds a hand-maintained twin of the registry (it runs before modules load). `apps/web/src/lib/theme-html-sync.test.ts` fails if they drift.
- The one value worth stating here: `--accent` (links/focus) is deliberately browner-pinker, _not_ the original error-looking red.

### Selected-node treatment

The selected node gets a red left bar, brighter text, and a fill from `--atlas-row-selected`. The fill sits against the deeper reader/sidebar bg (`--bg-deep`). Earlier guidance said "never add a background to the selected node". That was reversed intentionally once the reader adopted the deep bg. The fill is now the selected marker alongside the bar.

**Which DIRECTION that fill goes is a per-palette decision, which is why it is a token and not `--bg`.** The colour themes lift the selected doc off the page (their `--atlas-row-selected` is their `--bg`). `giedi` sinks it to `#000`, the only separation available once hue is gone, and the reason that theme's whole surface tier starts above black.

## Component work

**Component work follows [components.build](https://www.components.build)**, the open component specification, adapted to this codebase in three skills:

- `react-components`: creating or updating a component. It covers one-element-per-component, extending `React.ComponentProps`, compound `Root`/`Trigger`/`Content` composition, semantic HTML + ARIA baselines, and `data-state`.
- `react-state`: where state lives (local → `useUrlState` → context → `useSyncExternalStore` → `useLoaded`/workers). It also holds the house rule that components stay fully controlled with domain-named callbacks.
- `react-review`: auditing a frontend diff against those principles.

The spec's class-merging chapters (`cn`, `tailwind-merge`, CVA) and its npm/registry distribution chapters are deliberately **not** adopted. SAbR is an app, not a published component library, and styling is covered by `ui-look-and-feel`.

## Deferred: audit follow-ups (2026-06 frontend/dataflow audit)

Remaining items from the full-branch audit (the bug fixes landed in the same PR as this note):

- **Split oversized files and functions.** The backlog is the grandfathered entries in `.oxlintrc.size.json`. Lower an entry's number whenever you shrink that file. Split them when you touch them, not in a big-bang refactor.
- **Manual browser verification of the audit fixes.** This is not runnable in the headless audit environment. Check these:
  - the glossary tab recovers after a transient `glossary.json` failure
  - search shows an error state (not an eternal spinner) when `search-index.json` is missing
  - `/admin/palette` Copy Snippet includes saved overrides after a reload
  - the JuniorPane breadcrumb middle-click opens the right URL
