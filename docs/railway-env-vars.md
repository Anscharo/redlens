# Railway Environment Variables

Quick reference — variable names and which service they go on. For the full step-by-step setup, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Web service

| Variable | Value | Required |
|----------|-------|----------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Yes |
| `OPENROUTER_API_KEY` | your key from openrouter.ai | For semantic search |
| `CHAT_ENABLED` | `1` | Only if using chat |
| `CHAT_JWT_SECRET` | output of `openssl rand -hex 32` | Only if using chat |
| `GITHUB_CLIENT_ID` | from your GitHub OAuth App | Only if using chat |
| `GITHUB_CLIENT_SECRET` | from your GitHub OAuth App | Only if using chat |

## Atlas Worker service

| Variable | Value | Required |
|----------|-------|----------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Yes |
| `OPENROUTER_API_KEY` | same key as web service | For embeddings |
| `GITHUB_TOKEN` | a PAT with `repo:read` scope | For PR history data |

---

`DATABASE_URL` uses Railway's reference syntax — copy it exactly as written; Railway fills it in from your Postgres service.
