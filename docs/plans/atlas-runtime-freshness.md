# Runtime Atlas Freshness — Self-Updating Service

**Status: DESIGN.** *(Operator handoff steps for the whole hosted system — web service + this cron + Postgres — live in [../DEPLOYMENT.md](../DEPLOYMENT.md).)* A **Railway cron service** detects when the upstream atlas advances and triggers a **redeploy** of the web service. The redeploy's build pulls `origin/main`, rebuilds every artifact + the SPA bundle, and boots fresh — and as part of that boot the web service kicks off embedding as a detached background job. No GitHub on the critical path; no runtime data plumbing; no internal endpoints.

> **Three designs on the table.** This doc is the **redeploy** approach. Two alternatives are written up separately:
> - **[Alternative A — In-process self-updater](atlas-runtime-freshness-inprocess.md):** the web service rebuilds artifacts on its own disk and hot-swaps in place. *Simplest setup* (one service, no token, no bucket, no restart); single-replica only, build load lives in the serving container.
> - **[Alternative B — Shared store (Railway buckets)](atlas-runtime-freshness-buckets.md):** artifacts live in a bucket, server hot-swaps from it. *Most scalable* (multi-replica, data fully decoupled from deploys); most plumbing (bucket + build job + reload endpoint/token).
>
> Quick compare — **this (redeploy):** simplest *machinery* but restarts on every update and keeps data in the image; **A:** least operational surface, restart-free, but single-replica + toolchain in the live container; **B:** restart-free + horizontally scalable, but the most moving parts. All three keep GitHub off the critical path and leave **client-side search untouched**. The chat work's no-interrupt need favors A or B over this one.

## Why (the actual problem)

We already have `atlas-update.yml`: it pulls the submodule, rebuilds artifacts, and opens a PR that someone merges → Railway redeploys. That flow needs a **GitHub bot installed + write access to the repo** — which the operating team has and we won't. It's brittle and outside our control.

**Goal: keep GitHub off the critical path.** The trigger must originate Railway-side, where we have access, so freshness no longer depends on a bot, a merge, or repo access.

**Operating envelope:**
- Updates land **at most once a day**. The cron fires every **5 minutes** (Railway's minimum), so worst-case freshness lag is one cron interval + the redeploy ≈ **~10 minutes — which is fine.** No tight build-time budget to defend.
- **Redeploying is fine** — a brief restart is acceptable for the static reader. (The chatbot's no-interrupt needs are a later, separate concern; this design does not pre-build for them.)

## The mechanism

```
Each cron firing (railway.cron.toml, every 5 min), in order:

  1. git ls-remote origin main                  → upstream head SHA  (no checkout)
  2. GET  <web public domain>/health            → live atlas_sha
  3. drift (upstream ≠ live)?
       no  → exit
       yes → a deploy already in flight for this target? → exit (don't re-trigger)
             else → Railway API always-rebuild deploy (+ NO_CACHE), record target sha, exit
                    └ rebuild: git fetch origin/main → build:railway (artifacts + SPA bundle)
                      start:   sync:atlas → serve → spawn detached embed reconcile
```

The cron is tiny: it needs neither the submodule nor a build toolchain. `git ls-remote` gives the upstream head SHA without a checkout; `/health` reports the web service's live `atlas_sha`. If they differ **and** no deploy is already in flight, it calls the Railway API to redeploy the web service, then exits.

`/health` is the web service's existing **public** route (`index.ts:39`) — it exposes only `atlas_sha` + a doc count, nothing sensitive — so the cron reads it over the public domain. There is no cron→web private call and no internal endpoint, so the service keeps its default bind; the only external call the cron makes is the Railway API redeploy (HTTPS, token-scoped).

The redeploy does everything else, the same way a deploy does today: the build pulls fresh atlas, regenerates `docs.json`/`graph.json`/etc. **and** the Vite bundle, the start command's `sync:atlas` updates Postgres before serving, and once serving the boot spawns the embed reconcile (below). The SPA ships fresh because its bundle was just rebuilt — no separate SPA work.

## The two things that make it actually work

These are the only non-obvious bits; everything else is the existing deploy path.

1. **An explicit redeploy rebuilds — and re-runs the upstream fetch — on its own.** This was the central risk, now **empirically settled** (see *Live probe* below). The [Skipped Builds](https://docs.railway.com/builds/skipped-builds) optimization (skip when *app-repo source* is unchanged — and ours never changes, only `origin/main` moves) applies to *automatic git-push* deploys; an **explicit redeploy always rebuilds**. A throwaway probe service whose build phase bakes a unique stamp confirmed that a no-source-change `railway redeploy`, **with `NO_CACHE` off**, re-ran every build layer (stamp changed on each of two consecutive redeploys) — including the `git ls-remote` layer. So the cron's API redeploy picks up a moved `origin/main` without `NO_CACHE` and without any source change. (`NO_CACHE=1` remains available as defense-in-depth if Railway's builder cache behavior ever changes, but is **not required**.)
2. **Build pulls `origin/main`, not the pinned submodule.** Today `nixpacks.toml` runs `git submodule update --init --recursive`, which checks out the *pinned* SHA. Add a `git -C vendor/next-gen-atlas fetch origin main && checkout origin/main` so the rebuild picks up upstream. (The probe proved the redeploy re-runs this RUN layer; this line is what makes the re-run actually advance the content.)

**Convergence guard (still required).** If a *completed* redeploy ever fails to move `atlas_sha` (e.g. the `fetch origin/main` silently no-op'd), every tick would see drift and redeploy again forever. So the cron **records the last sha it triggered a redeploy for** and won't re-trigger for the same target while that deploy is in-flight/unconfirmed — degrading a broken redeploy to **stuck-stale + loud logs**, not an infinite rebuild loop. The guard reads freshness only from **`/health.atlas_sha`**, never Railway's deploy `meta.commitSha` (which is the app-repo commit and never moves).

## Live probe — what was verified (2026-06-01)

Ran against a throwaway Railway project (`rebuild-probe`, since torn down / pending teardown), Nixpacks builder + V3 build environment (same family as the web service):

- **`railway redeploy` with no source change rebuilds.** Status went `BUILDING → DEPLOYING → SUCCESS` and the build-time stamp changed on **both** consecutive redeploys (`…285 → …587 → …724`). This **refutes** the prior assumption that redeploy "reuses the existing image."
- **`NO_CACHE` was not needed** for early, stable-command RUN layers (the `git fetch`/`ls-remote` analogue) to re-execute.
- **API token caveat:** the Railway CLI's *user* access token returned `Not Authorized` for the `deployments` query. The cron must use a proper **Railway project/team API token** for both the redeploy mutation and the in-flight deploy-status read.

Still to confirm with that API token (cheap, non-blocking): which exact mutation the cron calls — `serviceInstanceRedeploy(serviceId, environmentId)` is the natural fit and matches the CLI's behavior, but verify it (vs `deploymentRedeploy(id)`) rebuilds the same way under a project token.

## Two Railway facts (verified)

- **A cron service must exit; it can't be the web server.** Railway skips the next firing if the previous run hasn't exited, so the detector is a **separate Railway service** sharing this repo, pointed at its own `railway.cron.toml` with `cronSchedule` set. The existing `railway.toml` stays the web service. ([Cron Jobs](https://docs.railway.com/cron-jobs), [Config as Code](https://docs.railway.com/config-as-code/reference))
- **An explicit redeploy *does* rebuild** (probe-verified above) — the earlier "redeploy ≠ rebuild" worry does not hold for API/CLI/dashboard redeploys; it only applies to skipped automatic git-push deploys.

## Embeddings — a detached job at boot, off the critical path

Semantic search reads pgvector (`atlas_doc_embeddings`), embedded from doc *content* via OpenRouter. That third-party call can fail, so it must **never** gate the redeploy or the boot — and `sync:embeddings` reads `public/docs.json` from disk (sync-embeddings.ts:41–43), so it needs the freshly-built artifacts, which the web service has after a redeploy.

So embedding rides the deploy itself: **the boot spawns `sync:embeddings` as a detached background subprocess** once the server is listening (`Bun.spawn(["bun", "src/server/sync-embeddings.ts"], { detached, stdio → container logs })`). No internal endpoint, no cron poke, no in-process lock — and because it's a separate process with its own DB pool, its `sql.end()` can't tear down the serving process's pool.

- **Why boot, not the build phase:** embeddings write to Postgres at runtime; the builder environment doesn't have the PG service on its network and `DATABASE_URL` isn't reliably reachable there, and the built image is cached/skipped anyway. So it hooks in at start, right next to the existing `sync:atlas`.
- **Why detached:** a slow or failing OpenRouter call must not delay the health check and fail the deploy. Backgrounded, the server serves immediately; embed catches up behind it.
- **Cheap when nothing changed:** the reconcile is content-hash-gated (sync-embeddings.ts:54) — a sub-second no-op (one `SELECT`, zero embeds) on every boot that isn't an atlas update.
- **Self-healing within a run:** each batch upserts independently (sync-embeddings.ts:78), so partial progress persists; add a small **retry/backoff inside `sync-embeddings`** to ride out transient OpenRouter blips. An *extended* outage falls back to **stale-until-next-deploy** (no per-interval retry, since embedding now rides deploys, not the cron) — a few dead semantic hits we filter anyway. Acceptable by design, given updates land ≤ once/day and a deploy happens on every atlas change.
- **stdio → logs** so "did embeddings actually run?" is answerable from container logs; a silent detached job is exactly what you'd otherwise be debugging.

## What we deliberately do NOT build

Because a redeploy refreshes the whole app, none of this is needed: a storage bucket or other cross-process channel, an `/internal/reload` index-swap hook, in-memory hot-swap, versioned/content-addressed SPA artifacts, browser-side polling, **any internal endpoint, the `::` dual-stack bind, or Railway private networking** (the cron reads only the public `/health`). If the chatbot later needs no-interrupt updates, that's a separate change layered on then — not now.

## On-chain artifacts are a separate cadence

`build:addresses` (Etherscan) and `build:snapshot` (RPC) need API keys and change independently of atlas commits. They are already committed artifacts loaded at boot and are **not** part of this loop. The freshness redeploy only rebuilds the markdown-derived artifacts (which `build:railway` already does).

## History is NOT refreshed by this loop (known gap)

`build:railway` does **not** run `build:history`, so the freshness redeploy leaves `public/history/*.json` at whatever is **committed in the repo**. At boot, `sync:atlas` loads those (stale) files into the `atlas_history` Postgres table (`sync.ts`), which backs the history MCP tools (`atlas_history`, `atlas_recent_changes`, `atlas_changed_between`, and `atlas_query`'s `since/until/change_type` windows) and the frontend history tab. **So a freshly-redeployed bundle has current content/graph/embeddings but stale history** — the new commit's events don't appear until `build:history` is re-run and re-committed (the GitHub `atlas-update.yml` PR path). History freshness therefore *still* depends on GitHub.

This is accepted for now (option A). `build:history` is in the slow lane because `build-history.mjs` pulls **GitHub PR metadata** and **Sky forum posts** (`.cache/discourse`) — external deps, not markdown-only — so it isn't trivially safe to drop into the redeploy build. If history-in-the-loop is wanted later (option B): add `node scripts/required/build-history.mjs` to the Railway build (skip `build:forum-cache`; forum enrichment degrades gracefully on cache miss) with a GitHub token in the build env, and make the PR-metadata fetch non-fatal so a transient API failure can't break the deploy. It's incremental (`_last_commit.txt`), so the per-redeploy cost is small.

## Concrete file-touch list

**New:**
- `railway.cron.toml` — cron service config: `cronSchedule` (every 5 min), start command = the detector script. Wired to a second Railway service in the dashboard, with a Railway API token to trigger the redeploy.
- `scripts/required/refresh-atlas.mjs` (+ `pnpm refresh:atlas`) — each firing: `ls-remote` vs public `/health`; on drift, if no redeploy is already in flight for that target sha, trigger a redeploy via the Railway API (`serviceInstanceRedeploy`) and record the target sha; else exit. No `NO_CACHE` needed (probe-verified an explicit redeploy rebuilds).

**Changed:**
- `src/server/index.ts` — after `Bun.serve` is listening, spawn the `sync:embeddings` reconcile as a detached background subprocess (stdio inherited to logs), guarded behind an env flag so local dev can opt out. No bind change, no internal endpoint.
- `src/server/sync-embeddings.ts` — add retry/backoff around the per-batch embed call so transient OpenRouter failures don't lose the run. (It already runs standalone via `await main()`, so it spawns cleanly as a subprocess; its `sql.end()` only affects its own pool.)
- `nixpacks.toml` — build phase pulls `origin/main` for the submodule before `build:railway`.
- `package.json` — add the `refresh:atlas` script entry (`"refresh:atlas": "node scripts/required/refresh-atlas.mjs"`) so the cron's start command and local runs share one entry point.
- Web service env — *optional* `NO_CACHE=1` as defense-in-depth. The probe showed an explicit redeploy already re-runs the build layers without it, so it is **not required**; set it only if you want insurance against future Railway builder-cache changes (cost: slower builds, which we don't budget against anyway).

### Operator setup (not code)

Create the cron service from this repo pointed at `railway.cron.toml`, then give it the env below. The detector authenticates to Railway's GraphQL API with a **project token** — the right credential here: least privilege, scoped to one project + environment, and revocable independently of any account.

**Why a project token (not the CLI login token, not an account token):**
- The Railway **CLI login/OAuth token** (`~/.railway/config.json`) is **not authorized** for the public API — verified live: both the `deployments` query and the `serviceInstanceRedeploy` mutation returned `Not Authorized`. So the cron cannot reuse a `railway login` session.
- An **account/workspace token** (`Authorization: Bearer`) works but grants access to *all* your resources — more blast radius than the cron needs.
- A **project token** is scoped to a single project+environment and is the documented fit. *(Assumed-good per Railway docs; not live-tested here because exercising it would mean keeping the paid probe service running — the mechanism it drives, an explicit redeploy rebuilding, is already probe-verified above.)*

**Create the project token:**
1. In the **web service's** project → **Settings → Tokens** (project-level tokens, *not* `account/tokens`).
2. Create a token (e.g. `atlas-refresh-cron`), scoped to the environment the web service runs in (**production**).
3. It is sent as the **`Project-Access-Token: <token>`** HTTP header — *not* `Authorization: Bearer`. That one project token is all the credential the cron needs; it can call `serviceInstanceRedeploy` and read the `deployments` status for that project, and nothing outside it.

**Env vars on the cron service:**
- `RAILWAY_PROJECT_TOKEN` — the project token above (`Project-Access-Token` header).
- `WEB_SERVICE_ID` and `WEB_ENVIRONMENT_ID` — the web service's IDs (the redeploy mutation takes them explicitly even though the token is environment-scoped; read them once from `railway status --json` or the dashboard URL).
- `WEB_HEALTH_URL` — the web service's **public** `/health` URL (drift check; no private networking).
- `ATLAS_REMOTE` — upstream atlas git URL for `git ls-remote ... refs/heads/main` (e.g. `https://github.com/sky-ecosystem/next-gen-atlas.git`).
- `RAILWAY_API_URL` (optional) — defaults to `https://backboard.railway.com/graphql/v2`.

No same-project/same-environment requirement between cron and web (private networking is not used) — though putting the cron in the same project lets the one project token cover it naturally.

**`atlas-update.yml` stays — required for history.** Atlas *text* freshness no longer depends on it, but it's the only path that rebuilds `history/*.json`, so it remains **required to keep the history view current** (until history moves into the live loop).

## Open questions (resolve during implementation)

- **Redeploy rebuilds — RESOLVED (probe-verified 2026-06-01).** An explicit redeploy with no source change rebuilds and re-runs the `fetch origin/main` layer, no `NO_CACHE` needed (see *Live probe*). The cron calls `serviceInstanceRedeploy(serviceId, environmentId)` and reads the `deployments` query `status` enum for the in-flight guard.
- **Project-token API authz — ASSUMED (not live-tested).** The CLI login token is `Not Authorized` for the API (verified); a project token is the documented credential (see *Operator setup*). Exercising it live would mean running the paid probe service, so it's taken on the docs' word. First real implementation step should be a one-call smoke test of `serviceInstanceRedeploy` under the actual project token before wiring the full detector.
- **Live SHA source — RESOLVED.** `/health` returns `atlas_sha` from the in-memory `ix.meta.atlasCommit` baked into the running bundle (`index.ts:41`) — exactly the "is the running bundle stale?" signal the cron needs. Use `/health`, not a `sync_state` query.
