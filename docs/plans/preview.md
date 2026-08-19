# Preview — view any atlas PR / branch / fork as a live redline atlas

## Problem

Reviewing next-gen-atlas PRs is painful. GitHub's diff is a poor interface for markdown
(≈9 lines of metadata noise per 1 line of real change) and gives you none of the reader
affordances — search, linked docs, radar, glossary.

**Preview** lets anyone paste the URL of an atlas PR, a fork PR, or any branch forked off
`sky-ecosystem/next-gen-atlas`, and get a full RedLens reader for *that* version of the
atlas, with new/changed docs visually flagged. No diff view — the atlas itself, redlined.

Key constraint: **no redeploy.** Pasting a preview URL must work against the running web
service — resolve → loading state → live preview atlas.

---

## Implementation status & handoff (updated 2026-06-11)

This plan is authoritative. Inline `> IMPLEMENTED` blocks mark completed work; where the design
prose under one describes the *original* approach, the block (and the "Superseded" list below)
win. Work is on branch **`futures`**. Build order is the "Build sequencing" section.

### Done
- **Step 1** — commit `65de9efa`. Direct `parseTree()` parser; retires compose.py/python3.
  Files: `scripts/lib/atlas-parser.mjs` (`parseTree`, `checkTreeInvariants`),
  `scripts/required/build-index.mjs` (wired; `parse()` monolith fallback kept),
  `scripts/aux/ab-parse-check.mjs` (A/B harness). Full detail in the step-1 block below.
- **Step 2** — commit `117d67d4`. Env-var build isolation on build-index/graph/glossary
  (`ATLAS_SRC_DIR`/`ATLAS_OUT_DIR`/`ATLAS_ONCHAIN_DIR`/`ATLAS_COMMIT`); fixture
  `scripts_tests/preview-isolation.test.ts`. Step-2 block below.
- **Step 3a** — this commit. Pure, tested server trio under `src/server/preview/`:
  - `resolve.ts` — `decodeId(raw)`, `gateError(p)`, `makeGhClient(token)`, `resolveRef(p, gh)`;
    consts `CANONICAL_OWNER`/`CANONICAL_REPO`. URL-id parse + GitHub resolution (PR→fork head
    repo+sha+state, branch→tip). `sha`-kind ids are resolved upstream via the previews table.
  - `tarball.ts` — `fetchArchive`, `gunzipCapped` (bomb guard), `extractContentArchive`
    (native `Bun.Archive`), `fetchAndExtract`; `DEFAULT_CAPS` (64MB / 20k docs, env-tunable
    `PREVIEW_MAX_DECOMPRESSED_BYTES` / `PREVIEW_MAX_DOCS`); `CapExceededError`, `SourceGoneError`.
    `extractContentArchive` returns `{ srcDir, docCount }` where `srcDir` is the archive's top
    dir (use as `ATLAS_SRC_DIR`).
  - `cache.ts` — `previewPaths(sha)` (`{dir,atlasDir,outDir,metaPath}`), `bundleReady`,
    `read/writeMeta`, `artifactPath` (allowlist), `touch`, `remove`, `evictLru(keep=20)`;
    `PreviewMeta` type, `ARTIFACT_ALLOWLIST`, `PREVIEW_DIR` (`/tmp/previews`, env `PREVIEW_DIR`).
  - `preview.test.ts` — 14 `bun test` cases (run: `bun test src/server/preview/`), incl. the
    decompression-bomb abort and traversal containment. Live-verified end-to-end (real GitHub
    resolve + 13.7MB download + extract of 10,342 docs).

- **Step 3b** — this commit. Server wiring, **verified end-to-end over real HTTP** (boot →
  resolve `main` → SSE `resolving→fetching→building→ready` → artifact + diff). Files:
  - `config.ts` — `previewEnabled`, `githubToken`, `previewDailyQuota` (13),
    `previewMaxConcurrentBuilds` (2), `previewBuildTimeoutMs` (120s).
  - `migrations/007_previews.sql` — the `previews` table (renumbered from 006 on the #70 merge
    to avoid colliding with `006_history_metrics.sql`). Applied by the always-on boot
    `runMigrations()` in `index.ts` (no longer a preview-gated migration call — #70's boot run
    covers it on seeded prod DBs, which `sync.ts` would otherwise skip).
  - `preview/db.ts` — `upsertPreview`, `getPreviewRow` (sha→repo recovery), `isKnownSha`,
    `touchPreview`, `previewsTodayCount` (UTC-day quota). created_at preserved on conflict →
    re-builds are quota-exempt.
  - `preview/build.ts` — `getOrStartBuild(resolved)` + `subscribeBuild(sha, send)`. One
    `Map<sha, Inflight>` = dedup + SSE hub. Spawns index→graph→glossary (`bun`, cwd `config.root`,
    env `ATLAS_SRC_DIR`/`ATLAS_OUT_DIR`/`ATLAS_ONCHAIN_DIR=publicDir`/`ATLAS_COMMIT`, timeout).
    Global semaphore (cap 2). Quota count→build→upsert. Non-zero build-index exit → `build-failed`.
  - `preview/handler.ts` — `handlePreview(req, server, pathname)`, dispatched from the `index.ts`
    fetch fallback (`fetch(req, server)`). `GET /api/preview/:id/events` (SSE, drives build,
    per-IP limit via `server.requestIP`), `:sha/diff.json` (diffDocs vs in-memory main, cached by
    `(sha, mainSha)`, 503 if main not loaded), `:sha/:artifact.json` (40-hex + `artifactPath`
    allowlist). Resolution TTL cache (60s); `sha`-kind id recovers repo from `previews`.
  - `preview/handler.test.ts` — 1 `bun test` case (artifact/meta/diff/allowlist/sha-validation).
  - 58 server `bun test` pass; full vitest 384 + snapshots 134 unaffected.

- **Step 4** — committed (`358a28cd` + `5c97f963`). Unified preview frontend: `DataSourceContext`
  ({base, preview}); `loadAtlas/loadDocs/loadGraph/loadGlossary` + atlas & search workers take a
  base (keyed / `?base=`); `useAtlasData`/`useAtlasTree`/`RadarPage`/`useSearch`/`Footer` read it.
  `/preview/:id/*` mounts the SAME `<App/>` under a wouter `<Router base>` via `PreviewGate` (SSE
  loader → reader/radar/search render against the preview bundle). Banner (links to GitHub
  source). Reports + chat hidden. Footer preview-aware. Right-panel graph relations DISABLED in
  preview (graph worker is a main-only singleton — keying it is the remaining P1).

- **Step 5** — this commit. PR-state worker + accurate diff + redline UI:
  - **PR-state worker** — `src/server/preview/pr-state.ts` `sweepPrStates(sql)`, run each cron
    tick at the top of `scripts/required/atlas-worker.mjs` (before the atlas early-exit). Updates
    `previews.pr_state`; the web service overlays it when serving `meta.json` (`handler.ts`
    `artifactResponse` special-cases meta) so banners flip merged/closed without rebuilding.
  - **Accurate diff** — `src/server/preview/pr-diff.ts`: for PRs, GitHub `/pulls/{n}/files`
    (head vs base = merge-base accurate) → map `content/**/document.md` paths → doc ids
    (`pathToDocNo`); written into the bundle `diff.json` at build time (`build.ts`). `diffResponse`
    serves the bundle diff for PRs, falls back to the vs-main hash diff for branch/sha. Decisive:
    pull-256 = 38 added/0 changed, pull-257 = 0/3 — vs the hash diff's 41/381 and 3/397.
  - **Redline UI** — added → solid green border, changed → dashed (`CollapsibleNode` + `TreeRow`),
    now that changed is accurate. **Pseudo-history**: `PreviewHistory.tsx` (RightPanel branches
    `preview ? PreviewHistory : NodeHistory`) shows "Added/Changed in this preview · pull-N · by
    author" + GitHub link, suppressing the main `/api/history` fetch. **Only-changed toggle**:
    `PreviewViewProvider` (onlyChanged) + `usePreviewKeepSet(byParent)` (changed/added + ancestors,
    same byParent the panes render from); `PreviewTreeToggle` above the sidebar filters BOTH the
    sidebar (`TreeSidebar` walk) and reader (`AtlasReader` docList). Verified: 1089→50 nodes, 38
    green. Main mode confirmed unaffected (no banner, 0 borders, search/radar OK).

- **Step 6** — this commit (2026-06-12). Patches, unified compare diff, fork unlock:
  - **Line/word diffs in preview history** — `patch-diff.ts` `patchToDiffLines` parses GitHub's
    unified `patch` into the live-history `DiffLine[]` shape (LCS word-diff ported from
    build-history.mjs); bundle gains `patches.json` (id → DiffLine[], lazy via `usePreviewPatch`);
    `PreviewHistory` renders `<DiffView>` under the pseudo-entry, with the doc's real main-branch
    `NodeHistory` below ("On the live atlas" — UUIDs are stable so `/api/history/<uuid>` is valid).
  - **Unified accurate diff** — `fetchPreviewFiles`: PR → `/pulls/{n}/files`; branch/sha/fork →
    `compare/main...{sha}` (merge-base, works cross-fork by bare sha). The "branch/sha degrade"
    item is FIXED. Compare's 300-file cap (files don't paginate — verified) recovered via
    per-commit union (≤100 commits, then `diffTruncated`). `runBuild` restructured: diff fetch
    starts before the tarball, graph ∥ glossary (`Promise.all`) — GitHub round-trip fully hidden.
  - **Fork unlock + screening** — see "Fork screening" (Identity section) + security class 3:
    lineage (`checkForkLineage`, `not-a-fork`), shared history (`not-derived`), trust tiers
    (`trust.ts`, `fork-not-trusted`; pools: canonical 10 shared, trusted fork 10/owner,
    known 7 shared, unknown 2 shared; PRs always canonical-pool), fork interstitial + red banner
    (owner, behind-main, trust + new-address warnings), address-introduction count, blocklist
    (migration 007 `blocked_at`+`trust_tier`), noindex everywhere. Live-verified on the real fork
    `sean-mc-grath:sean-assessment` (unknown tier, 13 ahead/4 behind, 9 added/191 changed) +
    pull-257 regression + blocked-sha takedown/evict + interstitial sessionStorage flow.
  - **Markers (supersedes step-5 borders)**: redlines are `+`/`Δ` between doc-no and title
    (white, `PreviewMark`), not green borders; All-mode dims untouched docs to 0.88;
    Changed-only is a flat list (no ancestors).

- **Step 7** — background bundle sweeper (`src/server/preview/sweeper.ts`, started at boot when
  previews are enabled, `PREVIEW_SWEEP_INTERVAL_MS` default 10min). Three jobs per tick:
  **blocked** — evicts bundles of `blocked_at` shas proactively (takedown no longer waits for the
  next request); **stale** — `meta.baseAtlasCommit` (new field, recorded at build) is compared to
  the live `getIndexes().meta.atlasCommit`; once main hot-swaps past a bundle, it's evicted and the
  next visit rebuilds against current main (quota-free) — bundles touched within
  `PREVIEW_SWEEP_GRACE_MS` (10min) are spared so an active session isn't yanked; **lru/orphan** —
  `evictLru` now also runs on the timer, not only after successful builds. Also fixes a latent
  race: `evictLru` treats a mid-build dir as an interrupted one, so concurrent build A finishing
  could delete build B's half-built dir — eviction (post-build + sweeper) now skips
  `inflightShas()`. The PR-state sweep (worker cron) is unchanged and complementary: it owns the
  DB row freshness; this sweeper owns the web service's disk.

### Next — remaining
- **Deploy**: set `GITHUB_TOKEN` on the Railway **web** service; the worker service already has
  it. Migrations `006`/`007` run at boot. (There is no longer a `PREVIEW_ENABLED` /
  `VITE_PREVIEW_ENABLED` flag — the homepage Preview card always renders.)
- **Graph relations keyed** (P1) — re-enable right-panel relations in preview by keying the graph
  worker per base.
- **Dockerfile** `python3` removal; `subscribeBuild` double-`fetching` event (cosmetic).

### Superseded decisions (the design prose still mentions the old plan — these win)
- **Diff is now GitHub PR-files, not the vs-main hash diff, for PRs** (supersedes "Visual
  indicators" + the P2 "merge-base diff baseline"). GitHub computes head-vs-base, so we get
  merge-base accuracy *for free* without git history — the P2 item is effectively done for PRs.
  The vs-main `diffDocs` survives only as the branch/sha fallback. Diff lives in the bundle
  (`out/diff.json`), immutable per preview sha — no longer keyed by `(previewSha, mainSha)` for PRs.
- **Changed docs DO get a node-level border now** (dashed green; added = solid). The earlier
  "only border added; changed is too noisy" note was because of the vs-main false positives — the
  PR-files diff removed them, so changed is real and bordered. (Word-level underlines still P2.)
- **History tab in preview = pseudo-history** (was an open gap). `PreviewHistory` shows the doc's
  add/change in this preview; the main `/api/history` fetch is suppressed in preview.
- **pg advisory lock DROPPED for MVP** (mentioned ~"Storage, two tiers" + "Resolved during
  planning"). Bun.sql *pools* connections, so session `pg_advisory_lock`/`unlock` can land on
  different backends and leak; `pg_advisory_xact_lock` can't span a multi-second build; and under
  single-replica + ephemeral `/tmp` it buys ~nothing. Use the in-process `Map<sha,inflight>`.
  Keep the `previews` **table** (sha→repo durability + quota) — only the lock is dropped.
- **Diff is computed from IN-MEMORY main docs**, not a Postgres `atlas_doc_meta` query (the
  "Visual indicators" section says Postgres). Use `diffDocs(getIndexes().docMap, previewNodes)`
  from `src/server/atlas-refresh.ts` (same `embed-text.ts` `contentHash`). Guard the cold-start
  case (empty indexes) → "main not ready", don't emit an all-added diff. Cache key
  `(previewSha, getIndexes().meta.atlasCommit)`.
- **Whole archive is extracted then `content/` read** (the pipeline step 2 says "stream-extract
  `content/**` only"). `Bun.Archive` can't filter/strip, so we gunzip-with-cap then extract all;
  the cap bounds the full **33.5MB** decompressed archive (not content/ alone) at 64MB. Detail in
  Security §1.

### Verification environment (this machine, 2026-06-11) — confirmed reachable
- Local Postgres at `postgres://redlens:redlens@localhost:5432/redlens`, fully seeded
  (`atlas_doc_meta`, `schema_migrations`, …) → DB paths testable locally.
- `GITHUB_TOKEN=$(gh auth token)` works for resolution + tarball downloads.
- Test commands: server → `bun test src/server/...`; build/parse → `pnpm test`,
  `REPRO=1 pnpm test`, `pnpm test:snap`; A/B parser equivalence → `node scripts/aux/ab-parse-check.mjs`.

---

## Core insight

A full rebuild of `docs.json` + `relations.json` + `glossary.json` + `search-index.json`
from a directory of `content/**/document.md` is **sub-second and needs no network**. The
network-heavy passes (`build-addresses` → Etherscan, `build-history` → GitHub) are *not* on
this path. So we **rebuild the whole artifact bundle per preview** — no diff-versioned
artifacts (that's a correctness minefield for zero payoff).

## Identity & caching

Two-layer identity:

- **URL id** (human, shareable, *mutable* — tracks the branch tip):
  - `/preview/pull-256/atlas`
  - `/preview/blimpa:spark-proposal/radar` (`owner:branch` for forks)
  - `/preview/blimpa:my-atlas:spark/atlas` (`owner:repo:branch` for RENAMED forks, 2026-06-12 —
    the repo name never mattered for safety, only fork lineage does; `:` is unambiguous since
    git forbids it in refs and GitHub in names. `isFork` is now `repo !== CANONICAL_REPO`, so a
    canonical-owner lookalike repo is fork-screened too. Fork `/pull/N` URLs are rejected in the
    input parser — PR numbers are repo-local, only canonical PRs are previewable.)
  - **Fork screening (2026-06-12, supersedes the MVP gate)**: bare `owner:branch` fork URLs
    now resolve, behind three screens — (1) **network** (a CAPABILITY check, not trust): the
    repo must be a TRUE GitHub fork of the canonical atlas (`fork: true` + parent/source =
    canonical), else `not-a-fork` — only repos in the fork network can be merge-base-compared
    by GitHub's API, and without that compare there's no diff to redline against (a
    clone-pushed repo is unaddressable + undiffable, regardless of its content);
    (2) **shared history**: the merge-base compare vs main must succeed, else `not-derived`
    (a real fork can still carry an orphan/rewritten branch — fork-ness is repo-level,
    derivation is commit-level);
    (3) **trust**: the owner's merged-PR track record into sky-ecosystem repos picks a tier
    (`src/server/preview/trust.ts`) — `trusted` (whitelist or ≥1 atlas-merged PR: its OWN
    10/day pool per owner), `known` (org-merged: shared 7/day pool), `unknown` (no history,
    established account: shared 2/day pool + loud warnings), `refused` (no history + account
    <30 days: `fork-not-trusted`). Whitelist: `Endgame-Edge`, `Redline-Group`.
    **PRs are trust-scored too, by their AUTHOR** — opening a PR is cheap, so PR-ness never
    upgrades treatment; it only un-refuses (`effectivePrTier`: refused→unknown, so newcomers'
    draft PRs build with full unknown-tier warnings in the 2/day pool). Trusted-author PRs +
    canonical branches share the canonical 10/day pool; known/unknown-author PRs share those
    fork pools. A PR whose head lives on a fork is still a PR preview (no fork banner /
    forkOwner), but warnings + interstitial follow the author's effective tier.
  - **`/` in branch names** (e.g. `feat/parser-fix`) is mapped to `~` in the URL id:
    `/preview/blimpa:feat~parser-fix/atlas`. `~` is URL-unreserved but **forbidden in git ref
    names**, so the mapping is unambiguous and reversible (`~` → `/` on decode). Never emit a
    raw `/` inside the id segment — it collides with route splitting.
- **Cache key** (internal): the resolved **head commit SHA**. Immutable.
  - `/preview/<sha>/...` is also a valid, maximally-shareable pinned URL. Durable only because
    the Postgres `previews` table (below) persists `sha → repo`; the SHA alone can't locate a
    tarball.

Resolution:
- `pull-N` → GitHub API → `head.repo.full_name` + `head.sha`. **The PR head can live on a
  fork** (the `blimpa` example), so read `head.repo` — never assume the canonical repo.
- `owner:branch` / `owner:repo:branch` / `branch` → GitHub API → branch tip SHA.
- In-memory `id → { sha, resolvedAt }` map, short TTL (~60s). On miss/expiry, re-resolve the
  tip; unchanged SHA → serve cache; moved SHA (new PR commits / branch push) → build the new
  SHA. **This is how "branch receives updates" solves itself.**

Storage, two tiers:

- **Postgres `previews` table** (metadata only, NOT bundles): `sha PK, repo, ref, kind,
  created_at, last_access, doc_count, build_ms`. This is what makes `/preview/<sha>` pinned
  URLs durable — a bare SHA does not identify a repo (tarball URL needs `<repo>/archive/<sha>`),
  so without the persisted `sha → repo` map a pinned URL dies the moment the bundle is evicted
  or the instance restarts. With it, a cold hit is: look up repo → re-fetch tarball → rebuild.
  The table also gives cross-restart build locks (`pg_advisory_lock(hashtext(sha))` instead of
  an in-memory mutex) and per-IP/per-day abuse accounting + build telemetry. One migration,
  Bun.sql, already in the server.
- **Bundles on disk** at `/tmp/previews/<sha>/{docs.json,relations.json,glossary.json,search-index.json,meta.json}`,
  LRU-evicted. Everything here is regenerable from the `previews` row, so ephemeral is fine.

Generation runs **on first hit** (dominated by tarball download, a few seconds); SHA-cached
thereafter. No job queue. The client is never left holding a long blocking request: build
progress streams over **SSE** (same `text/event-stream` pattern as `/api/chat`) — see Build
status & loading UX.

**Considered and deferred: Railway object-storage buckets for bundles.** SHA-keyed immutable
objects are a natural content-addressed L2 cache (bundles survive deploys, lifecycle rules own
eviction, multi-replica ready). But once the `sha → repo` map exists, bundle durability buys
only "skip a few-second rebuild after a restart" at the cost of a credential, an S3 client, a
second cache tier, and a new failure mode. P2 swap-in behind the same cache interface, adopted
only if pinned URLs must load instantly forever or the singleton constraint lifts. Corollary:
nothing mutable may live in the bundle (see diff-at-serve-time below) so bucket objects stay
truly immutable if/when this lands.

### Filesystem semantics (Railway)

`railway.toml` configures **no volume** and `restartPolicyType = "ON_FAILURE"`. The Railway
filesystem is **ephemeral** — wiped not only on redeploy/image-update but also on every
restart (crash/`ON_FAILURE` retry, OOM, manual restart, platform migration). The runtime
already writes the FS freely (`Dockerfile:52` symlinks `dist → public`; atlas-updater writes
`public/*.json` at runtime), so `/tmp/previews/` is fine.

**Decision: do NOT add a Railway Volume.** Previews are a regenerable cache — a wipe just
costs one re-fetch+rebuild (~seconds) on next access. A volume would accumulate stale bundles
across deploys and force us to own eviction. Ephemeral-by-default is correct; restarts are the
GC. Keep an in-process LRU cap for within-instance lifetime.

## Generation pipeline (runs in the web service)

Decided: runs **in the web service** — the no-redeploy requirement forces request-time,
in-process generation. The server already spawns `build-graph`/`build-glossary` at runtime
(atlas-updater), so Bun + the scripts are present in the runtime image.

1. Resolve id → `{ repo, sha }` via GitHub API (`GITHUB_TOKEN` required; unauth = 60 req/hr).
2. Download tarball `https://github.com/<repo>/archive/<sha>.tar.gz`, stream-extract
   `content/**` only into `/tmp/previews/<sha>/atlas/` (caps + sanitization per the Security
   section). (No git in the web image — tarball, not clone.)
3. Isolated build into `/tmp/previews/<sha>/out/`: `build-index` (via `parseTree`, see below) →
   `build-graph` → `build-glossary`. No python, no compose.
4. Upsert the `previews` row (repo, ref, telemetry).
5. Serve the bundle via `GET /api/preview/<sha>/<artifact>.json`. The diff is NOT part of the
   bundle — it's cached separately, keyed by (preview sha, main sha) (see Visual indicators).

### Build status & loading UX

Entering a `/preview/:id/*` route opens `GET /api/preview/<id>/events` (SSE, same pattern as
`/api/chat`). The server emits phase events: `resolving` → `fetching` → `building` → `ready`
(carrying the resolved sha) or `failed` (carrying an error code, see below). If the bundle is
already cached, the stream emits `ready` immediately.

While waiting, the frontend shows a full-screen loading state with the text
**"Preparing preview Sky Atlas…"**. On `ready`, it fetches `docs.json`,
`relations.json`, `search-index.json` (+ `glossary.json`) from the bundle and swaps in the
reader. No polling, no held artifact requests.

### meta.json

Written by the build, consumed by the banner + interstitial:

```
{ sha, repo, ref, kind: "pr" | "branch" | "sha", prNumber?, prTitle?, prAuthor?,
  prState?: "open" | "merged" | "closed", resolvedAt, docCount, buildMs }
```

`prState` starts as `"open"` at resolution time and is refreshed by the PR-state sweep (see
Banner section).

### Error states (each user-distinguishable)

Delivered as the SSE `failed` event code + message; direct artifact GETs for unknown SHAs
return matching HTTP errors.

- `gate-rejected` — bare fork `owner:branch` under the MVP trigger gate → "Open a draft PR
  against next-gen-atlas to preview this branch."
- `not-found` — no such PR number / branch / unknown pinned sha.
- `source-gone` — tarball 404 (fork repo deleted, e.g. after PR close).
- `cap-exceeded` — decompressed-size or doc-count cap hit.
- `build-failed` — subprocess non-zero exit / timeout / memory kill.
- `rate-limited` — per-IP resolve limit hit.
- `quota-exceeded` — global daily analysis quota exhausted (see Security) → "The scrying
  pool is exhausted for today."

### P0 foundation: direct content/** → JSON parser (kills compose.py / python3)

`build-index.mjs:111` currently composes `content/**/document.md` → synthetic `Sky Atlas.md`
via `python3 sync/compose.py`, then re-parses that monolith with `HEADING_RE`. That round-trip
is pointless: each `document.md` frontmatter already carries `id`/`docNo`/`name`/`type` — what
the regex re-extracts. **Replace it with a direct tree parser** so the build (and previews)
never composes or shells to python.

New `parseTree(contentRoot)` in `scripts/lib/atlas-parser.mjs`, producing the SAME `nodes[]`
array `parse(composedSrc)` produces today:

| field | source |
|---|---|
| `id`, `doc_no`, `title`, `type` | frontmatter `id`/`docNo`/`name`/`type` (no regex) |
| `content` | lines after the heading line in `document.md`, then `cleanContent()` |
| `contentHash` | `sha256(content lines joined "\n")` — byte-identical to today (compose emits those exact `content_lines` verbatim) |
| `depth` | **structural**: `min(ancestor folders containing document.md + 1, 6)` — NOT frontmatter `depth` (semantic). compose recomputes this; we must too. Phantom extension folders (`.0.4.X` etc., only `_index.md`) don't count. |
| `order` | tree-walk emit index — port compose's `compose()` walk |
| `parentId` | reuse today's ancestor-stack block, unchanged, over the ordered list |

Strategy for zero drift: **port compose.py's `compose()` traversal to JS but emit node objects
instead of markdown lines** (depth-first from `content/A/`; at each folder emit its non-NR
`document.md`, then NRs whose `targets[0]` matches sorted by NR number, then recurse into
children sorted real-doc-first / integer-ascending per `_child_sort_key`; `content/NR/` reached
only via targets). `_index.md` corroborates sibling order but omits phantom folders, so the
walk — not `_index.md` alone — is the traversal source of truth (use `_index.md` as a
validation cross-check). Then run the existing ancestor-stack for `parentId`.

**Acceptance gate** (decided, two layers):

1. **One-shot A/B harness** for the compose→parseTree switch: build via the compose path,
   stash artifact hashes, build via parseTree, byte-compare all four artifacts (docs /
   relations / glossary / search-index). Note `REPRO=1 pnpm test` alone proves *determinism*,
   not old↔new equivalence (it hashes whatever's on disk and rebuilds with current code);
   `test:snap` covers relations.json only — hence the explicit A/B.
2. **Standing invariant checks on every parse** (main + previews — cheap, fail loudly).
   Silent-divergence risk is structurally low here: the decomposed tree encodes identity
   **redundantly** — each `document.md` carries `id`/`docNo` in frontmatter, *and* the folder
   path independently encodes the same doc_no (`content/A/1/1/1/` ⇔ `A.1.1.1`). The
   monolith was the older, lossier format; the new one cross-validates itself. So the checks
   are mostly free redundancy assertions: path-derived doc_no == frontmatter `docNo`,
   frontmatter ids seen exactly once, parentId closure, node count == `document.md` count.
   Any disagreement between the two encodings aborts the build (previews: surfaces as
   `build-failed`).

> **IMPLEMENTED (step 1, 2026-06-11).** `parseTree()` + `checkTreeInvariants()` in
> `scripts/lib/atlas-parser.mjs`; build-index wired to it (compose/python removed, monolith
> `parse()` kept as fallback); A/B harness at `scripts/aux/ab-parse-check.mjs`. Gates all green
> (A/B byte-identical 10,342 nodes × 9 fields; test:snap 134; REPRO; full suite 383). Two
> decisions from review to carry into step 3:
>
> - **`parseTree` is STRICTER than compose.py** — it *throws* on the invariants above; compose.py
>   only warns-and-continues (unemitted docs, orphan NRs) and never checks path==docNo. Identical
>   on today's well-formed atlas. But a messy unmerged PR (hand-edited `docNo` without moving the
>   folder, transient dup uuid) will hard-fail `parseTree`. **Decided: hard-fail is correct for
>   MVP** — the build-index subprocess exits non-zero, which the step-3 server maps to the
>   existing `build-failed` error state with a clear message. Degrade-to-best-effort is a P2
>   option, not MVP. The step-3 server MUST treat a non-zero build-index exit as `build-failed`
>   (not a 500), so an invariant violation reads as "this PR can't be previewed: <reason>".
> - **`_index.md` is deliberately NOT a hard cross-check.** compose.py — the byte-identity
>   authority — ignores `_index.md` entirely and orders by folder integer-sort; making `_index.md`
>   authoritative would risk *false-failing* trees where compose succeeds (stale `_index.md`, valid
>   folders). The folder walk is the source of truth; `_index.md` is decompose-generated/derived.
>   **Spec-confirmed**: `vendor/next-gen-atlas/sync/README.md` states `_index.md` files "aren't
>   load-bearing for anything other than browsing convenience." Also confirmed there: NR ordering
>   is `targets[0]` placement + numeric order (matches `parseTree`), bodies are byte-faithful, and
>   the README's own `document.md` example shows the display heading uses semantic `depth`+1 hashes
>   — *not* the structural level — which is exactly why `parseTree` recomputes depth structurally.

**Payoff**: removes `python3` + `compose.py` from the build entirely — confirmed: every
`execFileSync`/`spawn` left in `scripts/required` + `scripts/lib` is `git`, none python. No
python in the previews path or the runtime image; main pipeline simplifies too. (Follow-up:
the Dockerfile builder stage can drop its `python3` apt install.)

**Scope boundary**: `build-history` time-travels across the pre-decomposition era (before atlas
commit `15909e53` there was no `content/**`) and keeps its existing compose-based path for old
commits. `parseTree` is for the current tree only. Do not touch build-history in this task.

### Isolation (MANDATORY — correctness/safety)

`build-index.mjs:27` and `build-graph.mjs:53` hardcode `ROOT = path.resolve(__dirname,
"../..")` and read/write `public/` + `vendor/next-gen-atlas/` relative to the **app repo
root**, independent of CWD. A naive previews subprocess would **clobber the live `main`
artifacts** the singleton server serves — corrupting the reader for everyone.

Fix: add env-var overrides (`ATLAS_SRC_DIR` / `ATLAS_OUT_DIR`, defaulting to today's
`ROOT`-relative paths) to `build-index` and `build-graph`. Previews build points them at the
temp dirs. `build-graph` also reads `addresses.json` + `chain-state.json` — point those at
the **existing main copies** (reuse; see caveat). Surgical change; main path stays
byte-identical (verify with `REPRO=1 pnpm test`).

> **IMPLEMENTED (step 2, 2026-06-11).** Four env overrides on `build-index`, `build-graph`,
> **and `build-glossary`** (all three preview-pipeline stages — `build-glossary` reads the
> preview's own `docs.json` and writes its own `glossary.json` via `ATLAS_OUT_DIR`, else it
> would read main's docs and clobber the live glossary). A union grep across the three scripts +
> every `lib/` module they import confirms the only file writers are these three, all now
> `OUT_DIR`-routed. Each override defaults to the current `ROOT`-relative path so the main build
> is byte-identical:
> - `ATLAS_SRC_DIR` — atlas repo root (content/, Sky Atlas/, .git) → build-index source + git.
> - `ATLAS_OUT_DIR` — artifacts this build OWNS (docs / addresses.atlas / graph / relations /
>   search-index — read AND written here).
> - `ATLAS_ONCHAIN_DIR` — inputs REUSED from main (`addresses.json`, `chain-state.json`),
>   defaults to `ATLAS_OUT_DIR`. A preview sets this to main's `public/` so it doesn't refetch
>   Etherscan. Branch-new addresses simply get no on-chain enrichment (MVP-acceptable).
> - `ATLAS_COMMIT` — stamps the known SHA (a tarball extract has no `.git` to `rev-parse`).
>
> These are read once at subprocess startup, so isolation is per-spawn: the preview server
> sets them in the child env per build; concurrent builds are separate processes with separate
> dirs, none touching `public/`. Verified: REPRO byte-identical with no env set; a live build
> into `/tmp` left `public/` hashes unchanged; fixture test `scripts_tests/preview-isolation.test.ts`
> (3 cases) proves isolation + branch-new-address tolerance + on-chain reuse. Full suite 384 ✓,
> snapshots 134 ✓.

## Frontend — data-source base override

Today `loadDocs` / `loadGraph` / `loadAddresses` and the workers hardcode the `BASE_URL`
prefix. Introduce a **data-source base** (React context, threaded into worker init messages):

- normal mode → `${BASE_URL}` (static files, unchanged)
- preview mode → `${BASE_URL}api/preview/<sha>/`

**Loader caches must be keyed.** `loadAtlas` (`src/lib/docs.ts`), `loadGraph`
(`src/lib/graph.ts`), and `loadGlossary` cache a single module-level Promise today. Convert
each to a `Map<sourceKey, Promise>` keyed by `"default" | <preview-id>`, so main → preview →
main navigation never serves the wrong bundle. `loadAddresses` and chain-state stay on the
`"default"` key in both modes (they're deliberately reused from main — per-artifact routing,
not one base swap).

**Workers are keyed the same way.** The search worker (holds a loaded MiniSearch index) and
the graph worker (holds a loaded graphology graph) get one instance per `sourceKey`,
lazily created. The `"default"` workers persist for the session; at most **one** preview's
worker pair is kept alive — entering a different preview (or returning to main) terminates the
previous preview's workers. No index mixing, bounded memory.

Everything downstream (AtlasView, RightPanel, radar, search worker) consumes whatever the
loader returns — no further changes. This is the one moderate-but-contained refactor.

## Visual indicators

`GET /api/preview/<sha>/diff.json` = set-diff of preview `{ uuid → content_hash }` vs
**current main** (sourced from Postgres `atlas_doc_meta`, already in the server's memory via
atlas-refresh):

```
diff.json = { added: [uuid], changed: [uuid] }
```

Cached keyed by **(preview sha, main atlas sha)** — when the atlas-updater advances the main
submodule SHA, the key changes and the diff is recomputed on next access. This keeps redlines
always relative to *current* main without baking a moving target into the SHA-keyed bundle
(which stays a pure function of the preview SHA — immutable, required for the P2 bucket
option). The compare itself is a hash-map walk, microseconds.

**Hash discipline**: the diff no longer uses a hash at all. `diffDocs` compares the served
`title` + `content` directly (`sameServedDoc` in `src/server/atlas-refresh.ts`), because both
available hashes are unfit for this job:

- `contentHash` from `src/server/retrieval/embed-text.ts` is the *embedding*-staleness key. It
  strips markdown links before hashing, so a PR that only retargets a link would be invisible
  here — the diff would silently omit it.
- the parser's `contentHash` field from docs.json (`sha256(raw content lines)`) does see link
  targets, but covers the body only (no title), is optional/NULL-able, and — being carried
  alongside the content rather than derived from it here — can disagree with the content it
  describes.

Comparing the two fields we actually serve is strictly more sensitive than either hash and
cheaper than both (no sha256 per doc). Still renumber-stable: a pure doc_no change is not a
diff entry.

- Green bottom border on tree-view entry + `CollapsibleNode` area for `added` / `changed`. (P1)
- Word-level green underline of new/updated segments → **P2** (needs per-doc text diff).

Baseline caveat (accepted): "vs current main" false-positives a doc the branch didn't touch
but main changed since the fork point. Clean fix = merge-base diff, which needs git history
(tarball doesn't have it). Deferred to P2.

## History in preview mode

Decided: **diff-as-history.** `atlas_history` is Postgres rows the worker writes by walking
*merged* git history — an unmerged branch has none, and a tarball has no git log. So preview
"history" = the list of docs this branch adds/changes vs main, straight from `diff.json`.
Free, tarball-compatible. Real per-commit history (git-clone the branch) is P2.

## Banner & disabled features

- Top banner in preview mode: `Viewing preview of <pull-256 | branch name>`.
- First visit to a given preview: one-click interstitial — "This is unreviewed proposed
  content from `<prAuthor>`, not the live atlas." — dismissed per preview per session.
- **PR state (P1)**: merged PRs are implicitly detectable (the merge advances main, same
  signal the atlas-updater already watches), but *closed* needs active checking — so one
  uniform mechanism: a small process on the **worker service** sweeps `previews` rows with
  `kind = "pr"`, queries GitHub for PR state, and updates `prState` in the row + `meta.json`.
  Banner reflects it: "This PR was merged into the live atlas" / "This PR was closed without
  merging".
- Disabled in preview view: reports, AI/chat. (Hide nav entries when route is `/preview/*`.)

## Caveats to surface

- **Addresses**: reusing main's `addresses.json` means branch-*new* addresses get atlas
  annotation (roles/labels from content, no network) but no on-chain enrichment (Etherscan
  name/proxy/contract). Missing data is acceptable for MVP. **Test (P0)**: fixture run —
  copy current content, inject a doc containing a brand-new address, run `build-graph`
  against an `addresses.json` that lacks it; assert the build completes, the address gets
  atlas-only annotation (Phase 2.6/4.5), `has_address` edges still emit (Phase 2.5), and
  on-chain fields are simply absent.
- **Diff baseline** false positive (above).
- **Torn read of main's `addresses.json`/`chain-state.json`** while the atlas-updater
  rewrites them mid-previews-build: accepted risk — rare, and the blast radius is one stale
  preview bundle (rebuildable). Not worth coordinating.

## Scope

**P0**
- `parseTree(contentRoot)` — direct content/** → JSON, retire compose.py/python3 (foundation;
  gated by the A/B harness + standing invariant checks)
- id → SHA resolution (PRs incl. fork heads + canonical branches; MVP trigger gate), tarball
  stream-fetch with caps, isolated build (index+graph+glossary)
- Postgres `previews` table: `sha → repo` map (pinned-URL durability), advisory build locks,
  daily quota + abuse accounting
- security hardening: input validation, artifact allowlist, subprocess timeout/memory limit,
  global build cap, per-IP rate limit
- disk cache (keep 20 MRU) + `GET /api/preview/<sha>/*`; diff cached keyed by
  (preview sha, main sha)
- SSE build-status stream; "Preparing preview Sky Atlas…" loading state; error states
- frontend data-source base override; keyed loader caches + keyed workers; reader works in
  preview mode
- `/preview/:id/*` routing; top banner + first-visit interstitial
- reports + chat hidden in preview mode
- fixture test: branch-new address through build-graph 2.5/2.6/4.5

**P1**
- radar in preview mode (nearly free — consumes `relations.json`)
- green new/changed indicators from `diff.json`
- PR-state sweep on the worker service (merged/closed banners)

**P2**
- word-level green underlines
- real per-commit history (git clone)
- merge-base diff baseline
- Railway bucket as bundle L2 cache (same cache interface; only if instant pinned URLs or
  multi-replica become requirements)

## Security / abuse hardening (decided)

The endpoint downloads externally-controlled tarballs and runs builds on the production
singleton, unauthenticated. Three attack classes and their answers:

1. **Hostile input content** (decompression bombs, 500k-doc trees → OOM/disk-full → singleton
   restart → site-wide downtime). Mitigations, all P0:
   - **IMPLEMENTED (step 3a, 2026-06-11)** in `src/server/preview/tarball.ts`. Two layers:
     (a) **bomb guard** — we gunzip the fetched stream ourselves with a running byte counter
     (`gunzipCapped`) and abort the moment decompressed output exceeds the cap, before that many
     bytes are buffered; (b) **tar parsing + path containment** delegated to the native
     **`Bun.Archive`** (Bun ≥1.3) rather than a hand-rolled parser — verified that `../`
     traversal entries are collapsed in-bounds and never escape the extract dir. The build reads
     only the archive's `<top>/content/**`; other entries (Static/, sync/, the composed monolith)
     are extracted alongside and ignored.
   - **Cap is the FULL decompressed archive, not content/ alone** — the earlier "5.6MB / 2.9MB"
     figure measured `content/` only and is stale. Live measurement 2026-06: gz **13.7MB**,
     decompressed **33.5MB** (content/ + a 12MB `Static/` + the 3.4MB composed monolith). Cap set
     to **64MB** (≈90% growth headroom; bounds a bomb), env-tunable via
     `PREVIEW_MAX_DECOMPRESSED_BYTES`; doc-count cap **20k** (`PREVIEW_MAX_DOCS`). The 33.5MB
     plain tar is held in memory during extraction (×2 concurrency ≈ 128MB peak — acceptable
     against the server's existing ~300MB index). (Alternatives evaluated: Git Trees API ≈ 10k
     calls/build kills the 5,000/hr budget; one tarball wins despite the size.)
   - build subprocess gets a timeout — an OOM/hang kills the build, not the server. Explicit
     memory limit deferred: input is already bounded by the 64MB/20k caps, which bounds build
     memory by construction.
   - global cap of 2 concurrent builds with a small queue (in-process `Map<sha,inflight>` also
     dedups concurrent requests for the same sha → one build, many SSE subscribers)
2. **Hostile requests**. P0: strict 40-hex validation on `<sha>` path params; artifact-name
   allowlist on `GET /api/preview/<sha>/<artifact>.json` (else path traversal into `/tmp`);
   per-IP rate limit on resolution (reuse `src/server/rate-limit.ts`).
   - **Global daily analysis quota** (commons limit): max **13 new previews per UTC ISO day**,
     enforced with what we already store — each newly-analyzed SHA inserts one `previews` row,
     so the check is `SELECT count(*) FROM previews WHERE created_at >= date_trunc('day',
     now() AT TIME ZONE 'utc')`. Re-*builds* of already-known SHAs (cache wiped by a restart)
     don't insert and are deliberately exempt — regeneration is free, new analysis is quota'd.
     Over quota → `quota-exceeded` error state.
3. **Hostile *plausible* content** — a lookalike branch with swapped addresses, shared via a
   `/preview/...` link as if legit (credibility-wrapper attack). **IMPLEMENTED (2026-06-12)**
   when arbitrary forks unlocked:
   - **Lineage + shared-history + trust screens** (see "Fork screening" above) — repo-name
     spoofing blocked, no-common-ancestor repos rejected, history-less fresh accounts refused.
   - **Low-trust interstitial** (`PreviewInterstitial.tsx`): first visit per session shows a
     one-click warning — owner named, "never had a PR accepted" line for unknown-tier owners,
     address warning — dismissed per sha (sessionStorage). Shown for NON-trusted forks and
     unknown-author PRs; **trusted-tier forks (whitelist / atlas-merged) skip it** — their
     fork banner still carries provenance + address notes. Canonical branches and
     trusted/known-author PRs stay banner-only.
   - **Fork banner variant** (`PreviewBanner.tsx`): red `FORK PREVIEW` chip, owner, commits
     behind main, trust + new-address warnings.
   - **Address-introduction screen**: at build time the bundle's `addresses.atlas.json` keys
     are compared against main's → `meta.newAddresses`; banner + interstitial warn when > 0
     (targets the swapped-payment-address attack specifically).
   - **Blocklist** (migration 007 `blocked_at`): a blocked sha never serves or rebuilds and
     its bundle is evicted. Takedown = `UPDATE previews SET blocked_at = now() WHERE sha = …`.
   - **noindex**: `X-Robots-Tag: noindex` on all `/api/preview/*` responses and SPA
     `/preview/*` routes (no SEO laundering of fork content).
   - **Tiered quotas**: `trust_tier` stored per previews row; pools counted per tier —
     canonical (branches + PRs, NULL tier) shared `PREVIEW_DAILY_QUOTA` 10; each trusted-tier
     fork owner its own `PREVIEW_TRUSTED_FORK_DAILY_QUOTA` 10; known shared
     `PREVIEW_FORK_DAILY_QUOTA` 7; unknown shared `PREVIEW_UNKNOWN_FORK_DAILY_QUOTA` 2.
   - **Compare 300-file cap** (GitHub compare doesn't paginate files): recovered by unioning
     files across the branch's ahead-of-merge-base commits (bounded at 100 commits →
     `meta.diffTruncated` + banner note beyond that).

## Build sequencing (P0 dependency order)

1. **`parseTree` + A/B harness + invariant checks** — pure foundation, no server work,
   independently valuable (kills python3 from the main pipeline even if previews slips).
2. **Env-var isolation** (`ATLAS_SRC_DIR`/`ATLAS_OUT_DIR` in build-index/build-graph) + the
   branch-new-address fixture test — still no server work; gated by `REPRO=1 pnpm test`.
3. **Server**: `previews` migration → resolution (trigger gate, `~` decode, TTL map) → tarball
   stream-extract with caps → build orchestration (advisory lock, global cap, quota) → SSE
   events endpoint → artifact + diff serving. Curl-able previews exist after this chunk,
   before any UI.
4. **Frontend**: keyed loaders/workers → data-source context → `/preview/:id/*` routes →
   scrying loader → banner + interstitial → error states → nav hiding.

## Deployment / housekeeping notes

- **`GITHUB_TOKEN` becomes a required env var on the Railway web service** (previously only
  the worker needed GitHub access). Deploy config, not code.
- The `previews` table migration lives in `src/server/migrations/` — deploy-ordered step.
- **Local dev**: previews requires `pnpm dev:server` with `GITHUB_TOKEN` + `DATABASE_URL`
  (same caveat as the history tab). Add one sentence to CLAUDE.md's Local dev section when
  this ships.
- **`pull-` prefix is reserved** in URL ids: a canonical branch literally named `pull-256`
  loses to the PR interpretation. Accepted absurd-edge-case.

## Resolved during planning (pointers)

- Per-SHA build lock: `pg_advisory_lock(hashtext(sha))`; global cap 2 concurrent builds +
  small queue (Security §1).
- Disk cache policy: keep the **20 most-recently-accessed** previews under `/tmp/previews/`,
  evict beyond that, sweep orphans on boot (restarts wipe `/tmp` anyway).
- Phase 2.5/4.5 with branch-new addresses: missing on-chain data accepted for MVP; fixture
  test specced in Caveats.
- First-hit UX: SSE build-status stream (Build status & loading UX).

## Open implementation questions (for build phase)

- GitHub API token scope for fork-PR tarballs; confirm codeload tarball downloads don't
  count against the 5,000/hr API budget (only resolution calls should).
