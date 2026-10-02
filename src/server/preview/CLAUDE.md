# PR previews

A preview builds the atlas from another ref (an nga PR, a fork branch, a private mirror) and serves it with a redline diff against a base. Design and rationale: `docs/plans/preview.md` (authoritative) and `docs/plans/private-previews.md`. GitHub App setup, access, and "why is this diff wrong" debugging: `docs/github-app-setup.md`.

## Flow and where each step lives

`/api/preview/*` → `handler.ts` `drive()`: rate limit → resolve the id to a sha (`resolve.ts`) → private-access check → blocked-sha check → serve the ready bundle or `getOrStartBuild`. `build.ts` `runBuild`: takedown → trust/quota (`trust.ts`) → tarball fetch (`tarball.ts`) → `build-index`, then graph and glossary concurrently → diff bases → `meta.json` → DB upsert → LRU eviction → detached identity refine. Phases: fetching → building → ready | failed.

- **Diff base**: `pr-diff.ts` (candidates `sky` and `repo`), `pr-diff-auto.ts` (`pickAuto`), `diff-base*.ts`, `base-drift.ts`.
- **Diff artifacts**: `snapshot.ts`, `diff-artifacts.ts`, `patch-diff.ts`.
- **Identity gate** (does a kept UUID still point at the same document?): `identity.ts` re-exports `identity-*.ts`; `embeddings*.ts` and `vector-cache.ts` back the refine step.
- **Private access**: `access.ts`, `github-app.ts`. **Persistence**: `db.ts`. **Eviction**: `sweeper.ts`, `cache.ts`.
- **Frontend**: `apps/web/src/components/preview/`, `apps/web/src/lib/preview*.ts`, and `dataSource.tsx`, which points artifact fetches at `/api/preview/<sha>/`.

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
- **The `preview` profile in `scripts/lib/build-steps.mjs` is documentation, not wiring.** Change the steps `build.ts` runs and that profile together.

## Tests and config

Tests are colocated `*.test.ts` under Bun: `bun test src/server/preview` (vitest excludes `src/server/**`). `runBuild` takes its I/O through `BuildDeps`, which is the seam the build tests use. Every `PREVIEW_*` env var and the GitHub App keys are read in `src/server/config.ts`; private previews are on only when both `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set.
