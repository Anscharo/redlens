# SAbR Deployment Runbook

Stand up the full SAbR app (reader SPA + MCP endpoint + chat/OAuth + live
atlas updates). Follow the steps in order.

Deployment has **three parts**: **Railway** hosts the app as two services — a
web service and an atlas worker cron — and **GitHub** runs the hourly
atlas-update workflow that keeps the repo's submodule pointer current. All
three are required for a fully live deployment.

For the live Railway layout, see the [Deployment section of the README](../README.md#deployment).
GitHub Pages is only a redirect stub for old `/redlens` links, not a second app.

---

# Part 1 — Railway (the app)

## How the two services work together

```
atlas worker (cron, every 12 min)
  git ls-remote → detect new atlas SHA
  build-index → docs.json
  sync.ts → upsert atlas_doc_meta, atlas_addresses, advance sync_state.atlas_sha
  parallel:
    sync-embeddings.ts → atlas_doc_embeddings
    build-history → sync-history-pg → atlas_history

web service (always running)
  polls sync_state.atlas_sha every 30s
  on drift → rebuild docs.json + addresses.atlas.json from DB
           → run build-graph + build-glossary
           → hot-swap in-memory indexes (no restart)
  SSE /api/atlas-events → push atlas-update event to connected browsers
```

The worker is the only process that writes to Postgres. The web service only
reads from it and rebuilds its own in-memory state.

## 1. Prerequisites

Before you start, make sure you have:

1. **A GitHub account** with **admin** access to this repo.
2. **A Railway account** — sign up at [railway.com](https://railway.com).
3. **The Railway CLI**, logged in:
   ```bash
   npm i -g @railway/cli   # or: brew install railway
   railway login
   ```
4. **An OpenRouter account** with credits — used for semantic search embeddings
   (and chat, if you enable it). Setup in step 3a.

## 2. Create the project, Postgres, and web service

a. **Create the project from this GitHub repo.** Go to
   [railway.com/new](https://railway.com/new) → **Deploy from GitHub repo**.
   Authorize the Railway GitHub App for this repository if prompted, then
   select it. Railway creates a **web service that auto-deploys on every push
   to `main`**. This runbook calls it `redlens-atlas`.

b. **Add managed Postgres.** On the project canvas: **New → Database → Add
   PostgreSQL**. *Railway's managed Postgres already includes `pgvector`.*

c. **Link the CLI to the project** so the next steps can set variables. From
   the repo root:
   ```bash
   railway link
   ```

d. **Wire `DATABASE_URL` to Postgres:**
   ```bash
   railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --service redlens-atlas
   ```
   *This is the single most common failure — Railway does **not** auto-inject
   the database URL. If your Postgres service has a non-default name, match it:
   `${{<ServiceName>.DATABASE_URL}}`.*

## 3. Set the web service environment variables

For a condensed variable-name cheat sheet, see [railway-env-vars.md](./railway-env-vars.md).

### 3a. Get an OpenRouter API key → `OPENROUTER_API_KEY`

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) and sign in.
2. Add credits: **Settings → Credits → Add Credits**.
3. **Create Key** → copy the value (starts with `sk-or-`).

### 3b. Set the variables

```bash
railway variables --set 'OPENROUTER_API_KEY=sk-or-...' --service redlens-atlas
```

| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Set in step 2d |
| `OPENROUTER_API_KEY` | `sk-or-…` | Semantic search embeddings + chat |
| `ATLAS_UPDATE_ENABLED` | _(unset)_ | In-process DB poller, **on by default**; set `0` only as a kill switch to disable it |

## 4. Add the atlas worker cron service

The worker is a separate Railway service that runs on a 12-minute cron. It
builds the atlas artifacts and syncs all Postgres tables so the web service
can rebuild from DB.

a. **Create the service.** On the Railway project canvas: **New → GitHub
   Repo** → select this repo again. Railway creates a second service.

b. **Point it at the worker config file.** In the service settings:
   - **Build → Config file path:** `railway.worker.toml`

   This tells Railway to use `Dockerfile.worker` (a headless image with git +
   gh CLI for history builds) and set the cron schedule (`*/12 * * * *`).

c. **Link DATABASE_URL** to the same Postgres instance:
   ```bash
   railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --service redlens-worker
   ```

d. **Create a GitHub fine-grained token → `GITHUB_TOKEN`.** The worker uses
   `gh pr view` to fetch PR title, author, and body for atlas history entries.
   This only reads the public `sky-ecosystem/next-gen-atlas` repo, so the token
   needs minimal permissions:

   - [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
     → **Generate new token**
   - **Token Name**:  can be whatever you want Reccomend "railway worker"
   - **Expiration**: Will need to do this again when it expires. Reccomend long since this is read only 
   - **Repository access:** Public repositories (read-only)
   - **Permissions:** none additional — public repo content is readable with
     any valid token
   - Copy the `github_pat_…` value

   *The container has no stored `gh` credentials, so without this token every
   `gh pr view` call fails silently — history entries record only the commit
   hash and diff, with no PR title, author, or summary.*

e. **Set the worker variables:**
   ```bash
   railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --service redlens-worker
   railway variables --set 'OPENROUTER_API_KEY=sk-or-...'            --service redlens-worker
   railway variables --set 'GITHUB_TOKEN=github_pat_...'             --service redlens-worker
   ```

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | Same Postgres as the web service |
| `GITHUB_TOKEN` | **yes** | `gh pr view` for history PR metadata — no stored creds in container |
| `OPENROUTER_API_KEY` | optional | Embeddings — skipped gracefully if unset |
| `ATLAS_WORKER_FULL=1` | optional | Force a full history rebuild from the beginning |
| `CHAINSTATE_REFRESH_SECONDS` | optional | Age past which the worker re-runs the contract-state multicall sweep (default `86400`, daily; `604800` for the weekly cadence the old committed-file workflow had) |
| `ETH_RPC_URL` | optional | Mainnet RPC for that sweep; the public `CHAIN_RPC.ethereum` default is used when unset |

## 5. Configure services and deploy

a. **Web service settings** (service → **Settings**):
   - **Memory:** ~1 GB RAM.
   - **Replicas:** **1** *(the in-process updater is single-container by
     design — do not scale out).*

   Capacity measurement (idle `/api/atlas-events` holds, homepage RPS, chat SSE,
   and OOM/restart behaviour) lives in `scripts/aux/load/` — off the build
   chain. `/api/health` exposes `rss_mb` and `sse_clients` as canaries; it
   stays HTTP 200 even when RSS is high so a large process cannot restart-loop.

b. **Generate the public URL.** Web service → **Settings → Networking →
   Generate Domain**. Note it — you'll need it for OAuth in step 7.

c. **Deploy.** Railway redeploys the web service automatically on push or
   variable change. The worker deploys on its cron schedule. To trigger the
   worker manually: service **Deployments → Trigger deploy**.

   *The web service uses a two-stage Docker build: the builder stage clones
   the atlas and bakes docs.json, graph.json, and the Vite bundle into the
   image; the runtime stage is lean (no git, no python3). The server starts
   immediately serving the baked-in atlas snapshot; the in-process updater
   then keeps it fresh from Postgres as the worker advances the atlas.
   The worker image is headless (no Vite build) and runs
   `atlas-worker.mjs` on each cron tick.*

## 6. Verify

a. **Health check:**
   ```bash
   curl https://<your-domain>/api/health
   # → { "status":"ok", "atlas_sha":"...", "db_sha":"...", "age_seconds":N,
   #     "schema":"00X_...", "required_schema":"00X_...", "db_reachable":true, "docs":N }
   ```
   `/api/health` is **liveness** — it always returns HTTP 200 while the process
   is up (a stale snapshot must not restart-loop a healthy container), and
   reports the freshness `status` in the body.

   For **alerting**, point an uptime monitor at `/api/freshness`, which is
   status-coded:
   ```bash
   curl -i https://<your-domain>/api/freshness
   # 200 → status "ok" | "syncing"   (healthy: converged, or briefly catching up)
   # 503 → status "stuck"            (updater hasn't converged past ATLAS_STUCK_SECONDS)
   #     | "stale"                   (no worker sync in ATLAS_STALE_SECONDS — worker likely dead)
   #     | "schema_behind"           (DB schema older than this image requires)
   #     | "degraded"                (DB unreachable)
   ```
   Tunables (all optional, sane defaults): `ATLAS_STALE_SECONDS` (default 1h)
   — `sync_state.synced_at` doubles as the worker heartbeat: every 12-min cron
   tick touches it, including no-op runs where the atlas SHA hasn't advanced
   (the worker's lightweight-check fast exit still issues an `UPDATE
   sync_state SET synced_at = now()` before returning), so "stale" now
   genuinely means the worker hasn't run in over an hour, not just that the
   atlas hasn't changed. `ATLAS_STUCK_SECONDS` (default 30m),
   `ATLAS_UPDATE_MAX_BACKOFF_MS` (default 30m), `ATLAS_UPDATE_ESCALATE_AFTER`
   (default 3).

   **Built-in external monitor:** `.github/workflows/freshness-monitor.yml`
   curls `/api/freshness` every 30 minutes (plus `workflow_dispatch`). A
   non-2xx response fails the job, and GitHub emails the repo owner on
   workflow failure — so this doubles as alerting without a third-party
   uptime service. No secrets or checkout required.

b. **Web service boot logs** — look for `db: connected`, `migrations: …`,
   `sync:atlas — done`, and `listening on :3000`. Migrations run at web boot
   now (advisory-locked, race-safe with the worker), so a redeploy that ships a
   new migration applies it even on an already-seeded DB.

c. **Worker logs** — after the first cron fires (~12 min), look for
   `atlas-worker: done in Xs`. The `atlas_sha` in `/api/health` will advance.

d. **Open the site** in a browser. Lexical search works immediately. Semantic
   search fills in once embeddings finish *(first run takes a few minutes).*
   The footer shows the live atlas commit hash and node count once docs.json
   loads.

## 7. (Optional) Enable logins + chat — GitHub and Google OAuth

**Skip this whole section unless you want logins or chat.** The reader SPA,
`/mcp`, and the atlas worker all work with just the step-3/4 variables.

Login features (profile button, saved Collections) and chat ship **disabled**
by default. There are **two feature gates**, each with a build arg + a runtime
switch:

- **Logins** — `VITE_USERS_ENABLED=1` (**build arg**, baked into the bundle) +
  `USERS_ENABLED=1` (**runtime**, mounts `/api/auth/*` and `/api/collections*`).
- **Chat** — `VITE_CHAT_ENABLED=1` (**build arg**) + `CHAT_ENABLED=1`
  (**runtime**, mounts `/api/chat` and `/api/usage`).

Chat requires a logged-in session, so it is **AND-gated by the users flags**:
`CHAT_ENABLED=1` on its own does nothing — you must set the `USERS_ENABLED` /
`VITE_USERS_ENABLED` pair as well. To enable **only logins** (Collections, no
chat), set just the users pair. The OAuth/JWT variables below back both.

### 7a. Generate the JWT session secret → `CHAT_JWT_SECRET`

```bash
openssl rand -hex 32
```

> **Providers are independent — configure one or both.** The login surface shows
> a button only for a provider whose `*_CLIENT_ID` **and** `*_CLIENT_SECRET` are
> both set (`src/lib/authProviders.ts`). Set only the GitHub pair for GitHub-only
> sign-in, only the Google pair for Google-only, or both for both.

### 7b. Create a GitHub OAuth app → `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

1. [github.com/settings/developers](https://github.com/settings/developers)
   → **OAuth Apps → New OAuth App**.
2. Fields:
   - **Application name:** anything (e.g. `Sky Atlas by Redline`).
   - **Homepage URL:** `https://atlas.redline.support`
   - **Authorization callback URL:**
     `https://atlas.redline.support/api/auth/github/callback`
3. Copy the **Client ID** and generate a **Client secret**.

**Scopes:** none are set at app-creation time — the app requests `read:user`
and `user:email` at sign-in (`src/server/auth.ts`), both non-privileged. GitHub
does not require a privacy policy for an OAuth App.

### 7c. Create a Google OpenID (OAuth 2.0) client → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

The app signs in with **OpenID Connect + PKCE** and requests only the
**non-sensitive** scopes `openid`, `email`, `profile`. Because none are
sensitive or restricted, **Google app verification (the security assessment /
third-party audit) is NOT required** — but a **privacy policy URL is required
to publish** the app to production (see the note at the end).

Google groups this under **APIs & Services → Google Auth Platform** (formerly
"OAuth consent screen"). Configure the consent screen once, then create a
client. Below is **every field the console asks for and the value to enter**.

**Step 1 — Project** ([console.cloud.google.com](https://console.cloud.google.com))

| Field | Value |
|---|---|
| Project name | Anything, e.g. `redlens-atlas` |

**Step 2 — Google Auth Platform → Branding** (the consent screen)

| Field | Value |
|---|---|
| App name | `Sky Atlas by Redline` |
| User support email | Your support address (e.g. `support@redline.support`) — shown publicly on the consent screen |
| App logo | Optional — skip, or upload `public/icon-SMALL.png` |
| Application home page | `https://atlas.redline.support` |
| Application privacy policy link | `https://atlas.redline.support/privacy` |
| Application terms of service link | Optional — leave blank |
| Authorized domains | `redline.support` |
| Developer contact information | Your email (e.g. `support@redline.support`) |

*The home-page / privacy / terms links require the **Authorized domain** to be
set first, and each link's host must fall under it (`redline.support`).*

**Step 3 — Audience**

| Field | Value |
|---|---|
| User type | **External** |
| Test users | Add your own Google address(es) while in **Testing** |
| Publishing status | **Testing** to start; **Publish app** → **In production** when ready for everyone |

**Step 4 — Data access (scopes)** — click **Add or remove scopes** and select
exactly these three (all non-sensitive → no verification needed):

| Scope | Google name |
|---|---|
| `openid` | (OpenID Connect — "Associate you with your personal info on Google") |
| `email` | `.../auth/userinfo.email` |
| `profile` | `.../auth/userinfo.profile` |

*The app also requests these at runtime, so sign-in works even if this list is
left empty — but set them so the consent screen shows the correct summary.*

**Step 5 — Clients → Create client** (the OAuth client ID itself)

| Field | Value |
|---|---|
| Application type | **Web application** |
| Name | Any label, e.g. `redlens-atlas web` |
| Authorized JavaScript origins | Optional — **leave empty** (server-side redirect flow, no browser SDK) |
| Authorized redirect URIs | One per environment (add all you use): `https://atlas.redline.support/api/auth/google/callback` (production) · `https://redlens-development.up.railway.app/api/auth/google/callback` (dev/staging) · `http://localhost:3000/api/auth/google/callback` (local dev) |

On save, copy the generated **Client ID**
(`…apps.googleusercontent.com`) → `GOOGLE_CLIENT_ID` and **Client secret** →
`GOOGLE_CLIENT_SECRET`.

*One client can serve all environments — add each redirect URI as its own entry
(Google matches them exactly). **Caveat for publishing:** once you move the app
to **In production**, Google's brand verification expects every redirect-URI host
to fall under an **Authorized domain**, and you can't add `up.railway.app` (you
don't own it, so it can't be verified). Two clean options: keep a **separate
OAuth client for staging that stays in Testing mode** (test users only, no brand
verification), or put staging on a `redline.support` subdomain you can verify.
The production client should carry only `redline.support` redirect URIs.*

**Privacy policy — required to publish.** While in **Testing** (≤100 test
users) you can sign in immediately; the consent screen just shows an
"unverified app" notice. To move to **In production** so any Google user can
sign in, Google requires the privacy policy URL above to be **live**. It is
served at [`/privacy`](https://atlas.redline.support/privacy) (rendered from
`PRIVACY.md`, linked in the footer), so publish this app **after** the deploy
that ships `/privacy` is live. Terms of service is optional for these scopes.

### 7d. Set the login + chat variables

```bash
railway variables --set 'VITE_USERS_ENABLED=1'             --service redlens-atlas
railway variables --set 'USERS_ENABLED=1'                  --service redlens-atlas
railway variables --set 'VITE_CHAT_ENABLED=1'              --service redlens-atlas  # chat only
railway variables --set 'CHAT_ENABLED=1'                   --service redlens-atlas  # chat only
railway variables --set 'CHAT_JWT_SECRET=<from 7a>'        --service redlens-atlas
railway variables --set 'GITHUB_CLIENT_ID=<from 7b>'       --service redlens-atlas
railway variables --set 'GITHUB_CLIENT_SECRET=<from 7b>'   --service redlens-atlas
railway variables --set 'GOOGLE_CLIENT_ID=<from 7c>'       --service redlens-atlas
railway variables --set 'GOOGLE_CLIENT_SECRET=<from 7c>'   --service redlens-atlas
```

*(For logins without chat, omit the two `*CHAT_ENABLED` lines.)*

| Variable | Purpose |
|---|---|
| `VITE_USERS_ENABLED` | Build arg — bakes the profile button + Collections UI into the bundle |
| `USERS_ENABLED` | Runtime switch — mounts `/api/auth/*` + `/api/collections*` routes |
| `VITE_CHAT_ENABLED` | Build arg — bakes the chat widget into the bundle (needs the users pair too) |
| `CHAT_ENABLED` | Runtime switch — mounts `/api/chat`, `/api/usage` (AND-gated by `USERS_ENABLED`) |
| `CHAT_JWT_SECRET` | Signs session cookies |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `OPENROUTER_MANAGEMENT_KEY` | Optional — provisioning key for the account-wide credits endpoint; powers the chat's shared "commons" dollar meter and its at-empty gate. Unset = meter hidden, gate never fires |

*Setting a `VITE_*_ENABLED` build arg triggers a full image rebuild so the bundle
includes the widgets. If you later move to a custom domain, also set
`APP_URL=https://<custom-domain>` and update the provider callback URLs.*

> **⚠️ APP_URL is mandatory once the service has more than one domain attached**
> (e.g. the apex `redline.support` alongside `atlas.redline.support`).
> `RAILWAY_PUBLIC_DOMAIN` is ambiguous with multiple domains — Railway picks one,
> and if it picks a domain other than the one registered with the OAuth
> providers, every sign-in fails with "The redirect_uri is not associated with
> this application". Pin it:
> `railway variables --set 'APP_URL=https://atlas.redline.support' --service redlens-atlas`.
> With `APP_URL` set (https), the server also 301s GET/HEAD requests on any
> other attached host to the canonical origin (`src/server/canonical.ts`) —
> required for OAuth anyway, since the CSRF state cookie is host-only and a flow
> started on the apex could never complete on the subdomain. Escape hatch:
> `CANONICAL_HOST_REDIRECT=0` (and `=1` to force it on).
>
> **That redirect is gated on `RAILWAY_ENVIRONMENT_NAME === "production"`.**
> Per-PR environments are forked from the base environment and inherit this
> pinned `APP_URL`, so an ungated redirect 301s each PR deploy's own hostname to
> production: the preview is unreachable, and the `e2e.yml` Playwright run
> (which follows redirects) silently asserts against prod instead of the PR
> build. Don't "fix" a PR env by setting `APP_URL` per-environment — the gate
> handles it. Note that sign-in inside a PR env still lands on production,
> because the OAuth callback is registered against the canonical host only.

---

# Part 2 — GitHub (atlas-update workflow)

`.github/workflows/atlas-update.yml` runs **hourly**. It checks whether the
atlas submodule has advanced, and if so: runs `build:index` + `build:graph` +
`test:snap:update`, commits the new submodule pointer + updated graph
snapshots, and pushes to `main` — triggering a Railway web service redeploy.

The workflow is responsible for keeping the **git submodule pointer** and
**graph snapshots** current. It does **not** sync Postgres or build history —
those are handled entirely by the Railway atlas worker.

## 8. Install the bot (GitHub App) → `ATLAS_BOT_APP_ID`, `ATLAS_BOT_PRIVATE_KEY`

The workflow pushes directly to `main`. If your repo has branch protection
requiring pull request reviews, the default `GITHUB_TOKEN` cannot bypass it.
Create a GitHub App that can:

a. **Create the App:** [github.com/settings/apps](https://github.com/settings/apps)
   → **New GitHub App**. Repository permissions:
   - **Contents:** Read & write
   - **Pull requests:** Read & write
   - **Issues:** Read & write

b. **Generate a private key** (gives `ATLAS_BOT_PRIVATE_KEY`) and note the **App ID** (gives `ATLAS_BOT_APP_ID`).

c. **Install the App on this repo.**

d. **Make the bot a branch-protection bypass actor:** repo **Settings →
   Branches →** the `main` rule → **Allow specified actors to bypass required
   pull requests** → add the App.

## 9. Add the workflow secrets

Add these under repo **Settings → Environments → `atlas-update-main-bypass`**
(the environment used by both atlas-update and chainstate-update workflows):

| Secret | Value | Used by |
|---|---|---|
| `ATLAS_BOT_APP_ID` | App ID from step 8b | Both workflows (App token mint) |
| `ATLAS_BOT_PRIVATE_KEY` | Full contents of the `.pem` from step 8b | Both workflows (App token mint) |
| `ETHERSCAN_API_KEY` | [Etherscan API key](https://etherscan.io/apidashboard) | `chainstate-update.yml` (`build:addresses`); also atlas-update on bumps |
| `BLOCKSCOUT_API_KEY` | Blockscout API key (optional) | `chainstate-update.yml` (`build:addresses`); raises the Blockscout rate limit used for Robinhood Chain + as the Etherscan fallback |
| `ETH_RPC_URL` | Ethereum mainnet RPC URL (optional) | Railway **worker** service (its time-gated chain-state sweep) and manual `snap:chainstate` runs; overrides the `CHAIN_RPC.ethereum` default if set |

RPC endpoints live per chain in `scripts/lib/chains.mjs` (`CHAIN_RPC`, free
public endpoints), so no `ETH_RPC_URL` secret is required — set one only to
override the default when the public endpoint rate-limits. `pnpm census:chains
--rpc` round-trips `eth_chainId` against every endpoint to confirm each one
still answers for the chain id the registry claims.

Committed on-chain data (`addresses.json` plus the `.cache/etherscan` ABI cache)
refreshes weekly via `.github/workflows/chainstate-update.yml` (Sunday 22:00 UTC)
— separate from the hourly atlas submodule loop. The contract-state snapshot is
NOT part of that loop: it is decommitted, and the Railway atlas worker fetches it
straight into the Postgres `chain_state` table on its own time gate
(`CHAINSTATE_REFRESH_SECONDS`, default daily).

---

## Ongoing operation

- **Atlas text + history + embeddings** refresh automatically within ~15 min
  of an upstream atlas commit (worker cron detects the new SHA, builds, syncs
  Postgres; web service detects the DB change within 30s and hot-swaps indexes).
- **Browser notification** — the footer shows an "atlas updated ↻" pill when
  the live SHA drifts from what was loaded; clicking reloads to pick up the
  new content.
- **Submodule pointer in git** stays current via the hourly atlas-update
  workflow, keeping CI + graph snapshots in sync.
- **Committed on-chain data** (`addresses.json`, `.cache/etherscan`) refreshes
  weekly via the `chainstate-update` workflow (Sunday 22:00 UTC) — separate from
  the hourly atlas submodule loop.
- **Contract-state snapshot** refreshes on the atlas worker's own time gate
  (`CHAINSTATE_REFRESH_SECONDS`, default daily): one `SELECT fetched_at` per
  ~12-minute cycle, multicall sweep only past the gate, upserted into the
  single-row `chain_state` table and served from `GET /api/chain-state`. The
  row populates on the worker's first post-deploy cycle; until then the route
  503s and the footer shows no on-chain values.

## Troubleshooting

**Container crash-loops on `ERR_POSTGRES_CONNECTION_CLOSED`**
→ `DATABASE_URL` isn't wired. Re-check step 2d.

**Atlas tree shows empty on first deploy**
→ The image bakes in a snapshot of the atlas at build time, so this
should not happen on a normal deploy. If it does, the builder stage
likely failed to clone the atlas — check the Railway build logs for the
`git clone` step.

**Semantic search returns nothing**
→ `OPENROUTER_API_KEY` is missing or out of credits; lexical search still
works. Check the key and your OpenRouter balance.

**Atlas text never updates without a redeploy**
→ the in-process poller was disabled via `ATLAS_UPDATE_ENABLED=0` on the web
service, or the worker isn't running (check its Deployments tab and logs).
`/api/freshness` will show `stale` (worker down) or `stuck` (poller not
converging).

**History tab is empty / always empty**
→ The worker hasn't run yet, or `DATABASE_URL` is not set on the worker
service. Check worker logs for `atlas-worker: done`.

**Worker cron runs but `atlas_sha` in `/api/health` doesn't advance**
→ Worker `DATABASE_URL` points to a different Postgres than the web service.
Both must reference `${{Postgres.DATABASE_URL}}` from the same Postgres
instance in the same Railway project.

**atlas-update workflow pushes fail**
→ The bot isn't a branch-protection bypass actor (step 8d), or the
`ATLAS_BOT_*` secrets are missing (step 9).

**Blank page / "module script MIME type" errors**
→ Assets not resolving from the domain root. Vite's base is hardcoded to `/`
(`vite.config.ts`); verify with `curl https://<your-domain>/ | grep assets`
(must show `/assets/…`).

**OAuth fails with a redirect-URI mismatch**
→ The callback URL registered with the provider must exactly match
`https://<your-domain>/api/auth/<provider>/callback`. On a custom domain set
`APP_URL` (step 7d) and re-check the provider config. Check the actual
`redirect_uri` query param in the provider's authorize URL from the failing
sign-in — if its host is a different domain of the same service (the apex, or
the `up.railway.app` default), `APP_URL` is unset and `RAILWAY_PUBLIC_DOMAIN`
resolved to the wrong attached domain (see the warning in step 7d).

**"pnpm could not be found" / wrong start command**
→ Railway auto-detected the pnpm workspace and set its own start command,
overriding the Dockerfile CMD. The fix is already in `railway.toml`
(`startCommand = "bun run sync:atlas && bun run start"`), but if Railway
picked up a stale dashboard override first, clear it: service → **Settings →
Deploy → Start Command** → remove any custom value and redeploy.

**Build fails on git/python/submodule**
→ The builder must be `DOCKERFILE` (set in `railway.toml`); Nixpacks/Railpack
can't carry git + python3 + the atlas checkout needed at build time.
