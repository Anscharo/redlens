# Private atlas previews

Extends the atlas **preview** feature (`docs/plans/preview.md`, `src/server/preview/*`)
to render **private** atlas repos, gated so that **no visitor sees a private preview
unless GitHub confirms that same account currently has read access to the underlying
repo.**

## Why this is not just "flip a flag on the fork path"

The public preview path is entirely unauthenticated; its only screen is *fork lineage*
(the repo must be a true GitHub fork of `sky-ecosystem/next-gen-atlas`). A private atlas
repo **cannot be a true fork** of a public one, so it fails that screen, and its tarball
is unreadable with the shared service token. Two things are therefore new:

1. **A repo-scoped credential** that can read the private tarball and answer "does user X
   have access to this repo?" — a **GitHub App** installed on the repo by its owner, whose
   short-lived **installation tokens** do both jobs.
2. **A per-visitor authorization gate** in the preview HTTP path — the first authorization
   concept the preview feature has ever had.

The redline itself needs no GitHub compare API: private previews use the existing local
`diffDocs` content diff against live main (the same fallback branch/sha previews already
use), which works on shared-but-unmergeable history.

## Auth model — one mandatory app, login untouched

Two GitHub credentials, cleanly separated:

- **Existing OAuth App** — unchanged. Identifies the visitor (their GitHub login). Its
  scopes stay `read:user, user:email` — **never `repo`**. Ordinary login stays featherweight.
- **New GitHub App** — server-to-server only (App ID + private key → installation token).
  Reads the private tarball *and* runs the collaborator-permission check. It is **never
  wired into a login flow** — the only human action against it is the repo owner's one-time
  install.

Three permission tiers, and only one of them ever prompts anyone:

| Action | Who | Grant |
|---|---|---|
| General login (chat, collections, viewing) | any visitor | OAuth App, no repo scope |
| Grant repo access | repo **owner/admin** | installs the GitHub App on that repo (once) |
| View a private preview | any authorized visitor | **nothing** — server checks with the installation token |

**Single login, no re-auth (design invariant).** A viewer authenticates exactly once, with
the ordinary GitHub login, and never authorizes the GitHub App or re-auths for a private
preview. This is guaranteed by using the *installation-token* permission check (server-side)
rather than a user-to-server token — do not swap that out without accepting a second viewer
authorization.

## The security invariant

> A user views a private preview **only if** GitHub confirms that same user — matched by
> immutable numeric account id — currently has read access to that repo. Security never
> depends on the bundle sha being secret, and **every uncertain outcome denies (fail closed).**

Gaps found in review (all closed in the implementation):

- **G1 — mid-build leak.** Artifact files exist on disk *before* `meta.json`/the DB row are
  written. Privacy is therefore a property of `meta.json`, and **all** sha-keyed responses
  gate on `bundleReady(sha)` (which requires `meta.json`) before serving — so a private
  `docs.json` cannot leak during the build tail.
- **G2 — fail-open row read.** The privacy flag is read from `meta.json`, not a
  `getPreviewRow(...).catch(()=>null)` that treats "no row" as public.
- **G3 — event ordering.** `/events` authorizes *before* any sha-bearing event, build
  trigger, or subscription.
- **G4 — identity binding.** The permission response's numeric `user.id` must match the
  session's stored `provider_id`; logins are re-claimable after a rename, so we never trust
  the login string alone.
- **G5 — visibility flips.** Build-time privacy is a snapshot; the sweeper / event
  re-resolve re-checks non-canonical repo visibility and flips public→private (the reverse is
  safe).
- **G6 — caching headers.** Private responses carry `Cache-Control: private, no-store` and
  drop `access-control-allow-origin: *` (noindex alone is SEO-only; a shared CDN could serve
  one user's private docs to the next).
- **G7 — response-shape oracle.** Anonymous non-public outcomes collapse to a single
  `auth-required` so an unauthenticated caller can't confirm a specific private repo exists.
- **G8 — negative caching.** The access decision is cached briefly (~60 s) keyed on
  `(userId, repo)`, caching denials too so a forbidden refresher can't drain the
  installation-token rate budget. Accepted bound: a revoked user keeps access ≤ the TTL.

## Implementation map

| Concern | File |
|---|---|
| GitHub App JWT / installation token / permission check | `src/server/preview/github-app.ts` (new) |
| Per-visitor access gate (`authorizePreviewAccess`) | `src/server/preview/access.ts` (new) |
| Config gate `privatePreviewsEnabled` + app env | `src/server/config.ts` |
| Persist `github_login`; refresh every login | `src/server/auth.ts` |
| Privacy sequencing, `Resolved.private`, `app-not-installed` | `src/server/preview/resolve.ts` |
| Private tarball via the API endpoint | `src/server/preview/tarball.ts` |
| Skip fork/trust + compare gates; write `private`; per-repo quota | `src/server/preview/build.ts` |
| `PreviewMeta.private` | `src/server/preview/cache.ts` |
| `previews.private`; exclude private from `/list`; `ON CONFLICT` | `src/server/preview/db.ts` |
| Three fail-closed enforcement points + private headers | `src/server/preview/handler.ts` |
| `auth-required` / `forbidden` / `app-not-installed` screens; PRIVATE chip | `src/components/preview/*` |
| Columns `users.github_login`, `previews.private` | `src/server/migrations/018_private_previews.sql` |

### The GitHub App permission check

`GET /repos/{repo}/collaborators/{login}/permission` with an installation token returns the
**effective, highest** permission across repo / team / org / enterprise, so org- and
team-granted access is honored. Grant only on HTTP 200 with `permission ∈ {read, write,
admin}` and a numeric `user.id`; **deny on 404 *and* on `permission:"none"`** (both are valid
no-access shapes); deny on anything else. Needs only **Metadata: read** (auto-granted to every
installation) — our Contents+Metadata grant is more than enough. Rate limit ≥ 5,000/hr.

## Accepted losses for private previews

- No `patches.json` and no renumber/identity-swap detection (the PR-diff path is skipped for
  the local `diffDocs`); redlines are added/changed markers only.
- `pr-state.ts` never touches private rows (no `pr_number`) — no banner state flips.
- A revoked collaborator retains access for up to the ~60 s access-cache TTL.

## Rollout

The feature is inert until the GitHub App is registered and `GITHUB_APP_ID` +
`GITHUB_APP_PRIVATE_KEY` are set (`privatePreviewsEnabled`). Migration `018` is additive and
safe to ship ahead of that. Public previews are entirely unaffected on every path.

**Registering + installing the App:** see `docs/github-app-setup.md` for the step-by-step
runbook (exact permissions — Contents:read + Metadata:read only — settings, env vars, and how
repo owners install it).

## Verification

See the plan's end-to-end checklist: unit suites (`github-app`, `access`, handler private
gate incl. the **G1 mid-build** case), public previews unaffected, private happy path,
access-denied (logged out / non-collaborator / direct sha hit), app-not-installed, and the
header/`/list`-exclusion manual checks.
