# Preview — commit-by-commit history

Status: **planned** (agreed 2026-10-12). Supersedes the "real per-commit history is P2" line in
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
| 5 | **Merge commits** are a marker row with no diff, unless the doc after the merge differs from **both** parents (a hand-resolved conflict). Then it shows the diff against the first parent. |

## Spike results (isomorphic-git 1.44.1, run 2026-10-12 against `sky-ecosystem/next-gen-atlas`)

- **Fetch by raw sha works** (GitHub serves reachable shas), as does fetch by `refs/pull/N/head`.
  The remote must be configured first (`addRemote` + a `remote.origin.fetch` refspec), or
  `fetch` throws `NoRefspecError`.
- Runs unchanged under **Bun** and through the agent HTTPS proxy with `isomorphic-git/http/node`.
- Shallow fetch: depth 10 took about 1.2 s (108 objects). **Depth 100 took 6.7 s for an 18 MB pack**.
- Reading every `content/` blob of one commit (about 3.9 MB, 18 bucket files) from that pack
  takes **80–145 ms** with a shared `cache` object.
- Not yet measured: the **parse** cost per commit (`loadSnapshot` over 3.9 MB). That decides the
  realistic commit cap. Measure it first in the PR 2 work.

## Server

### Range

- `activeBase.mergeBase .. head`, where the active base is whichever diff base the preview shows
  (`sky` / `repo`; see `pr-diff-auto.ts`). The range is immutable per (head sha, base key), so the
  cache never goes stale.
- **Fetch depth = `commitsAhead + 1`.** Every commit in the range lies within `ahead_by` of the
  head along some path, so its parents and the merge base fall within one more step.
  `commitsAhead` comes from the compare call `base-drift.ts` already makes. Upstream commits
  reachable through a merge commit's second parent come along in the pack and are never walked.
- The walk lists commits reachable from head and not from the merge base (`git log base..head`
  semantics), and caps them at `PREVIEW_COMMIT_HISTORY_MAX_COMMITS` (start at 100; set it after
  the parse measurement). The stream reports `truncated` beyond the cap.
- **Live-main degrade** (no merge base) has no range. The endpoint answers `unavailable`, and the
  toggle is disabled with that reason.

### Reading commits: layout knowledge stays in `atlas-git-source`

`scripts/lib/atlas-git-source.mjs` is one of the two modules allowed to know atlas layouts
(root CLAUDE.md). It shells out to `git ls-tree` / `git cat-file --batch`. Refactor it to take a
**backend** `{ lsTreeBlobs(treeish, path), readBlobs(blobs) }`:

- The CLI backend stays the default (`build-history`, `build-doc-versions`, the worker), with no
  change in behaviour.
- A new isomorphic-git backend (`readTree` / `readBlob` over the scratch bare repo) serves the
  preview walk.

That is a substantial change, so convert it to `.ts` (repo rule). Add a parity test: both
backends produce identical snapshots for the same commits of the checked-out atlas.

### Diff per commit: the same engine as live history

`build-history.mjs` keeps `diffSnapshots` (added / modified / removed / moved), the `DiffLine[]`
construction and `classifyDiff` (lint / typo / semantic) inside the script. Move the
snapshot → per-node events step into `scripts/lib/history-events.ts`, used by both
`build-history` and the preview walk. Preview commit rows then carry exactly the `change_type`,
`change_kind` and diff shape a live `EntryRow` renders.

Per commit:
- **Single parent**: events from `diff(snapshot(parent), snapshot(commit))`.
- **Merge commit**: a marker. For each uuid whose state differs from **both** parents, emit the
  first-parent event, flagged `conflictResolution`.
- Walk newest first, so the most relevant rows arrive first. Keep one snapshot of look-behind, so
  each commit costs one new parse. A possible later optimisation is to reuse the parse of an
  unchanged bucket file by blob sha. Leave it out unless the measurement calls for it.

### Endpoint and stream

`GET /api/preview/<sha>/commits?base=sky|repo&uuid=<uuid>` returns `text/event-stream`. It goes
through the same `open-gate.ts` (resolve → authorize → takedown) and rate limit as `/events`.
Private responses use `PREVIEW_CORS` and `no-store` (preview CLAUDE.md invariants). It is not
quota-counted: it builds nothing new for the head sha. It runs under its own small semaphore.

The walk is **whole-branch, computed once**. The `uuid` filter applies only when serving, so every
doc's sidebar reuses one walk, and a renumber commit touching thousands of docs never ships them
all to the browser.

| event | payload |
|---|---|
| `fetching` | `{ received?, total? }` from isomorphic-git's `onProgress` (indeterminate bar) |
| `range` | `{ total, truncated }`: the commit count, now known (determinate bar) |
| `commit` | `{ index, sha, parents, date, author, message, merge, entry? }`. Every commit is sent, so the bar advances. `entry` (that doc's event: change type, kind, diff, renumber/retitle) is present only when the commit touched `uuid` |
| `done` | `{ truncated }` |
| `error` | `{ reason }`: `unavailable` (no merge base), `fetch-failed`, `timeout` |

- **In-flight dedupe** works like `build.ts`'s `inflight` / `subscribeBuild`. A second reader joins
  the running walk, and receives every commit so far replayed, then the live tail.
- **Cache**: the walk writes `commits-<base>.json` into the bundle dir **last**, the same
  write-last rule as `meta.json`. A cached request replays it as the same event sequence
  immediately, so the client has one code path. It is evicted with the bundle. The scratch bare
  repo is deleted when the walk ends, whatever the outcome.
- **Soft**: a failed walk never touches the bundle or its build outcome.
- **Private repos**: the installation token goes through isomorphic-git's `onAuth`
  (`github-app.ts` already mints it for tarballs). The fetch targets the head repo; a canonical
  PR from a fork can fetch `refs/pull/N/head` from the canonical repo.
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
- Merge rule: a clean merge yields a marker only, and a hand-resolved conflict yields a flagged
  diff.
- Backend parity: the CLI and isomorphic-git snapshots are identical for the same atlas commits.
- Handler: gate and private headers, `uuid` filtering, cache replay equal to the live stream,
  dedupe join, `unavailable` on live-main.
- Frontend: the URL toggle, the progress states, streamed rows, and the end-state copy.

## Delivery

1. **Refactor PR, no behaviour change.** The backend seam in `atlas-git-source` (with `.ts`
   conversion and the parity test), and `history-events.ts` extracted from `build-history.mjs`.
   `REPRO=1 pnpm test` and the history tests stay green.
2. **Server PR.** The isomorphic-git dependency (`pnpm install`, lockfile committed), the parse
   cost measurement and the commit cap that follows from it, the walk, the SSE endpoint, the
   cache, config, and the `src/server/preview/CLAUDE.md` flow and invariant lines.
3. **Frontend PR.** The toggle, hook and list. A `patch-notes.md` bullet, and an update to the
   preview history entry in `src/lib/featuresData.ts` naming the toggle.
