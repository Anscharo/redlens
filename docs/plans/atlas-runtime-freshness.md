# Runtime Atlas Freshness — Self-Updating Service

**Status: PARKED.** Captured for later; not part of the chatbot MVP. Depends on the Railway + Bun architecture in [`chatbot-plan.md`](./chatbot-plan.md) being in place first (Postgres, in-memory indexes, `sync:atlas`, the `/internal/reload-atlas` hook).

## Motivation

This service is built for another team to operate. We may not have access to the git repo it deploys from or its Railway environment. That makes the default freshness path fragile:

> atlas advances → `atlas-update.yml` opens a PR → **someone with repo access merges** → **Railway redeploys** → fresh atlas live.

Both bolded steps are outside our control. If the operating team is slow to merge atlas-update PRs or redeploy, our atlas falls **noticeably behind the canonical Sky atlas** — which the consuming team will not tolerate.

**Goal:** make atlas freshness a *runtime property of the service*, decoupled from the deploy pipeline, so the deployment stays current with upstream no matter who operates it. We only need the feature in the code; we don't need standing repo/Railway access to keep it fresh.

## Proposed approach — self-update from upstream at runtime

A background worker in the Bun process polls the canonical next-gen-atlas repo (the same `git -C vendor/next-gen-atlas fetch origin main` the atlas-update workflow already does). When the upstream SHA advances:

1. **Rebuild markdown-derived artifacts in-process** — `build:index`, `build:graph`, `build:glossary`. These are pure, deterministic functions of the atlas markdown; no external APIs.
2. **Incremental `sync:atlas`** against the service's own Postgres (content-hash diff — only changed docs).
3. **Hot-swap the in-memory indexes** (graphology + minisearch + doc map) via the atomic-swap path already planned as `/internal/reload-atlas`.
4. **Serve fresh data** — no git commit to the app repo, no Railway redeploy.

Lag becomes the poll interval (minutes) instead of "whenever the team next ships." Inverts the model cleanly: the app repo holds the *code*; the *data* refreshes itself at runtime from the canonical source.

## Three things to get right

### 1. Safety valve replaces the PR / snapshot gate
Self-updating drops the human review + graph-snapshot regression test that currently catch a bad parse or a new structural pattern our parser mishandles. Replace it, don't just remove it:

- The self-update runs the build; if the build **fails** *or* the graph-snapshot diff **exceeds a threshold**, it **keeps serving the last-good snapshot and alerts** rather than swapping in something broken.
- Keep the last-good artifact set + its SHA so an in-process rollback is possible.
- Rationale: the governance review that matters already happened **upstream** (the Sky process reviews atlas changes). Re-reviewing in a read-only mirror is largely redundant — the only residual risk is *our parser*, which the last-good fallback contains.

### 2. Frontend must fetch versioned atlas data from the backend
Today the SPA fetches atlas JSON (`docs.json`, `relations.json`, etc.) baked into the deployed bundle. If only the backend hot-reloads, the chat stays fresh but the reader UI is stale until a redeploy. The SPA must fetch atlas artifacts from a **versioned runtime source** (an API the backend serves, or object storage keyed by `atlas_sha`) with a manifest/SHA check to bust cache. This is the one genuinely new piece of work, and it reworks the "aggressively cache static" CDN rule. It's what makes the *whole app* track upstream, not just chat.

### 3. On-chain artifacts are a separate cadence
`build:addresses` (Etherscan) and `build:snapshot` (RPC) need API keys and change independently of atlas commits. Do **not** couple them to the atlas-freshness loop — let them refresh on their own timer. The atlas-structure freshness loop only needs the markdown-derived artifacts.

## Open questions (resolve before designing)

- **Freshness SLA:** is "not noticeably behind" single-digit minutes, or is ~1 hour fine? Sets the poll interval and whether a simple poll suffices.
- **Update signal:** does upstream advance via the git repo we'd poll, or is there a faster signal (webhook, release/tag) we could subscribe to instead of polling?
- **Build cost in-process:** `build:graph` over ~10K docs is seconds-to-minutes of CPU; run it in a background worker/thread and atomic-swap so it doesn't compete with request handling. Confirm headroom on the Railway instance.
- **Will we have *any* operator access?** Self-update is robust either way, but if we have none, it's mandatory, not optional.
- **Artifact storage for rollback:** last-good artifacts in Postgres, a cache dir, or object storage keyed by SHA?

## Relationship to chatbot-plan.md

- Reuses, doesn't replace: the `/internal/reload-atlas` + atomic-swap hook (Build Order step 3), `sync:atlas` incremental diff, the content-hash machinery, and the embedding reconciler (changed-doc set drives re-embedding here too).
- The embedding reconciler already self-heals on a changed-doc set — this extends the same "service keeps itself current" philosophy from vectors to the whole atlas.
- Does **not** remove `atlas-update.yml` from the app repo; that PR flow can remain as the provenance/record path even if prod freshness is driven at runtime. (Decision deferred.)
