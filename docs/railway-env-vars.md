# Railway Environment Variables

Quick reference — variable names and which service they go on. For the full step-by-step setup, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Web service

| Variable | Value | Required |
|----------|-------|----------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Yes |
| `OPENROUTER_API_KEY` | your key from openrouter.ai | For semantic search |
| `USERS_ENABLED` | `1` | For logins (profile, saved Collections) |
| `CHAT_ENABLED` | `1` | For chat (also needs `USERS_ENABLED=1`) |
| `CHAT_JWT_SECRET` | output of `openssl rand -hex 32` | For logins/chat |
| `GITHUB_CLIENT_ID` | from your GitHub OAuth App | For logins/chat |
| `GITHUB_CLIENT_SECRET` | from your GitHub OAuth App | For logins/chat |
| `GITHUB_TOKEN` | a PAT with public-repo read access | For Preview (PR/branch resolution + fork previews) |
| `GITHUB_APP_ID` | App ID from your GitHub App | For private atlas previews |
| `GITHUB_APP_PRIVATE_KEY` | the App's private key PEM, **base64-encoded** (`base64 -w0 key.pem`) | For private atlas previews |
| `PREVIEW_PRIVATE_DAILY_QUOTA` | `20` (default) | Optional — per-repo daily cap on new private-preview analyses |

Without `GITHUB_TOKEN` on the **web** service, `/preview` can still build canonical
branches, but PR/fork resolution is rate-limited or rejected — fork URLs come back as
`not-derived`. It's the same kind of token the worker uses; one PAT can serve both services.

`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` are a SEPARATE credential from the OAuth
app above — a GitHub App the *owner of a private atlas repo* installs, granting the
server Contents:read + Metadata:read on just that repo. Both must be set (alongside
`USERS_ENABLED=1` and GitHub login) to turn the private-preview feature on at all;
either one missing leaves it completely inert and public previews unaffected.
Railway splits a multi-line paste into one variable per line, so store the key as a
**single line**: base64-encode it (`base64 -w0 key.pem`) and paste that. The server
base64-decodes it (and also accepts `\n`-escaped, quoted, or space-collapsed PEMs)
before signing. See `docs/github-app-setup.md` §3 for the full recipe.

`CHAT_ENABLED` is AND-gated by `USERS_ENABLED` — chat requires a logged-in session, so enabling chat means setting **both** `USERS_ENABLED=1` and `CHAT_ENABLED=1` (plus the matching `VITE_USERS_ENABLED=1` / `VITE_CHAT_ENABLED=1` build args).

`USERS_ENABLED` further requires `CHAT_JWT_SECRET` to be set — without a secret to sign sessions the login surface stays **off** (routes 404, and the profile/Collections UI is hidden even if `VITE_USERS_ENABLED=1` was baked in). The server logs a loud warning at boot if `USERS_ENABLED` is set without the secret.

### Feedback (optional)

The `?` feedback button posts to `/api/feedback`, which is **on by default** and needs
only `DATABASE_URL` — set nothing here and it works. Every var below is an override;
the full list with defaults lives in `.env.example` and `src/server/config.ts`.

| Variable | Value | Required |
|----------|-------|----------|
| `FEEDBACK_ENABLED` | `0` to turn the endpoint off | No (defaults on) |
| `FEEDBACK_ANON_PER_HOUR` / `_PER_DAY` | `3` / `10` | No — anonymous rate limit |
| `FEEDBACK_USER_PER_HOUR` / `_PER_DAY` | `15` / `50` | No — signed-in rate limit |
| `FEEDBACK_GLOBAL_PER_DAY` | `500` | No — flood circuit breaker |
| `FEEDBACK_SURVEY_ID` | a PostHog survey uuid | For the PostHog Surveys mirror |
| `FEEDBACK_SURVEY_QUESTION_ID` | the question uuid inside that survey | No — see below |

Rate limits are keyed on the user id when signed in, otherwise on the random `rl_fb`
cookie minted on first submission — **never on IP**, because Railway's load balancer
collapses every client into a single address (the same limitation documented for
`/preview` in `docs/reviews/2026-07-09-deep-code-review.md`).

Setting `FEEDBACK_SURVEY_ID` makes the server forward each accepted submission to PostHog as
a `survey sent` event, so responses show up in the Surveys UI. It fires *after* validation and
rate limiting, so spam never reaches PostHog or burns the response quota. Requires
`POSTHOG_KEY` on the web service — that's the server-side client, distinct from the
build-time `VITE_POSTHOG_KEY`. Leave unset and Postgres is the only sink.

The survey uuid is visible in the survey's PostHog URL. `FEEDBACK_SURVEY_QUESTION_ID` is
**optional**: left empty, a single-question survey uses PostHog's legacy un-suffixed
`$survey_response` property; set it to key the answer by question id, which is required once
a survey has more than one question. PostHog doesn't surface the question uuid in its UI —
read it back with the public project key (the same endpoint posthog-js calls; the survey has
to be enabled):

```bash
curl -s "https://us.i.posthog.com/api/surveys/?token=<phc_project_key>" \
  | jq '.surveys[] | select(.id=="<survey-uuid>") | .questions[] | {id, question}'
```

## Atlas Worker service

| Variable | Value | Required |
|----------|-------|----------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Yes |
| `OPENROUTER_API_KEY` | same key as web service | For embeddings |
| `EMBED_GROUP_POLICY` | `one_to_one` (default) | Optional grouping for `atlas_doc_embeddings`. `icd_params` / `breadcrumbs` / `directory_direct` / `hub_stubs` / `kv_records_breadcrumbs` are bakeoff arms — run `pnpm eval:retrieval -- --backend openrouter` before switching. Default stays 1:1 until a neural win. **Eval-backed candidate:** `icd_params_breadcrumbs` with `EMBED_CRUMB_DEPTH` **left unset** (full ancestor chain). `EMBED_CRUMB_DEPTH` does not measurably matter: on the 2026-08-18 paraphrased query set, full chain and depth 2 score identically. An earlier run showed depth 2 losing badly; that was a query-set artifact and does not reproduce. Switching re-embeds ~206 anchors on the next `sync:embeddings` (incremental by `content_hash`). Note `content_hash` keys the *embed* text, which strips markdown links — so it is renumber- and link-target-stable by design, and is not a general change key. |
| `EMBED_CRUMB_DEPTH` | **unset** (full chain) | For `breadcrumbs` / `icd_params_breadcrumbs`: keep only the N nearest ancestors. Leave unset. No measurable effect either way on the rewritten query set — leave it unset. (ICD anchors carry only 2-5 non-generic ancestors, so most values barely truncate anything.) |
| `EMBED_CRUMB_ROOT` | unset (off) | Also keep the ROOT ancestor alongside the N nearest from `EMBED_CRUMB_DEPTH`. `kv_records_breadcrumbs` already defaults this on internally; this var is for evaluating root-keeping on the other breadcrumb policies. |
| `GITHUB_TOKEN` | a PAT with `repo:read` scope | For PR history data |

---

`DATABASE_URL` uses Railway's reference syntax — copy it exactly as written; Railway fills it in from your Postgres service.
