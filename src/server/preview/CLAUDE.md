# PR previews

A preview builds the atlas from another ref (an nga PR, a fork branch, a private mirror) and serves it with a redline diff against a base. Design and rationale: `docs/plans/preview.md` (authoritative) and `docs/plans/private-previews.md`. GitHub App setup, access, and "why is this diff wrong" debugging: `docs/github-app-setup.md`.

## Flow and where each step lives

`/api/preview/*` → `handler.ts` `drive()`: rate limit → resolve the id to a sha (`resolve.ts`) → private-access check → blocked-sha check → serve the ready bundle or `getOrStartBuild`. `build.ts` `runBuild`: takedown → trust/quota (`trust.ts`) → tarball fetch (`tarball.ts`) → `build-index`, then graph and glossary concurrently → diff bases → `meta.json` → DB upsert → LRU eviction → detached identity refine. Phases: fetching → building → ready | failed.

- **Diff base**: `pr-diff.ts` (candidates `sky` and `repo`), `pr-diff-auto.ts` (`pickAuto`), `diff-base*.ts`, `base-drift.ts`.
- **Diff artifacts**: `snapshot.ts`, `diff-artifacts.ts` (`diff.json` lists added, changed and removed docs), `patch-diff.ts`.
- **Identity gate** (does a kept UUID still point at the same document?): `identity.ts` re-exports `identity-*.ts`; `embeddings*.ts` and `vector-cache.ts` back the refine step.
- **Private access**: `access.ts`, `github-app.ts`. **Persistence**: `db.ts`. **Eviction**: `sweeper.ts`, `cache.ts`.
- **Frontend**: `apps/web/src/components/preview/`, `apps/web/src/lib/preview*.ts`, and `dataSource.tsx`, which points artifact fetches at `/api/preview/<sha>/`.
- **Commit history** (`GET /api/preview/<sha>/commits?base=sky|repo&uuid=<uuid>`, SSE; design in `docs/plans/preview-commit-history.md`): `commit-route.ts` replays a finished walk (`commit-cache.ts`, `out/commits-<base>.json`), joins a running one (`commit-stream.ts`), or starts one: `commit-plan.ts` reads the base's merge base from meta.json → `commit-history.ts` runs compare for the range (`commit-range.ts`) → isomorphic-git shallow fetch into a scratch bare repo (`commit-git.ts`) → `commit-walk.ts` / `commit-events.ts` over `atlas-git-source.ts` and `history-events.ts`. `sha-gate.ts` gates it like every sha-keyed response. The wire format and the reader's stream reducer are `src/lib/previewCommits.ts`, which the route is typed against; the reader side is `apps/web/src/components/history/PreviewCommits.tsx` (the `?history=by-commit` switch) over `apps/web/src/hooks/usePreviewCommits.ts`.
- **Chat and MCP tools**: `tool-access.ts` opens a preview for `atlas_preview_diff` / `atlas_preview_get` (`src/server/chat/tools/tools-preview*.ts`), `bundle-read.ts` reads the bundle. It shares `open-gate.ts` (resolve → authorize → takedown) with `drive()`, and `open-prs.ts` with the /preview index.

## Invariants

- **`meta.json` is written last.** `bundleReady()` checks only for it, so writing it earlier serves `ready` with no `diff.json` on disk. An unreadable meta means not serveable, never public.
- **Private access fails closed** (`access.ts` header). The live GitHub permission check is what makes the 7-day session cookie safe: never move the decision into the session JWT, never cache more than `ok`/`forbidden` for 60s, key on the numeric GitHub user id, and authorize before emitting any sha-bearing event. Private responses carry no allow-origin and use `no-store`; keep `PREVIEW_CORS`, not `http.ts`'s `CORS`.
- **Two GitHub App credentials** (`github-app.ts` header): the App JWT for app-level calls, the installation token for repo-scoped calls and private tarballs.
- **`kind === "pr"` decides PR treatment**, not the presence of a `pr` field.
- **A private mirror never gets fork treatment or a `sky` candidate**: nga main is squash-merged, so a mirror shares no commit SHAs with it.
- **Diff-base pick** (`pr-diff-auto.ts`): a PR diffs against its own base or live main, never the nga-main fork point; a branch with both candidates takes whichever merge base GitHub's compare says is later. Merge-base trees come from the head repo; `base-drift` fetches from the candidate's own repo.
- **`base-drift` and diff artifacts are soft**: their failure never changes the build outcome.
- **The durable diff-base record** (`diff-base-record.ts`) uses `pr-base` / `fork-default` / `nga-main`, not the internal `sky` / `repo` keys.
- **A build never waits on the embedding provider.** Identity refine runs detached and writes the whole verdict to `identity.json`; `stopRefine` runs before a rebuild. The identity bars are measured values: re-measure against `docs/research/identity-swap-detection.md` before moving one.
- **Quota counts new shas only**; rebuilding a known sha is free.
- **MCP never builds and sees only public canonical PRs** (`tool-access.ts`): it is anonymous, so a preview it could build or a private bundle it could read would hand the build quota and private content to anyone. Every denial a tool can hit reads as `not-found`, so neither surface can probe whether a private repo, branch or PR exists.
- **Commit history is soft and computed once per (sha, diff base).** A failed walk is an `error` event and never touches the bundle or its build; the cache file is written last and renamed into place, so one that exists is a whole walk. The walk is whole-branch and filtered to one document only when served, so every document a reader opens reuses it.
- **A commit range comes from GitHub's compare, never from a shallow clone's ancestry.** Near the fetch boundary a shallow clone has lost the parents that would say which side a commit is on. Git only reads trees, through the same `GitTreeBackend` seam the build scripts use, so the layouts stay in `atlas-git-source.ts`.
- **Commit-history credentials travel only in an `Authorization` header**, never in the remote URL: isomorphic-git puts the URL in its errors. A private head repo fetches with its installation token; a public one fetches anonymously.
- **The `preview` profile in `scripts/lib/build-steps.mjs` is documentation, not wiring.** Change the steps `build.ts` runs and that profile together.

## Tests and config

Tests are colocated `*.test.ts` under Bun: `bun test src/server/preview` (vitest excludes `src/server/**`). `runBuild` takes its I/O through `BuildDeps`, which is the seam the build tests use. `runWalk` takes its I/O through `WalkDeps` the same way. `commit-git.test.ts` reads the atlas submodule's own object store (skipped without it); `commit-git.private.test.ts` fetches a private mirror and runs only with `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `PREVIEW_IT_PRIVATE_REPO` set. Every `PREVIEW_*` env var and the GitHub App keys are read in `src/server/config.ts`, except the three commit-history settings, which `commit-history.ts` reads at call time (all are declared in `src/server/env/previews.ts`); private previews are on only when both `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set.
