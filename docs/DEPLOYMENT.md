# RedLens Deployment Runbook

Stand up the full RedLens app (reader SPA + MCP endpoint + chat/OAuth + live
atlas updates). Follow the steps in order.

Deployment has **two parts**: **Railway** hosts the app (Part 1), and **GitHub**
runs the hourly atlas-update workflow that keeps the repo's artifacts and history
current (Part 2). Both are required.

For what this service *is* and how it differs from the GitHub Pages static
reader, see the [Deployment section of the README](../README.md#deployment).

---

# Part 1 — Railway (the app)

## 1. Prerequisites

Before you start, make sure you have:

1. **A GitHub account** with **admin** access to this repo *(you'll connect it to
   Railway here, and install a bot in Part 2).*
2. **A Railway account** — sign up at [railway.com](https://railway.com).
3. **The Railway CLI**, logged in:
   ```bash
   npm i -g @railway/cli   # or: brew install railway
   railway login
   ```
4. **An OpenRouter account** with credits — required for semantic search
   embeddings (and chat, if you enable it). Setup in step 3a.

## 2. Create the project, service, and database

a. **Create the project from this GitHub repo.** Go to
   [railway.com/new](https://railway.com/new) → **Deploy from GitHub repo**.
   Authorize the Railway GitHub App for this repository if prompted, then select
   it. Railway creates a **web service that auto-deploys on every push to
   `main`**. This runbook calls the service `redline-atlas`.

b. **Add managed Postgres.** On the project canvas: **New → Database → Add
   PostgreSQL**. *Railway's managed Postgres already includes `pgvector`, so no
   special image is needed — the first migration runs `CREATE EXTENSION IF NOT
   EXISTS vector` itself.*

c. **Link the CLI to the project** so the next steps can set variables. From the
   repo root, pick the project + environment when prompted:
   ```bash
   railway link
   ```

d. **Wire `DATABASE_URL` to Postgres** with a reference variable:
   ```bash
   railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --service redline-atlas
   ```
   *This is the single most common failure — Railway does **not** auto-inject the
   database URL. If your Postgres service has a non-default name, match it:
   `${{<ServiceName>.DATABASE_URL}}`. Skipping this makes the container crash-loop
   on `ERR_POSTGRES_CONNECTION_CLOSED`.*

## 3. Set the required environment variables

`PORT` is injected by Railway automatically.

### 3a. Get an OpenRouter API key

1. Go to [openrouter.ai](https://openrouter.ai) and sign in.
2. Add credits: **Settings → Credits → Add Credits** *(embeddings and chat both
   draw from this balance).*
3. Go to [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) →
   **Create Key** → copy the value *(it starts with `sk-or-`)*.

### 3b. Set the variables

```bash
railway variables --set 'OPENROUTER_API_KEY=sk-or-...' --service redline-atlas
railway variables --set 'ATLAS_UPDATE_ENABLED=1'       --service redline-atlas
```

| Variable | Value | Source |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Set in step 2d |
| `OPENROUTER_API_KEY` | `sk-or-…` | OpenRouter, step 3a |
| `ATLAS_UPDATE_ENABLED` | `1` | Enables the in-process atlas updater |

*You can also set these in the dashboard under the web service → **Variables**
tab instead of the CLI.*

## 4. Configure the service and deploy

a. **Service settings** (web service → **Settings**):
   - **Memory:** ~1 GB RAM.
   - **Replicas:** **1** *(the in-process updater is single-container by
     design — do not scale out).*

b. **Generate the public URL.** Web service → **Settings → Networking →
   Generate Domain**. Note the domain *(e.g.
   `redline-atlas-production.up.railway.app`)* — you'll need it for OAuth in
   step 6.

c. **Deploy.** Railway redeploys automatically whenever you push to `main` or
   change a variable. To deploy now, either push to `main` or open the service's
   **Deployments** tab and click **Deploy**.

   *The Docker build clones the atlas (`--branch main`), runs the atlas's
   `sync/compose.py` to synthesize `Sky Atlas.md`, and builds all artifacts. The
   start command waits for Postgres, runs migrations + sync, serves, kicks off
   embeddings in the background, and starts the updater.*

## 5. Verify

a. **Health check:**
   ```bash
   curl https://<your-domain>/health
   # → { "status": "ok", "atlas_sha": "...", "docs": N }
   ```

b. **Boot logs** — `railway logs --service redline-atlas` (or the service's
   **Deployments → View Logs**). Look for `db: connected …`, `sync:atlas — done`,
   and `listening on :8080`.

c. **Open the site** in a browser. Search works immediately (lexical). Semantic
   search fills in once embeddings finish in the background *(the first run
   embeds the whole atlas and takes a few minutes).*

d. **Atlas auto-update:** when upstream advances, the logs show
   `atlas-updater: … updated → live now <sha>` and `/health.atlas_sha` advances
   with no redeploy.

## 6. (Optional) Enable chat login — GitHub and Google OAuth

**Skip this whole section unless you want chat.** None of the variables it
introduces — `CHAT_ENABLED`, `CHAT_JWT_SECRET`, and the GitHub/Google OAuth
credentials — are needed to run RedLens. The reader SPA, `/mcp`, and the atlas
updater all work with just the step-3 variables; leave the chat vars unset and
nothing breaks. Only come back here when you actually want to turn chat on.

When you do, chat + auth ship **disabled** by default — the merged image exposes
no chat UI and no `/api/auth` · `/api/chat` · `/api/usage` routes until you opt
in. Turning it on takes **two** switches, because the UI flag is baked into the
bundle at build time while the routes are gated at runtime:

- **`VITE_CHAT_ENABLED=1`** — a **build arg** (`--build-arg VITE_CHAT_ENABLED=1`,
  wired through the Dockerfile). Runtime Railway variables can't reach the Vite
  build, so this must be set when the image is built, or the widget + profile
  button stay out of the bundle.
- **`CHAT_ENABLED=1`** — a **runtime** Railway variable that mounts the
  `/api/auth/*`, `/api/chat`, and `/api/usage` routes.

Leave either off and that half stays dark; both can flip independently without
breaking the static SPA or `/mcp`. The OAuth variables below only matter once
`CHAT_ENABLED=1`. You can enable GitHub, Google, or both. All callback URLs use
the domain from step 4b.

### 6a. Generate the JWT session secret

```bash
openssl rand -hex 32
```
Keep the output for `CHAT_JWT_SECRET` below.

### 6b. Create a GitHub OAuth app

1. Go to [github.com/settings/developers](https://github.com/settings/developers)
   → **OAuth Apps** → **New OAuth App** *(or an org's Settings → Developer
   settings → OAuth Apps).*
2. Fill in:
   - **Application name:** anything, e.g. `RedLens Atlas`.
   - **Homepage URL:** `https://<your-domain>`.
   - **Authorization callback URL:** `https://<your-domain>/api/auth/github/callback`.
3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy it *(shown only once).*

### 6c. Create a Google OAuth app

1. Go to the [Google Cloud Console](https://console.cloud.google.com) and select
   or create a project.
2. **APIs & Services → OAuth consent screen:** choose **External**, set an app
   name and support email, and save. *(While the app is in "Testing", add your
   own Google account under **Test users** or sign-in will be refused.)*
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - **Application type:** Web application.
   - **Authorized redirect URIs → Add URI:**
     `https://<your-domain>/api/auth/google/callback`
     *(add `http://localhost:3000/api/auth/google/callback` too if you want
     local login).*
4. Click **Create** and copy the **Client ID** and **Client secret**.

### 6d. Set the chat variables

```bash
# Mount the routes (without this the OAuth vars below are inert):
railway variables --set 'CHAT_ENABLED=1'                   --service redline-atlas
railway variables --set 'CHAT_JWT_SECRET=<from 6a>'        --service redline-atlas
# GitHub login:
railway variables --set 'GITHUB_CLIENT_ID=<from 6b>'       --service redline-atlas
railway variables --set 'GITHUB_CLIENT_SECRET=<from 6b>'   --service redline-atlas
# Google login:
railway variables --set 'GOOGLE_CLIENT_ID=<from 6c>'       --service redline-atlas
railway variables --set 'GOOGLE_CLIENT_SECRET=<from 6c>'   --service redline-atlas
```

*`CHAT_ENABLED=1` mounts the API; `CHAT_JWT_SECRET` is required for any login.
Add only the GitHub vars, only the Google vars, or both. Setting a variable
triggers a redeploy.* **Also rebuild the image with `--build-arg
VITE_CHAT_ENABLED=1`** so the widget is in the bundle — runtime vars alone won't
surface the UI.

*If you later move to a custom domain, set `APP_URL=https://<custom-domain>` so
the OAuth redirect URIs match, and update the callback URLs in steps 6b/6c.*

---

# Part 2 — GitHub (atlas-update workflow)

`.github/workflows/atlas-update.yml` runs hourly on this repo. It pulls the atlas
submodule, rebuilds all artifacts **including `history/*.json`**, opens a PR, and
auto-merges it — and the merge to `main` is what Railway auto-deploys.

*The in-process updater (Part 1) keeps the running atlas text fresh between
deploys but does not refresh history — so this workflow is what keeps the history
view current. Leave it enabled.*

## 7. Install the bot (GitHub App)

The workflow commits, opens a PR, and merges it **without waiting for CI** — which
the default `GITHUB_TOKEN` cannot do under branch protection. So it runs as a
**GitHub App ("bot")** that you install on this repo. Do this once:

a. **Create the App:** [github.com/settings/apps](https://github.com/settings/apps)
   → **New GitHub App**. Under **Repository permissions** grant:
   - **Contents:** Read & write
   - **Pull requests:** Read & write
   - **Issues:** Read & write

b. **Generate a private key:** on the App's page → **Private keys → Generate a
   private key** → a `.pem` file downloads. Note the App's numeric **App ID** too.

c. **Install the App on this repo:** App page → **Install App** → select this repo.

d. **Make the bot a branch-protection bypass actor** so it can auto-merge: repo
   **Settings → Branches →** the `main` rule **→ Allow specified actors to bypass
   required pull requests →** add the App.

## 8. Add the workflow secrets

The workflow reads its `environment: CI`, so add these under repo **Settings →
Environments → CI** *(or as repo-level secrets)*:

| Secret | Value |
|---|---|
| `ATLAS_BOT_APP_ID` | the App ID from step 7b |
| `ATLAS_BOT_PRIVATE_KEY` | full contents of the `.pem` from step 7b |
| `ETHERSCAN_API_KEY` | [etherscan.io/apidashboard](https://etherscan.io/apidashboard) *(artifact build)* |
| `ETH_RPC_URL` | an Ethereum RPC URL *(artifact build)* |

---

## Ongoing operation

- **Atlas text** refreshes automatically (~5 min after an upstream commit), no
  redeploy.
- **History** stays current via the atlas-update workflow's merges (Part 2).
- **On-chain data** (`addresses.json`, `chain-state.json`) refreshes on its own
  cadence via `build:addresses` / `build:snapshot` *(needs Etherscan / RPC keys;
  not part of the atlas loop).*

## Troubleshooting

- **Container crash-loops on `ERR_POSTGRES_CONNECTION_CLOSED`** — `DATABASE_URL`
  isn't wired. Re-check step 2d.
- **Semantic search returns nothing** — `OPENROUTER_API_KEY` is missing or out of
  credits; lexical search still works. Check the key and your OpenRouter balance.
- **Atlas never updates without a redeploy** — `ATLAS_UPDATE_ENABLED` isn't set
  to `1` (step 3b).
- **atlas-update PRs open but never merge** — the bot isn't a branch-protection
  bypass actor (step 7d), or the `ATLAS_BOT_*` secrets are missing (step 8).
- **Blank page / "module script MIME type" errors** — the bundle built with the
  wrong base path. The Dockerfile sets `RAILWAY_ENVIRONMENT=production` so
  `vite.config.ts` picks `/`; verify with
  `curl https://<your-domain>/ | grep assets` *(must reference `/assets/…`, not
  `/redlens/assets/…`).*
- **OAuth fails with a redirect-URI mismatch** — the callback URL registered with
  the provider must exactly match `https://<your-domain>/api/auth/<provider>/callback`.
  On a custom domain, set `APP_URL` (step 6d) and re-check the provider config.
- **Build fails on git/python/submodule** — the builder must be `DOCKERFILE`
  (set in `railway.toml`); Nixpacks/Railpack can't carry git + python3 + the
  atlas checkout the runtime updater needs.
