# RedLens Deployment Runbook

Stand up the full RedLens app (reader SPA + MCP endpoint + chat/OAuth + live
atlas updates). Follow the steps in order.

Deployment has **three parts**: **Railway** hosts the app as two services — a
web service and an atlas worker cron — and **GitHub** runs the hourly
atlas-update workflow that keeps the repo's submodule pointer current. All
three are required for a fully live deployment.

For what this service *is* and how it differs from the GitHub Pages static
reader, see the [Deployment section of the README](../README.md#deployment).

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
railway variables --set 'ATLAS_UPDATE_ENABLED=1'        --service redlens-atlas
```

| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Set in step 2d |
| `OPENROUTER_API_KEY` | `sk-or-…` | Semantic search embeddings + chat |
| `ATLAS_UPDATE_ENABLED` | `1` | Enables the in-process DB poller |

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

## 5. Configure services and deploy

a. **Web service settings** (service → **Settings**):
   - **Memory:** ~1 GB RAM.
   - **Replicas:** **1** *(the in-process updater is single-container by
     design — do not scale out).*

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
   # → { "status": "ok", "atlas_sha": "...", "docs": N }
   ```

b. **Web service boot logs** — look for `db: connected`, `sync:atlas — done`,
   and `listening on :3000`.

c. **Worker logs** — after the first cron fires (~12 min), look for
   `atlas-worker: done in Xs`. The `atlas_sha` in `/api/health` will advance.

d. **Open the site** in a browser. Lexical search works immediately. Semantic
   search fills in once embeddings finish *(first run takes a few minutes).*
   The footer shows the live atlas commit hash and node count once docs.json
   loads.

## 7. (Optional) Enable chat login — GitHub and Google OAuth

**Skip this whole section unless you want chat.** The reader SPA, `/mcp`, and
the atlas worker all work with just the step-3/4 variables.

Chat + auth ship **disabled** by default. Turning it on takes **two** switches:

- **`VITE_CHAT_ENABLED=1`** — a **build arg** baked into the Vite bundle at
  image build time. Set it via the Dockerfile build arg, not a runtime variable.
- **`CHAT_ENABLED=1`** — a **runtime** Railway variable that mounts the
  `/api/auth/*`, `/api/chat`, and `/api/usage` routes.

### 7a. Generate the JWT session secret → `CHAT_JWT_SECRET`

```bash
openssl rand -hex 32
```

### 7b. Create a GitHub OAuth app → `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

1. [github.com/settings/developers](https://github.com/settings/developers)
   → **OAuth Apps → New OAuth App**.
2. **Authorization callback URL:**
   `https://https://atlas.redline.support/api/auth/github/callback`
3. Copy the **Client ID** and generate a **Client secret**.

### 7c. Create a Google OAuth app → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

1. [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   → **Create Credentials → OAuth client ID**.
2. **Authorized redirect URI:**
   `https://https://atlas.redline.support/api/auth/google/callback`
3. Copy the **Client ID** and **Client secret**.

### 7d. Set the chat variables

```bash
railway variables --set 'VITE_CHAT_ENABLED=1'              --service redlens-atlas
railway variables --set 'CHAT_ENABLED=1'                   --service redlens-atlas
railway variables --set 'CHAT_JWT_SECRET=<from 7a>'        --service redlens-atlas
railway variables --set 'GITHUB_CLIENT_ID=<from 7b>'       --service redlens-atlas
railway variables --set 'GITHUB_CLIENT_SECRET=<from 7b>'   --service redlens-atlas
railway variables --set 'GOOGLE_CLIENT_ID=<from 7c>'       --service redlens-atlas
railway variables --set 'GOOGLE_CLIENT_SECRET=<from 7c>'   --service redlens-atlas
```

| Variable | Purpose |
|---|---|
| `VITE_CHAT_ENABLED` | Build arg — bakes the chat widget into the Vite bundle; Railway passes it to Docker automatically |
| `CHAT_ENABLED` | Runtime switch — mounts `/api/auth/*`, `/api/chat`, `/api/usage` routes |
| `CHAT_JWT_SECRET` | Signs session cookies |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |

*Setting `VITE_CHAT_ENABLED` triggers a full image rebuild so the bundle includes
the widget. If you later move to a custom domain, also set
`APP_URL=https://<custom-domain>` and update the provider callback URLs.*

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

Add these under repo **Settings → Environments → CI** (or as repo-level
secrets):

| Secret | Value |
|---|---|
| `ATLAS_BOT_APP_ID` | App ID from step 8b |
| `ATLAS_BOT_PRIVATE_KEY` | Full contents of the `.pem` from step 8b |

*`ETHERSCAN_API_KEY` and `ETH_RPC_URL` are no longer needed by this workflow —
the atlas-update run only calls `build:index` and `build:graph`, neither of
which hits Etherscan or an RPC endpoint. On-chain data (`addresses.json`,
`chain-state.json`) is refreshed separately.*

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
- **On-chain data** (`addresses.json`, `chain-state.json`) refreshes on its
  own cadence via `build:addresses` / `build:snapshot` — separate from the
  atlas loop and not automated by default.

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
→ `ATLAS_UPDATE_ENABLED` isn't set to `1` on the web service (step 3b), or
the worker isn't running (check its Deployments tab and logs).

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
→ Bundle built with the wrong base path. The Dockerfile sets
`RAILWAY_ENVIRONMENT=production` so Vite picks `/`; verify with
`curl https://<your-domain>/ | grep assets` (must show `/assets/…`, not
`/redlens/assets/…`).

**OAuth fails with a redirect-URI mismatch**
→ The callback URL registered with the provider must exactly match
`https://<your-domain>/api/auth/<provider>/callback`. On a custom domain set
`APP_URL` (step 7d) and re-check the provider config.

**"pnpm could not be found" / wrong start command**
→ Railway auto-detected the pnpm workspace and set its own start command,
overriding the Dockerfile CMD. The fix is already in `railway.toml`
(`startCommand = "bun run sync:atlas && bun run start"`), but if Railway
picked up a stale dashboard override first, clear it: service → **Settings →
Deploy → Start Command** → remove any custom value and redeploy.

**Build fails on git/python/submodule**
→ The builder must be `DOCKERFILE` (set in `railway.toml`); Nixpacks/Railpack
can't carry git + python3 + the atlas checkout needed at build time.
