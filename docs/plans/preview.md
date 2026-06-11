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
  - **MVP trigger gate (temporary)**: at launch, only open PRs against
    `sky-ecosystem/next-gen-atlas` (including fork-head PRs) and branches on that repo
    resolve; bare `owner:branch` fork URLs return a friendly "open a draft PR to preview"
    error. This makes every buildable input publicly proposed and attributable. The
    `owner:branch` grammar and resolution path stay in the design — the end state is **any
    fork URL**, unlocked once safety screening (content/size vetting) exists (P2).
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
- `owner:branch` / `branch` → GitHub API → branch tip SHA.
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

**Hash discipline**: the diff hash is `contentHash` from `src/server/embed-text.ts` —
`sha256(title + "\n\n" + content.trim())` — computed **identically on both sides** (main side
already stored in `atlas_doc_meta.content_hash`; preview side computed by the server over the
parsed bundle). Never use the parser's `contentHash` field from docs.json for diffing — that
is `sha256(raw content lines)`, a different definition kept only for docs.json byte-identity.

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
   - tar entry sanitization: reject `..` / absolute paths
   - **stream-extract with hard caps** (measured 2026-06: content is 5.6MB raw / ~2.9MB
     gzipped tarball / 10,342 document.md): extract only `content/**` entries, count
     decompressed bytes during streaming, abort at **15MB** decompressed (~2.5× current);
     doc-count cap **20k** (2× current). A decompression bomb dies mid-stream after a few MB.
     (Alternatives evaluated: Git Trees API = 1 request per blob ≈ 10k calls/build — kills the
     5,000/hr budget; GraphQL blob batching = 100+ heavy queries. One ~3MB tarball wins.)
   - build subprocess gets a timeout + memory limit — an OOM kills the build, not the server
   - global cap of 2 concurrent builds with a small queue (the per-SHA advisory lock doesn't
     bound distinct-SHA builds)
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
   `/preview/...` link as if legit (credibility-wrapper attack). Mitigations: the MVP trigger
   gate (everything buildable is a public, attributable PR/branch on the canonical repo), plus
   **banner + interstitial** (decided): first visit to a given preview shows a one-click
   interstitial — "This is unreviewed proposed content from <author>, not the live atlas" —
   dismissed per preview per session. Re-evaluate when arbitrary forks unlock (P2 safety
   screening).

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
