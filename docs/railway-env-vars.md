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

`CHAT_ENABLED` is AND-gated by `USERS_ENABLED` — chat requires a logged-in session, so enabling chat means setting **both** `USERS_ENABLED=1` and `CHAT_ENABLED=1` (plus the matching `VITE_USERS_ENABLED=1` / `VITE_CHAT_ENABLED=1` build args).

`USERS_ENABLED` further requires `CHAT_JWT_SECRET` to be set — without a secret to sign sessions the login surface stays **off** (routes 404, and the profile/Collections UI is hidden even if `VITE_USERS_ENABLED=1` was baked in). The server logs a loud warning at boot if `USERS_ENABLED` is set without the secret.

## Atlas Worker service

| Variable | Value | Required |
|----------|-------|----------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Yes |
| `OPENROUTER_API_KEY` | same key as web service | For embeddings |
| `GITHUB_TOKEN` | a PAT with `repo:read` scope | For PR history data |

---

`DATABASE_URL` uses Railway's reference syntax — copy it exactly as written; Railway fills it in from your Postgres service.
