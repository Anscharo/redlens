# Deep QA report — reader, sidebar, history, radar, collections

**Campaign:** 2026-08-02 → 2026-08-03 (UTC) · **App under test:** repo HEAD `0925a38` (post-PR #226 reader/sidebar overhaul), atlas `441313ab`, 11,149 docs · **Method:** six QA sub-agents (one per area + a live-site sweep), each combining adversarial code review with headless-browser probing (Playwright/Chromium) against a full local stack (production Vite build + Bun server + Postgres 16 with the complete 45k-row history, users/collections enabled via a minted session), plus a read-only sweep of the production deploy at `https://atlas.redline.support`. Every high/medium finding was independently re-verified by the coordinating session (code re-read + repro re-run) before inclusion. **Report only — nothing was fixed.**

**Confidence labels:** CONFIRMED = reproduced live (and re-verified). CODE-SUSPECTED = established by code reading only, with the blocker noted.

**Baseline:** vitest 2,787 passed / 13 skipped · bun server tests pass · `tsc -b` clean · existing e2e vs the local stack: 16 passed, 1 skipped (preview needs GitHub API), 2 failed — both environmental (see "Environment artifacts").

**Production applicability:** the live site runs the same atlas sha (`441313ab`) with the users surface enabled (GitHub OAuth only), so the collections findings apply to production. The live app commit could not be verified from the outside (finding L3).

---

## Severity overview

| Area | High | Medium | Low / info |
|---|---|---|---|
| Reader | 2 | 1 | 4 |
| Sidebar + search | 2 | 3 | 4 |
| History | — | 3 | 5 |
| Collections + selection | — | 5 | 5 |
| Radar | 1 | 3 | 6 |
| Live site (prod-only) | — | 1 | 2 |

---

## Reader

### R1 · HIGH · Row keydown hijacks every nested interactive element — keyboard users cannot operate anything inside a row — CONFIRMED
The `<article>` row's `onKeyDown` (`src/components/atlas/CollapsibleNode.tsx:334-343`) fires toggle/navigate + `preventDefault()` on Enter/Space with **no event-target check**, unlike the sibling `onClick`, which bails via `closest('a, button, [role="button"]')` (line 308). Keydown bubbling from any inner control is swallowed: Enter on the pendulum chevron toggles/navigates the row instead of running the pendulum; Space on the selection checkbox toggles the body and leaves the box unchecked; Enter on in-content UUID links, copy-doc_no / copy-link buttons, and the external "Open on Sky Atlas" link all activate the row instead. Mouse clicks work everywhere. The whole PR #226 interaction layer is keyboard-inoperable.

### R2 · HIGH · Sticky selected node permanently occludes descendant rows when its body is taller than the scrollport; split pane is the worst case — CONFIRMED
`.atlas-node.is-selected` is `position: sticky; top: 0; z-index: 2` with an opaque `--bg` fill (`src/index.css:609-625`) — the **entire article including the expanded body** sticks. The main reader bounds it with a `.selection-group` wrapper (`AtlasReader.tsx:550,622`), but **`JuniorPane.tsx` renders no such wrapper**, so in the split pane the sticky root's containing block is the whole list: with a long-bodied root (e.g. `?split=54b41b8f-…`, article 1561px in a 276px scroller) descendant rows can **never** be seen or clicked at any scroll position (Playwright itself fails with "subtree intercepts pointer events"). In the main reader the same geometry bites whenever the selected article outgrows the scrollport: after "expand child bodies" on `A.2.2.2` (742px article, 606px scrollport), children `.1–.4` are never simultaneously in-view and unoccluded. Screenshots: `scratchpad/reader/shot-sticky-junior-bottom.png`, `shot-sticky-main-occluded.png`.

### R3 · MEDIUM · `docs-deep.json` failure → eternal "searching the stars"; a fast deep failure destroys the already-loaded shallow tree — CONFIRMED
The atlas worker posts a single `error` for `Promise.all([shallowP, deepP])`; `spawn()` then terminates the worker and rejects **both** promises (`src/lib/docs.ts:100-108`), so a deep-file failure can kill good shallow data mid-flight. `useAtlasData` swallows both rejections (`src/hooks/useAtlasData.ts:72,98`) and `AtlasView` renders `<Loading/>` forever while `data.complete === false` (`AtlasView.tsx:76-79`). No error state, no retry, blank sidebar.

### R4 · LOW-MED · Flat filtered view: "Expand child bodies" chevron is a no-op for visible descendants that aren't full-tree immediate children — CONFIRMED
In `?subset=selected`, the chevron is offered via `filteredParentIds` (`AtlasReader.tsx:433-445,529`) but `handlePendulum` writes bodies for the **full-tree** `visualChildren` (`AtlasReader.tsx:359,393`) — invisible in the flat view. The chevron animates to open; nothing visible changes except the root's own body.

### R5 · LOW · Keyboard focus dropped to `<body>` after pendulum collapse relocates the selection — CONFIRMED
Collapse-with-selection-inside correctly moves selection + URL to the branch root, but the relocated row remounts into the `.selection-group` wrapper and `document.activeElement` becomes `BODY` (`AtlasReader.tsx:372-376,618-627`). Plain Enter-navigation retains focus; only the relocation path loses it.

### R6 · LOW · Nonexistent `?split=` uuid renders a broken empty pane — CONFIRMED
`JuniorPane.tsx:72-77` returns an empty slice for an unknown id and line 136 renders "no more descendants of  to view" (empty doc_no interpolation) instead of an error/auto-close.

### R7 · LOW · Reader rows are role-less fake buttons — CONFIRMED
`tabIndex=0` + `aria-expanded` on a plain `<article>` with no widget `role` (`CollapsibleNode.tsx:301-303`); `aria-expanded` is invalid there and AT announces a plain article. Compounds R1.

**Held up under probing:** pendulum cycle/Alt-reverse/rapid clicks, "N hidden" counts exact vs ground truth (21 tabs, 0 mismatches), collapse-relocation URL + Back behavior, deep links (incl. `view=`, `split=`, `subset=` variants) across the shallow→deep swap, split-pane resize/persist/clamp, KaTeX/tables/fences rendering with no page x-overflow, "Node not found" error paths, breadcrumbs deep/NR/narrow, reduced-motion, 360–1280px viewports.

---

## Sidebar + search

### S1 · HIGH · Tree keyboard navigation throws unhandled exceptions after the visible list shrinks — CONFIRMED
`focusedIndex` (`TreeSidebar.tsx:51`) is never clamped when `expandedIds` shrinks via mouse toggles. With a stale index: Enter/ArrowRight/ArrowLeft hit `visibleNodes[idx].node` → `TypeError` (`src/hooks/useTreeKeyboard.ts:77,53,63`); ArrowUp calls `scrollToRow` with an out-of-range index → react-window `RangeError` (`:45-47`). Four distinct pageerrors captured live; Enter also silently fails to navigate.

### S2 · HIGH · Excluding an ALL-CAPS term (`vault -USDS`) returns zero results for the whole query — CONFIRMED
The ticker auto-phrase loop runs over `restAfterPhrases` **before** exclusion extraction and strips the leading `-` (`src/workers/search.worker.ts:163-176` vs `:203-208`), so `USDS` is added as a **required** phrase and later as an **excluded** term — a self-contradictory filter that rejects every doc. Applies to any excluded all-caps token of length 3–8 (`-SKY`, `-DAO`, …) — the natural way users type ticker exclusions. Controls: `vault` → 370 results, `vault -usds` → 302, `vault -USDS` → 0.

### S3 · MED-HIGH · Quoted phrases starting/ending with a non-word character never match — CONFIRMED
Phrase post-filters compile as `\b<escaped>\b` (`search.worker.ts:240-245`; same anchoring in `searchHighlight.ts:19-20,65-70`). `\b` adjacent to `(`/`)`/`-` never holds, so `"(USDS)"` returns 0 results although the literal string occurs in 3 docs (ground-truthed against docs.json). Violates the documented "quoted phrase = literal substring" contract.

### S4 · MEDIUM · Back to search results always loses the scroll position — CONFIRMED (root-caused)
`useScrollRestore.ts:36` saves scroll in a passive-effect **cleanup**; on unmount it runs after DOM detach, reads `scrollTop === 0`, and `saveScroll(key, 0)` **deletes** the remembered offset (`scrollMemory.ts`). Query/mode/results are restored; position is always top.

### S5 · MEDIUM · Clicking the already-selected sidebar row swallows the next navigation's scroll-into-view — CONFIRMED
`handleRowClick` sets `clickedRef=true` unconditionally (`TreeSidebar.tsx:390-398`); if `nodeId` doesn't change, the consuming effect (`:249-264`) never runs, so the *next* real navigation consumes the stale flag and skips `scrollToRow` — ancestors expand but the selected row stays off-screen.

### S6 · LOW-MED · Aborted shift-click cascade leaks hidden expansion state — CONFIRMED
Plain-toggle collapse doesn't clear `revealTimer` (`TreeSidebar.tsx:369-374`, unlike `collapseSubtree` `:333-334`); orphaned cascade ticks keep expanding under the collapsed root. Next one-level expand reveals 3 pre-expanded levels (8 expected rows → 21).

### S7 · LOW · Phrase search can't match rendered text spanning markdown syntax — CONFIRMED
Search runs over raw markdown: `"returns False"` fails when the source is `` returns `False` ``; rendered link text fails likewise. Arguably by design, but it breaks copy-from-reader-paste-into-search.

### S8 · LOW · Reader→sidebar reveal is a no-op for NR-X docs — CODE-SUSPECTED
`addAncestors` walks doc_no `"."`-prefixes (`TreeSidebar.tsx:23-38`); `"NR-5"` has no dots, so reveal-on-expand does nothing for NR docs (selection path unaffected — it uses `parentOf`). Not live-confirmed (niche setup).

### S9 · LOW · Tree drawer unreachable below 1050px on home/search routes — CONFIRMED (intent unclear)
The sidebar mounts off-screen on `/` and search results, but only `AtlasView` renders the "☰ Atlas" toggle — narrow-viewport home/search has no way to open it, while the tree still loads its data.

**Held up:** virtualization at extremes (564 rows, no reuse artifacts), cascade happy paths, keyboard basics + ARIA (`aria-level` correct even past the depth cap), drawer resize/persist/breakpoint, selected-only view structure + counts, search operators vs computed ground truth (`type:`, `in:`, case-sensitive quotes, fuzzy, ticker, chainlog tier, brute-scan path, mode pills, mixed quotes), search→reader→Back state (except S4), missing search-index error state.

---

## History

### H1 · MED-HIGH · A transient 5xx is cached as permanent "no history recorded" for the whole session — CONFIRMED
`loadHistory` caches `r.ok ? json : null` — **any** non-ok response, including the 503 the server returns on a DB hiccup (`src/server/history/history.ts:114-116`), resolves to null and the promise is cached permanently; only a fetch *rejection* evicts (`src/lib/history.ts:134-140`). The adjacent comment says only "stable" outcomes (GH-Pages 404) should be cached — 503 violates that intent. Reproduced with a mocked 503: the panel claims "no history recorded" and never re-fetches for the session.

### H2 · MEDIUM · 335 html-era rows render a nonsense self-move: "moved from A.1.11 to A.1.11" — CONFIRMED
`scripts/htmlhist/history-html-era.mjs:240-241` fires `pathChanged` when doc_no **or ancestors or title** changed but always records `movedFrom`/`movedTo` as the doc_no pair — identical when only title/ancestors changed. The frozen artifact and DB carry 335 such rows across 296 docs (SQL re-verified); neither `movePaths` (`src/lib/history.ts:101-105`) nor `EntryRow.tsx:139-155` guards the self-move case.

### H3 · MEDIUM · Radar ActorHistory renders a blank heading row for severed-era entries — CONFIRMED
Severed rows have `committed_at NULL` → server sends `date: ""`; `ActorHistory.tsx:235-237` renders `{entry.date}{prSuffix}` with no fallback (NodeHistory uses `severedRange`; ActorHistory doesn't). Affects 4 of 15 actors (spark, grove, keel, skybase): the last history entry is a clickable row with an empty heading.

### H4 · LOW-MED · Pre-git ordering rule diverges between the two history views — CODE-SUSPECTED (latent)
NodeHistory sorts by `commitSeq` (severed −10000 > genesis −20000 > mip −30000, chronologically correct); ActorHistory sorts merged groups by date **string** (`ActorHistory.tsx:139`) where severed's `""` sorts below real dates. Currently invisible (no actor has genesis/mip entries — verified across all 15), but any future actor with mixed pre-git eras will order wrong in radar.

### H5 · LOW · Cross-era date convention mismatch shows an off-by-one date — CONFIRMED
Markdown-era ingest stores the **author-local** date (`build-history.mjs:531`, `%aI`.slice(0,10)); html-era rows store full ISO timestamps rendered as **UTC** (`history.ts:46`). Commit `d675573` (authored 2025-11-13T21:47−03:00) displays as 2025-11-14 on the PR #111 row. One of 79 html-era commits crosses midnight today; the markdown-era side is only safe while the worker runs in UTC.

### H6 · LOW · Dead plumbing: `reviewCount`/`approvalCount`/`commentCount` selected, typed, transported — rendered nowhere — CONFIRMED
Three COALESCEs + the `atlas_prs` LEFT JOIN in both queries (`history.ts:103-105,150-152`), typed in `HistoryEntry`, set in `toEntry` — zero renders in `src/components`. Pure payload overhead on every history response (the join itself still supplies PR title/url).

### H7 · LOW · `changeKind` (lint/typo) surfaced only in radar, never in the reader's EntryRow — CONFIRMED
PR #199 "Global linting" renders in the atlas panel as a plain "edited", indistinguishable from a semantic edit, though the data is in the payload; radar's DocTable shows the muted lint/typo tag.

### H8 · INFO (minor observations)
Batch endpoint silently truncates >2000 ids (shipped client never hits it) · `GET /api/history/` (empty id) falls through to the SPA as 200 HTML · `Cache-Control: public, max-age=300` on the versionless single-doc GET can serve stale history for up to 5 min after an atlas bump · same-commit content+structural row order is Postgres-arbitrary (currently stable) · table-lint diffs render removed column padding as long strikethrough bars (faithful but noisy).

**Held up:** on-screen order == `commit_seq DESC` verified row-for-row against SQL for all probe docs (incl. an 11-row all-eras doc); reconstructed toggle placement/disclaimers/`aria-pressed`; ROOT_SHA "committed" relabel; severed month-range rendering (no Invalid Date anywhere); PR/commit/source links; DiffView gutter glyphs + intraline segments byte-checked against `diff_json`; API edge cases (404s, `[]`, dedup, 2000-id batch in ~96ms); no legacy double-encoded diffs exist in this DB (repair path code-reviewed only).

---

## Collections + selection

*(API/selection agent ran against the server + a UI follow-up agent against the corrected users-enabled bundle. Production has the users surface enabled, so these apply to prod.)*

### C1 · MEDIUM · Malformed collection id in the path → unhandled 500 with an HTML body — CONFIRMED (re-verified)
No id-format validation and no try/catch around DB calls in `handleCollections`/`handleSharedCollection` (`src/server/collections.ts:98-145`): `PATCH|DELETE /api/collections/not-a-uuid` and `GET /api/collections/zzz/shared` all 500 (Postgres uuid cast error) instead of 404, with a non-JSON body. Well-formed unknown UUIDs correctly 404. The `/c/:id` UI masks it (client treats any non-ok as "could not be found").

### C2 · MEDIUM · Non-string `name` → unhandled 500 — CONFIRMED (re-verified)
`if (!body.name?.trim())` (`collections.ts:167,181`) passes numbers/booleans/arrays/objects (truthy, no `.trim`) → `TypeError` → 500. `{"name":42}`, `true`, `["a"]`, `{}` all 500; `null` correctly 400s.

### C3 · MEDIUM · Oversized `doc_id` → unhandled 500 — CONFIRMED
Ids are count-checked (`MAX_IDS`) and type-checked but never length-checked; a ~1MB id overflows the `(collection_id, doc_id)` btree index tuple → unhandled DB error → 500.

### C4 · MEDIUM · Opening an empty collection silently wipes the working selection and strips the URL — CONFIRMED (both paths)
`openCollection` calls `replace([])` (`CollectionsPage.tsx:35`; same via `/c/:id` opener), then SelectionProvider's empties-effect (`src/lib/selection.tsx:73-78`) resets `selectedOnly` + active id/name — the user lands on the full atlas at a dangling `/atlas?` URL with no message, and an unsaved prior selection is unrecoverable.

### C5 · MEDIUM · A 200-char collection name breaks the /collections layout — CONFIRMED
Server accepts names to 200 chars (`MAX_NAME_LEN`, `collections.ts:32`) while the UI caps at 32; an unbroken 200-char name (API-creatable) renders the card's name button at 2419px inside a 672px card — page-level horizontal scroll, card date pushed out of view. `CollectionCard.tsx:76-82` has no `truncate`/`break-words`/`min-w-0` (the doc-title rows at line 101 do). Related: inline rename loads the full long value into a `maxLength=32` input; deleting one char and saving PATCHes a 199-char name successfully — the 32 cap only prevents growth (`CollectionCard.tsx:37-42,63`).

### C6 · LOW-MED · Opening any collection replaces an unsaved working selection with no confirm — CONFIRMED
`replace(c.ids)` unconditional on both open paths; delete has a confirm, open does not.

### C7 · LOW-MED · Selection of doc ids absent from the atlas → blank reader with the pill still counting them — CONFIRMED
Collections store `doc_id` as text with no liveness check; ids that left the atlas render a fully blank tree+reader in selected-only view while the pill says "Selected · 3". No empty-state message.

### C8 · LOW · `loadSelection` accepts non-string array elements — CONFIRMED
`selectionStore.ts:18` checks `Array.isArray(parsed.ids)` only; `ids:[1,2,3]` loads as a numeric selection (server-side `isStringArray` would reject the same shape).

### C9 · INFO · Silent build/runtime flag divergence compiles the whole users/collections UI off with no warning
`vite.config.ts:46` reads `process.env.VITE_USERS_ENABLED` (`.env.local` does not reach the config's process.env), while the server independently enables the surface from `USERS_ENABLED`+`CHAT_JWT_SECRET`. A client built without the shell var against a users-enabled server ships a bundle where `usersEnabled()` is hard-`false`: no auth probe, no collections nav, sign-in gate forever — silently. This bit the QA harness itself and is a plausible prod footgun; a boot-time console warning on flag mismatch (runtime true, build-time false) would catch it.

### C10 · INFO · Signed-out save modal with zero configured providers is a dead end (environmental trigger)
Heading only, no buttons, no visible cancel (Escape/backdrop do work) — only reachable when no OAuth provider is configured; prod has GitHub configured.

**Held up:** full authed UI lifecycle (create → list with resolved doc titles → open exact docs → in-place update → rename caps/cancel/blur → share incl. clipboard *and* `window.prompt` fallback → `/c/:id` logged-out open (name set, active id deliberately not) → delete with confirm both ways, DB-verified incl. cascade); authz (401s, ownership 404s, double-delete); SQL-injection + XSS safe (parameterized, React text interpolation); limits (8000/8001, empty/1MB names, malformed JSON, mixed-type ids); dedup + position ordering; localStorage corruption recovery (bad JSON, wrong version, 100k ids); analytics call sites present (no-op locally without a PostHog key).

---

## Radar

### RD1 · HIGH · Instance param addresses always link to Etherscan, even for Base/Arbitrum/Avalanche addresses — CONFIRMED
`renderValue` calls `explorerUrl(value)` with no chain hint (`src/components/radar/ActorInstances.tsx:27-29`); `resolveChain` defaults every EVM address to `ethereum` (`src/lib/explorer.ts`). All **125** explorer links on `/radar/spark` point at etherscan.io, including e.g. USDC-on-Base `0x833589…` ("Base - Morpho Blue USDC ERC4626 Vault") — a mainnet dead end. 58 instance params across Spark/Grove/Keel carry explicit non-Ethereum hints in the param key or instance name ("Token Address (Base)", "Avalanche - …") that `resolveChain(hint, addr)` already understands — the hint is just never passed. Solana addresses are shape-detected and correct. Upstream twin: `addresses.atlas.json` also stamps these `chain:"ethereum"`, so the build-pipeline chain detector misses ICD-table context too.

### RD2 · MEDIUM · Actors with only structural history show "no history recorded"; renumbering commits vanish from every actor history — CONFIRMED
`ActorHistory.tsx:113` drops ALL `moved` entries. `/radar/keel-freezer-multisig` claims "no history recorded" while the same doc's atlas panel shows 2 entries one click away (PR #236, #117) — 3 actors affected. For Spark, the two renumbering commits vanish entirely: 2,116 of 3,632 fetched entries (58%) are discarded client-side.

### RD3 · MEDIUM · Dashboard vs actor page disagree on instance counts; the Root Edit cell links to a dead anchor — CONFIRMED
`actorIndex.ts:121` excludes `root-edit` instances; `primitiveStats.ts:159-168` doesn't (dashboard "63 Total Instances" vs actor "Instances (62)", all 8 prime agents), and `CategoryRows.tsx` links the Root Edit count to `#root-edit-active`, which never exists on the page.

### RD4 · MED-LOW · 99 dashboard anchor links target elements that don't exist — CONFIRMED
`ActorItemsSection` filters out zero-instance primitives/categories (`ActorInstances.tsx:168-171`) but `CategoryRows.tsx` renders primitive/category links unconditionally: 99 dead fragments across the 8 agents; clicking silently lands at page top.

### RD5 · LOW-MED · Hash-anchor re-scroll on every re-render yanks the viewport — CONFIRMED
`ActorDashboard.tsx:79-84` runs `scrollIntoView` in a `useEffect` with **no dependency array**; at ≤850px, opening the actors drawer with `#instances` in the URL jumps the viewport from scrollY 0 back to 1001, every time.

### RD6 · LOW · Invalid `?exec=` renders a blank dashboard with no message — CONFIRMED
`execCodec` accepts any string; `?exec=bogus` shows zero panels and no "no agents match" state.

### RD7 · LOW · Multi-composite membership hidden — CONFIRMED
`actorIndex.ts:252-254` uses `.find()` on `comprises` edges: Development Company (member of both Keel and Skybase parties) shows only "part of Keel"; the second membership appears nowhere (comprises edges are also excluded from Relationships).

### RD8 · LOW · Sidebar filter with zero matches renders a blank strip, no empty state — CONFIRMED

### RD9 · LOW (perf) · Actor history batch ships 1.59MB for Spark; ~60% discarded client-side — CONFIRMED
1,251-id POST → 1.59MB (86ms locally): 58% of entries are `moved` rows the client drops (RD2), and 832 `diff` payloads (~10% of bytes) are never rendered by ActorHistory. Uncacheable POST, re-fetched per visit.

### RD10 · LOW · Radar Rewards drops address labels shown in the Rewards report — CODE-SUSPECTED
`ActorRewards.tsx` passes `addrMap={{}}` where `RewardsReport.tsx:139` loads the real map — reward addresses lose chainlog/entity labels on radar.

**Held up:** all 137 actor slugs crawl clean (zero pageerrors, no blank pages, no duplicate slugs); dashboard totals match relations.json exactly for all 8 agents; `?exec=` valid roundtrip; slug edge cases; hash-on-mount scroll clears the 64px sticky header; ActorHistory DOM matches an independently-replicated mergeByCommit; Relationships/Composite/Contact sections match graph ground truth; no horizontal overflow at 800/1280px desktop.

---

## Live site (production-only findings)

### L1 · MEDIUM · OG / Twitter / canonical URLs emitted with `http://` scheme on every route — CONFIRMED
`src/server/index.ts:310,324` uses `url.origin` from the incoming request; Railway's edge terminates TLS so Bun sees `http`. `og:url`, `og:image`, `twitter:image`, and `<link rel="canonical">` all say `http://atlas.redline.support/…` — a wrong canonical SEO signal, and some unfurlers reject http images (the OG endpoints themselves work). Fix direction: honor `x-forwarded-proto` or derive from `config.appUrl`.

### L2 · LOW-MED · Mobile 390px: radar instance param rows clip; content unreachable — CONFIRMED
Param key column (`shrink-0`, up to 306px) plus value `maxWidth: calc(100% - 337px)` (`ActorInstances.tsx:57-70`) at 390px viewport → values render one character per line or fully off-screen, and the 59px overflow can't be scrolled to. `/` and `/atlas` are clean at 390px.

### L3 · LOW · App build provenance lost in prod: footer says `redline-atlas dev`; analytics tag `app_commit: "dev"` — CONFIRMED
`vite.config.ts` derives `__COMMIT_HASH__` from `git rev-parse` with a `"dev"` fallback; the Railway Docker build has no `.git`. The server already knows `RAILWAY_GIT_COMMIT_SHA` (`config.ts:245-248`) but the Vite define doesn't use it. Deployed app version is unverifiable from the outside and analytics can't distinguish builds.

**Prod observations (informational):** `/api/health` ok, `atlas_sha == db_sha == 441313ab` (no drift vs this campaign), docs 11,149, schema 014 · `__AUTH_PROVIDERS__` = `github` only · sha-keyed artifacts served gzip + `max-age=31536000, immutable` (correct); flat mutable artifacts (`/addresses.json`, `/chain-state.json`, `/history-html-era.json`) have **no Cache-Control** (heuristic caching — worth pinning) · homepage HTML `no-cache` (correct) · only external host is Google Fonts · every logged-out pageview logs one console error from the `401 /api/auth/me` probe (noise worth silencing) · `/manifest.json` 404s (nothing references it; the PWA `/manifest.webmanifest` is fine) · zero pageerrors across all 22 routes swept; reader/sidebar/history/radar spot-checks on prod all behaved.

---

## Cross-cutting themes

1. **Keyboard/a11y cluster (worst of the report):** R1 + S1 + R5 + R7 together make keyboard-only operation of the new reader/sidebar effectively impossible — hijacked activation, crashes after collapse, dropped focus, role-less widgets. Worth treating as one workstream.
2. **`moved`-event handling:** H2 (self-moves in the data), RD2 ("no history recorded" + vanishing renumber commits), H3/H4 (severed-era rendering/ordering) are all facets of structural-history handling diverging between the reader and radar.
3. **Error-path hygiene:** unvalidated inputs 500 (C1-C3), transient failures cached as permanent states (H1, R3), and empty states missing (RD6, RD8, C7, C4) — the happy paths are solid; the sad paths are where nearly everything above lives.
4. **Chain attribution:** RD1's UI-side fix is local (pass the existing hint), but the same miss exists in the build pipeline's `addresses.atlas.json` chain stamping — both sides should move together.

## Environment artifacts (excluded from findings — do not chase)
- 2 e2e failures vs the local stack: `atlas_describe` `_meta.appCommit` (needs Railway-injected env) and the history-gutter test (`page.goto` waits for `load`, which hangs on third-party analytics blocked by this sandbox's proxy; the page renders fine with externals blocked).
- No OAuth client IDs locally → provider buttons absent; OAuth round-trip + `authReturn` covered by code review only (stash/consume logic looks sound).
- `gh` CLI absent during history ingest → a few newest `atlas_prs` rows lack PR metadata locally (e.g. #282).
- Chat, embeddings/semantic search off locally (no API keys); analytics no-op locally (no PostHog key).

## Coverage gaps worth closing (not bugs)
- e2e: 2 reader tests vs the rewritten pendulum surface; zero radar or collections e2e (the two areas with no browser-level coverage at all).
- No unit tests for `useRungs.ts`, `NodeSelectBox.tsx`, `AtlasActionsContext.tsx`.

---

*Evidence (probe scripts, screenshots, request logs, SQL transcripts) was produced in the QA session's scratchpad (`scratchpad/{reader,sidebar,history,radar,collections,collections-ui,live}/`) and file:line references above point at repo HEAD `0925a38`.*
