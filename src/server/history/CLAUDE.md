# Atlas history

This file covers how the atlas change history is built and stored. It holds the history build scripts, the PR-metadata cache, the document-version pass, the pre-git history pointers, and the state of the `change_kind` backfill. The server code for these tables lives in this directory.

## Build pass: `build-history.mjs`

- **`scripts/required/build-history.mjs`** walks the git log of the atlas submodule and computes per-node change history with diffs.
- It has two sinks.
  - **Default:** upserts straight into Postgres `atlas_history`. It reads its own incremental cursor via `MAX(commit_seq)` and runs under Bun.
  - **`--out-json`:** writes the legacy `public/history/<uuid>.json` files. This sink needs no database and serves the canary and artifact tests.
- The shared DB write path lives in `src/server/history/history-db.ts` (`eventToRow`, `upsertHistory`, `gitCommitSeq`, `readHistoryCursor`).
- It imports `lib/atlas-parser.mjs` for `HEADING_RE`.

## History commands

- `pnpm build:history` walks the git log of the atlas submodule and upserts `atlas_history` in Postgres (DB sink, reads its own incremental cursor).
  - It ALSO upserts the committed `public/history-html-era.json` (the pre-#117 HTML-era reconstruction) AND `public/history-pre-era.json` (pre-git origins, if present). It does this idempotently on each run, so dev and Railway serve them.
  - Add `--out-json` to write `public/history/<uuid>.json` instead (DB-less, used by canary tests).
  - `--full` forces a full walk.

- `pnpm history:prs` fills the COMMITTED `.cache/github-prs` PR-metadata cache that `build:history` reads. The cache holds title, body, author and review counts.
  - `pnpm history:prs <since-sha> <until-sha>` fills it for the atlas commits a bump added.
  - `--all` fills it for every commit.
  - It is off the `pnpm build` chain, because it needs the network and `gh`.
  - It has one automated caller. `atlas-update.yml` runs it per bump and stages the new records in the bump commit. That job is the only one that both knows which atlas PRs are new and can commit what it fetched.
  - The committed records serve local dev and the canary job. `.dockerignore` keeps `.cache` out of the images apart from `.cache/etherscan`, so the Railway worker refetches with its own `GITHUB_TOKEN` each cycle.
  - A missing record is never fatal anywhere. It only leaves that history row without PR metadata.
  - The eight-field record shape lives in `scripts/lib/github-pr-cache.mjs`. It is shared with `scripts/htmlhist/atlas-pr-context.mjs`, which adds `summary` on first read.

- `pnpm build:doc-versions` walks the git log of the atlas submodule and upserts `atlas_doc_versions` in Postgres.
  - It writes one row each time a document's FINGERPRINT changes. The fingerprint is the cleaned body, the title and the doc number (`scripts/lib/doc-fingerprint.mjs`). It writes a null row when the document is removed. A document's version is live over [its row's commit_seq, the next row's).
  - **Why it exists:** a preview of a repo that shares no git history with nga main (every private mirror, because nga main is squash-merged) needs to find the upstream commit its CONTENT was last in sync with. Without this table, the preview is redlined against live main, and everything upstream changed since is counted as its own change.
  - It is its own pass with its own cursor in its own table. The first run after migration 034 walks the whole history unprompted (~20s). Later runs only read new commits. The atlas worker runs it as a third parallel tail beside embeddings and history.
  - **It is NOT read off the events of `atlas_history`.** Since the consolidated layout, a renumbering inside one bucket file produces no event at all, and renumberings are most of what a stale fork shows as phantom changes.
  - **The fingerprint must be identical** whether a state is read from git (`atlas-git-source`, raw body) or from a checkout or `docs.json` (`atlas-parser`, cleaned body). `scripts_tests/doc-fingerprint.test.ts` holds that to the checked-out atlas.
  - `--full` discards and rewalks. `--dry-run` walks and reports without a DB.

## Pre-git history

These scripts are about history, but they are off the `pnpm build` chain.

- `pnpm prehist:genesis` (ancient-history branch) bridges the recovered Atlas v2 genesis snapshot (2024-09-02) to the repo's real root commit and writes `public/history-pre-era.json`. See `scripts/prehist/HISTORY.md`.
- `pnpm prehist:mip` (ancient-history branch) attributes genesis-bridged docs to the MIP-era Atlas (2023-2024) and appends into `public/history-pre-era.json`. Run it after `prehist:genesis`.
- `pnpm prehist:aep` (ancient-history branch) replaces select severed placeholders with dated Atlas Edit Proposal facts (only Accepted AEPs). Run it LAST, after `prehist:genesis` and `prehist:mip`.
- `scripts/htmlhist/` holds the HTML-era history reconstruction feature (the `htmlhist:*` entry-points, their exclusive libs and the `HISTORY.md` runbook at `scripts/htmlhist/HISTORY.md`).

## `atlas_history.change_kind` is backfilled

**`atlas_history.change_kind` is backfilled — done 2026-09, do not re-run it.** The migration-006 walk landed: 7,494 of ~7,635 `modified` rows carry a `lint` / `typo` / `semantic` label. The ~141 without one are rows whose diff is empty, which `classifyDiff` returns `null` for by design.

`change_kind` is NULL on every `added` / `removed` / `moved` row **by design**, because the classifier needs a diff. So the ~51.5k NULLs in a bare `GROUP BY change_kind` are not a backlog. Count with `COUNT(change_kind)` grouped by `change_type` instead.

Two consequences:

- Do not leave `ATLAS_WORKER_FULL=1` set on the worker to "finish" it. At `*/12` that is ~870 GitHub API calls an hour against a 5,000/hr budget. `upsertHistory`'s SET clause is a plain overwrite, so a walk that loses its `GITHUB_TOKEN` mid-flight writes NULLs over good PR metadata.
- The labels are now a real evaluation corpus. It holds 2,641 genuine cosmetic edits (1,519 lint + 1,122 typo) against 4,853 semantic ones, so **~35% of all classified atlas edits are cosmetic**.
