# Preview — commit-by-commit history

Status: **built** (agreed and built 2026-10-12). Supersedes the "real per-commit history is P2" line in
`preview.md` § History in preview mode.

## Goal

In preview mode, the reader sidebar's **History** tab (`PreviewHistory.tsx`) shows today:

1. "Changed in this pull request / branch": one fuzzy-rail entry with the overall diff of this
   doc against the preview's diff base.
2. "On the live atlas": the doc's real Postgres history (`NodeHistory`).

Add a toggle **under the overall diff** that, when on, renders the doc's history **commit by
commit** since the branch diverged from its base, newest first, still on the fuzzy rail and still
above the live history. Scope is that tab only: no branch-wide commit list, no MCP/chat surface.

```
Changed in this pull request          ● 2026-10-10 · PR 312
  <overall diff>
  [x] By commit                        ▓▓▓▓▓▓░░░░ reading commits 12 / 20
      ┊ ● 2026-10-10 · a1b2c3d · alice  "fix threshold"         modified · semantic
      ┊     <this doc's diff in this commit only>
      ┊ ● 2026-10-08 · 9f8e7d6          "Merge main into branch" (marker, no diff)
      ┊ ● 2026-10-07 · 44aa01c · bob    "renumber section"      renumbered A.1.2 → A.1.3
──────────────────────────────────────
On the live atlas
  …
```

## Decisions

| # | Decision |
|---|---|
| 1 | **Git via [isomorphic-git](https://isomorphic-git.org/)** on the web service. The web image stays free of the `git` binary. |
| 2 | **On demand**, computed the first time a reader turns the toggle on, **streamed over SSE** so commits arrive one by one behind a progress bar sized by the commit count. Cached in the bundle dir afterwards. |
| 3 | Toggle state is the URL parameter **`?history=by-commit`**. No saved preference. Absent means off. |
| 4 | Scope is **only the reader sidebar's history area**. |
| 5 | **Merge commits** are a marker row with no diff, unless the doc after the merge differs from **both** parents (both sides' edits met there: combined by git or resolved by hand). Then it shows the diff against the first parent, flagged `bothSides`. |

## Spike results (isomorphic-git 1.44.1, run 2026-10-12 against `sky-ecosystem/next-gen-atlas`)

- **Fetch by raw sha works** (GitHub serves any sha reachable from a ref), as does fetch by
  `refs/pull/N/head`. Verified with a sha that is no ref's tip (5 commits back on main, 1.2 s).
  The remote must be configured first (`addRemote` + a `remote.origin.fetch` refspec), or
  `fetch` throws `NoRefspecError`.
- Runs unchanged under **Bun** and through the agent HTTPS proxy with `isomorphic-git/http/node`.
- Shallow fetch: depth 10 took about 1.2 s (108 objects). **Depth 100 took 6.7 s for an 18 MB pack**.
- Reading every `content/` blob of one commit (about 3.9 MB, 18 bucket files) from that pack
  takes **80–145 ms** with a shared `cache` object.
- **Private repos: not verified here.** No private repo or App token was reachable from the
  spike. GitHub's upload-pack treats private repos the same once the request is authenticated, so
  the same fetch should work. PR 2 proves it with a gated integration test (see Tests).
- **Parse cost (measured in PR 2):** `loadSnapshot` through isomorphic-git takes 96–156 ms per
  consolidated commit (median 113 ms, 29 commits), with snapshots identical to the git CLI's.
  A real walk of upstream PR 187 (44 commits, 5 merges, fetched from GitHub) took 6.6 s, 2.3 s of
  it fetching, and produced a 685 KB cache file. So the default cap is 100 commits, about 15 s.

## Server

### Range

- `activeBase.mergeBase .. head`, where the active base is whichever diff base the preview shows
  (`sky` / `repo`; see `pr-diff-auto.ts`). The range is immutable per (head sha, base key), so the
  cache never goes stale.
- **The commit list comes from GitHub's compare** (`commit-range.ts`), not from the clone. Compare
  answers exactly "reachable from the head, not from the merge base"; a shallow clone cannot,
  because near its boundary a commit has lost the parents that say which side it is on. Compare
  pages oldest first (100 a page), so the newest `PREVIEW_COMMIT_HISTORY_MAX_COMMITS` (default 100)
  are read from the last page or two. The stream reports `truncated` when the range is longer.
- **Fetch depth = commits walked + 1**, from the bundle's own repo (`meta.repo`), where the head
  is reachable. A parent outside the fetched history ends the walk early, reported `truncated`.
- **Live-main degrade** (no merge base) has no range. The endpoint answers `unavailable`, and the
  toggle is disabled with that reason.

### Reading commits: layout knowledge stays in `atlas-git-source`

`scripts/lib/atlas-git-source.ts` is one of the two modules allowed to know atlas layouts
(root CLAUDE.md). It reads trees through an async **`GitTreeBackend`**
`{ listTree(treeish, dir, recursive?), readBlobs(blobs) }` (done in PR 1):

- The CLI backend stays the default (`build-history`, `build-doc-versions`, the worker), with no
  change in behaviour.
- A new isomorphic-git backend (`readTree` / `readBlob` over the scratch bare repo) serves the
  preview walk.

PR 1 converted it to `.ts` and split it into the layout module, the document parsers
(`atlas-git-parse.ts`) and the CLI backend (`atlas-git-cli.ts`). `atlas-git-backend.test.ts` pins
the seam with an in-memory backend. PR 2 adds the same parity check for the isomorphic-git backend,
over real atlas commits.

### Diff per commit: the same engine as live history

`build-history.mjs` kept `diffSnapshots` (added / modified / removed / moved), the `DiffLine[]`
construction and `classifyDiff` (lint / typo / semantic) inside the script. PR 1 moved the
snapshot → per-node events step into `scripts/lib/history-events.ts`, used by both
`build-history` and the preview walk. Preview commit rows then carry exactly the `change_type`,
`change_kind` and diff shape a live `EntryRow` renders.

Per commit:
- **Single parent**: events from `diff(snapshot(parent), snapshot(commit))`.
- **Merge commit**: a marker. For each uuid whose state differs from **both** parents, emit the
  first-parent event, flagged `bothSides`.
- Walk newest first, so the most relevant rows arrive first. Keep one snapshot of look-behind, so
  each commit costs one new parse. A possible later optimisation is to reuse the parse of an
  unchanged bucket file by blob sha. Leave it out unless the measurement calls for it.

### Endpoint and stream

`GET /api/preview/<sha>/commits?base=sky|repo&uuid=<uuid>` returns `text/event-stream`
(`commit-route.ts`). It is sha-keyed, so it goes through `sha-gate.ts`, the gate `diff.json` and
the bundle artifacts share (moved out of `handler.ts` for it). Private responses carry
`private, no-store` and no allow-origin. Only starting a walk counts against the per-IP limit; a
replay or a join does not. It is not quota-counted, since it builds nothing for the head sha, and
it runs under its own semaphore.

The walk is **whole-branch, computed once**. The `uuid` filter applies only when serving, so every
doc's sidebar reuses one walk, and a renumber commit touching thousands of docs never ships them
all to the browser.

| event | payload |
|---|---|
| `fetching` | `{ phase?, loaded?, total? }` from isomorphic-git's `onProgress`, a few a second (indeterminate bar) |
| `range` | `{ total, walking }`: commits since the base, and how many of the newest are read (determinate bar) |
| `commit` | `{ index, commit: { sha, parents, date, author, message, merge, entries } }`. Every commit is sent, so the bar advances; `entries` holds only `uuid`'s rows and is often empty |
| `done` | `{ truncated }` |
| `error` | `{ reason }`: `unavailable` (no merge base), `range-failed`, `fetch-failed`, `timeout`, `failed`, `rate-limited` |

A row (`CommitEntry`, `commit-events.ts`) is a live history event (`changeType`, `diff`,
`changeKind`, `movedFrom`/`movedTo`) plus `docNo`, `title`, `prevTitle`, and two preview-only
additions:
- **`renumbered`** rows with `prevDocNo`. Inside a composed bucket file a renumbering changes no
  content, title or path, so the shared engine never reports it; on a branch it is often the
  change a reader is looking for.
- **`bothSides`** on a merge commit's rows: the document's merged state matches neither parent.

- **In-flight dedupe** works like `build.ts`'s `inflight` / `subscribeBuild`. A second reader joins
  the running walk, and receives every commit so far replayed, then the live tail.
- **Cache**: the walk writes `commits-<base>.json` into the bundle dir **last**, the same
  write-last rule as `meta.json`. A cached request replays it as the same event sequence
  immediately, so the client has one code path. It is evicted with the bundle. The scratch bare
  repo is deleted when the walk ends, whatever the outcome.
- **Soft**: a failed walk never touches the bundle or its build outcome.
- **Private repos**: HTTP Basic with username `x-access-token` and the installation token that
  `github-app.ts` already mints for private tarballs (same `contents: read` permission, no new App
  permission).
  - Send it up front as an `Authorization` header, not through `onAuth`. `onAuth` fires only after
    a 401 challenge, and an unauthenticated request for a private repo can answer 404 instead.
  - Never put the token in the URL: isomorphic-git puts the URL in its error messages.
  - The token is `installationToken()`'s, cached for 55 minutes of its hour, which outlasts a
    walk's two-minute deadline.
  - A sha no ref reaches any more (force-pushed away) cannot be fetched, even when the tarball
    API still serves it. That is a soft `fetch-failed`, on public repos too.
  - The fetch targets the head repo; a canonical PR from a fork can fetch `refs/pull/N/head` from
    the canonical repo.
- New config (`PREVIEW_COMMIT_HISTORY_MAX_COMMITS`, `PREVIEW_COMMIT_HISTORY_TIMEOUT_MS`,
  `PREVIEW_MAX_CONCURRENT_COMMIT_WALKS`) is declared in `src/server/env/`, and
  `pnpm env:example` is run.

## Frontend

- `useUrlState("history")` is the toggle: `"by-commit"` means on. A labelled switch `<button>`
  with `aria-pressed` sits directly under the overall diff. It shows for every doc in a preview,
  including "Unchanged by this branch", because a doc can be touched and then changed back.
- `usePreviewCommits(nodeId, baseKey)` opens an `EventSource` only while the toggle is on, and
  closes it when the node changes or the component unmounts. It returns
  `{ phase, received, total, commits, truncated, error }`.
- `PreviewCommitList`:
  - A `<progress>` bar: indeterminate while `fetching`, then `index / total` ("reading commits
    12 / 20").
  - Rows stream in newest first, on the fuzzy rail, built from `EntryRow` parts. In place of the
    PR link a row shows the short sha, linked to the commit on GitHub, plus the author and the
    first line of the message.
  - Merge commits are a dotless marker row.
  - The end states:
    - "No commit in this branch touched this doc"
    - "Touched by N commits, no net change"
    - a truncated note
    - an `unavailable` reason
- `PreviewHistory.tsx` is already 150 lines (advisory limit 120). The toggle and list go in their
  own files, and `PreviewHistory` only mounts them.

## Tests

- **Composition invariant**: starting from the merge-base snapshot, applying each commit's events
  in order reaches the head snapshot, and so matches the bundle's overall `diff.json`. Run it on
  a fixture branch with a renumber, a revert and a merge commit.
- Merge rule: a clean merge yields a marker only, and a document both sides edited yields a flagged
  diff.
- **Private fetch integration test**, skipped unless the GitHub App credentials and a private
  mirror (`PREVIEW_IT_PRIVATE_REPO`) are set: mint an installation token, shallow-fetch a sha that
  is no ref's tip, and walk two commits. Also assert that the token appears in no error message.
- Backend parity: the CLI and isomorphic-git snapshots are identical for the same atlas commits.
- Handler: gate and private headers, `uuid` filtering, cache replay equal to the live stream,
  dedupe join, `unavailable` on live-main.
- Frontend: the URL toggle, the progress states, streamed rows, and the end-state copy.

## Delivery

1. **Refactor PR, no behaviour change (done).** The backend seam in `atlas-git-source` (`.ts`,
   split in three, an in-memory backend test), `history-events.ts` extracted from
   `build-history.mjs`, and `atlas-parser.d.mts`, because the TypeScript projects that cannot
   import untyped JS (tests now, the server in PR 2) reach the heading grammar through it. Proven
   equivalent on the checked-out atlas: identical snapshots for all 190 atlas commits (all three
   layouts), identical `build-history --out-json --full` output, identical `build-doc-versions`
   counts.
2. **Server PR (done).** `history-classify.d.mts` (the server cannot import untyped JS), the isomorphic-git dependency (`pnpm install`, lockfile committed), the parse
   cost measurement and the commit cap that follows from it, the private-fetch integration test, the walk, the SSE endpoint, the
   cache, config, and the `src/server/preview/CLAUDE.md` flow and invariant lines.
3. **Frontend PR (done).** The toggle (`PreviewCommits.tsx`), hook (`usePreviewCommits.ts`)
   and list (`PreviewCommitList.tsx`, `PreviewCommitRow.tsx`), over the wire types and stream
   reducer in `src/lib/previewCommits.ts`, which the server's route is typed against. A `patch-notes.md` bullet, and an update to the
   preview history entry in `src/lib/featuresData.ts` naming the toggle.
