# GitHub App setup — private atlas previews

The private-preview feature (`docs/plans/private-previews.md`) needs a **new,
dedicated GitHub App**. It is *not* the existing OAuth login app and cannot be —
only a GitHub App can be installed on a repository and mint installation tokens.
It is used **server-to-server only**: it never touches the login flow, and a
viewer never authorizes it.

Until `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set, the feature is
completely inert (`config.privatePreviewsEnabled === false`) and public previews
behave exactly as before.

---

## 1. What the App must be able to do (and nothing more)

The server makes exactly these calls, so this is the whole permission surface:

| Call | Credential | Needs |
|---|---|---|
| `GET /repos/{repo}/installation` (is the App on this repo?) | App JWT | app-level, no repo permission |
| `POST /app/installations/{id}/access_tokens` (mint token) | App JWT | app-level |
| `GET /repos/{repo}` (private? metadata) | installation token | **Metadata: read** |
| `GET /repos/{repo}/collaborators/{login}/permission` (access check) | installation token | **Metadata: read** |
| `GET /repos/{repo}/branches/{ref}` (resolve the branch tip) | installation token | **Contents: read** |
| `GET /repos/{repo}/tarball/{sha}` (download the private atlas) | installation token | **Contents: read** |

So the App needs exactly two **Repository permissions**:

- **Contents → Read-only**
- **Metadata → Read-only** (GitHub auto-selects this; it's what the
  collaborator-permission endpoint requires, and that endpoint returns the
  *effective, highest* access across repo/team/org/enterprise, so org- and
  team-granted access is honored)

**No** Account permissions, **no** Organization permissions, **no** write
scopes, **no** webhooks, **no** user-authorization/OAuth. If a screen asks for
more, you've selected too much.

---

## 2. Registering the App (step by step)

Create it under the account that will run RedLens (a personal account is fine,
or the org that owns the deployment). GitHub → **Settings → Developer settings →
GitHub Apps → New GitHub App**.

1. **GitHub App name** — anything recognizable, e.g. `RedLens Private Previews`.
   (The name becomes the public install URL slug — see §4.)
2. **Homepage URL** — your RedLens URL (e.g. `https://<your-app>.up.railway.app`).
3. **Identifying and authorizing users** — leave **"Request user authorization
   (OAuth) during installation" UNCHECKED.** Viewers authenticate with the
   existing OAuth login app; this App never authorizes a user. Leave **Callback
   URL** blank.
4. **Post installation → Setup URL** — optional. You may set it to
   `https://<your-app>/preview` so an owner lands back on RedLens after
   installing; not required.
5. **Webhook** — **uncheck "Active".** The server polls on demand; there is no
   webhook handler. Leave Webhook URL and secret blank.
6. **Repository permissions** — set **Contents: Read-only** and confirm
   **Metadata: Read-only** is selected. Leave everything else at *No access*.
7. **Organization / Account permissions** — leave all at *No access*.
8. **Subscribe to events** — none.
9. **Where can this App be installed?**
   - **"Only on this account"** if every private atlas repo lives under the same
     account as the App. Simplest; keeps the App private.
   - **"Any account"** if owners in *other* orgs/users must be able to install it
     on their own private repos. This makes the App public (installable by
     others) but grants nothing until someone installs it.
   Pick based on who owns the private repos you want to preview.
10. **Create GitHub App.**

Then, on the App's page:

11. Note the **App ID** (top of the page) → this is `GITHUB_APP_ID`.
12. **Private keys → Generate a private key.** A `.pem` downloads. Its full
    contents (including the `-----BEGIN … PRIVATE KEY-----` lines) are
    `GITHUB_APP_PRIVATE_KEY`. GitHub issues these in PKCS#1 form
    (`BEGIN RSA PRIVATE KEY`); the server signs with `node:crypto`, which accepts
    that as-is — **no conversion needed.**

---

## 3. Configure RedLens (env vars)

Set these on the server (Railway → the web service → Variables, or your local
`.env`). Also documented in `docs/railway-env-vars.md`.

| Variable | Value |
|---|---|
| `GITHUB_APP_ID` | the numeric App ID from §2.11 |
| `GITHUB_APP_PRIVATE_KEY` | the PEM from §2.12 — **base64-encoded** (see below) |
| `PREVIEW_PRIVATE_DAILY_QUOTA` | *(optional)* max new private-preview builds per repo per UTC day (default `20`) |

Notes on the PEM:

- **Railway splits a multi-line paste into one variable per line**, which mangles
  the PEM. Give it a **single-line** value instead. The most reliable single-line
  form is base64 — no quotes, escapes, or newlines to mangle:

  ```bash
  base64 -w0 your-app-name.private-key.pem   # Linux
  base64 -i  your-app-name.private-key.pem | tr -d '\n'   # macOS
  ```

  Paste that one line as `GITHUB_APP_PRIVATE_KEY`. The server base64-decodes it
  back to the PEM before signing.
- Other single-line forms also work (the server normalizes all of them): the PEM
  with literal `\n` escapes, wrapped in quotes, or with newlines collapsed to
  spaces. A genuinely multi-line value works too where the env store preserves it
  (e.g. a local `.env`, or Railway's **Raw Editor**). Base64 is just the one form
  nothing downstream can break.
- Treat it as a secret. Rotating it later = generate a new private key on the
  App page, swap the env var, delete the old key.

Prerequisites already covered by the existing login setup (the feature's master
gate `privatePreviewsEnabled` also requires them): `USERS_ENABLED=1`,
`CHAT_JWT_SECRET`, and GitHub OAuth (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`).
Redeploy after setting the variables.

---

## 4. Installing the App on a private repo (what repo owners do)

Each private atlas repo's **owner or an admin** installs the App on that repo —
this is the *one* permission event in the whole system, and it's separate from
any login:

1. Open the App's install page:
   - Owner-only App: GitHub → the account → **Settings → GitHub Apps → your App →
     Install**, or `https://github.com/apps/<app-slug>/installations/new`.
   - Public App: `https://github.com/apps/<app-slug>` → **Install**.
2. Choose **"Only select repositories"** and pick the private atlas repo(s).
   (Granting all repos also works but is broader than needed.)
3. Install.

RedLens surfaces this: if someone opens a private preview for a repo the App
isn't on yet, the UI shows an **"install the app"** screen. Viewers never do this
— only the repo owner, once per repo.

---

## 5. How a viewer's access is decided (for reference)

When a signed-in GitHub user opens `/preview/<owner>:<repo>:<branch>` for a
private repo, the server calls
`GET /repos/{repo}/collaborators/{their-login}/permission` with the installation
token and grants the preview **only** when GitHub returns a real permission
(`read`/`write`/`admin`) **and** the response's numeric user id matches the
account they're signed in as. A `404` ("not a collaborator"), `permission:
"none"`, or any error **denies**. So access to the RedLens preview always tracks
GitHub's own answer to "can this account read this repo?".

---

## 6. Verifying it works

1. Confirm the server logs `privatePreviewsEnabled` as true after redeploy (or
   that a private preview no longer returns `app-not-installed` for an installed
   repo).
2. As a **collaborator** on the test private repo, signed in with GitHub, open
   `/preview/<owner>:<repo>:<branch>` → it should build and render with a
   **PRIVATE** banner.
3. Signed out → a "sign in with GitHub" screen; signed in as a **non-collaborator**
   → "you don't have access".
4. A repo the App isn't installed on → the "install the app" screen.
5. Direct-hit `/api/preview/<sha>/docs.json` for a private bundle without an
   authorized session → `401`/`403`, never the content.
