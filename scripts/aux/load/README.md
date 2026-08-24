# Load tests (connection / chat / OOM)

Off the `pnpm build` chain. Measures **three different limits** of the Railway
web singleton (`replicas: 1` — do not scale out). Target defaults to
`https://redlens-development.up.railway.app`.

There is no coded max-concurrent-chat gate. Chat is request-scoped SSE
(`POST /api/chat`); idle tabs hold `GET /api/atlas-events` instead.

## Abort criteria (all experiments)

Stop if any of these fire:

- `/api/health` error rate > 5%
- `/api/health` p95 > 2000 ms
- `rss_mb` ≥ 850 (85% of a 1 GB Railway slider; field ships on `/api/health`)

Do **not** OOM the shared development service. Use a throwaway clone (same 1 GB /
1 replica image) for a kill/restart drill.

## Prerequisites

- **k6** (optional): `https://grafana.com/docs/k6/latest/set-up/install-k6/`
- **Bun** (this repo's runner — no extra install)

Chat streams need a session cookie. Sign in on the site, copy `rl_session` from
devtools, then:

```bash
export CHAT_COOKIE='rl_session=...'
```

Several test users, or a raised `RATE_LIMIT_TOKENS_PER_WINDOW` on a throwaway
service, are required to saturate the **process** rather than one account's
500k / 120 min ledger. Commons credits (`commons_exhausted`) pause chat for
everyone — keep cheap-stream VUs low on the shared environment.

## Commands

Bun runner (what CI-less local/cloud agents should use):

```bash
bun scripts/aux/load/run.mjs health
bun scripts/aux/load/run.mjs sse          # STEPS=10,25,50,100,150,250 HOLD_MS=45000
bun scripts/aux/load/run.mjs rps          # short-lived GET /  (not connection holds)
bun scripts/aux/load/run.mjs chat         # needs CHAT_COOKIE; otherwise 401 probe
bun scripts/aux/load/run.mjs chat-unauth  # concurrent 401s — auth gate cost
bun scripts/aux/load/run.mjs oom-headroom # moderate SSE hold; records RSS; no force-kill
```

k6 (same abort thresholds):

```bash
k6 run -e BASE=https://redlens-development.up.railway.app scripts/aux/load/sse-hold.js
k6 run -e BASE=https://redlens-development.up.railway.app scripts/aux/load/http-rps.js
k6 run -e BASE=... -e CHAT_COOKIE='rl_session=...' scripts/aux/load/chat.js
k6 run -e MODE=realistic -e VUS=5 -e CHAT_COOKIE='...' scripts/aux/load/chat.js
```

Write JSON with `OUT=/tmp/load-sse.json`.

`/api/health` always returns HTTP 200 while the process is up. After this change
the body also includes:

- `rss_mb` — `process.memoryUsage().rss` in MiB (liveness stays 200 even if large)
- `sse_clients` — live `/api/atlas-events` registrations

Until that deploy is live, RSS abort falls back to health latency / error rate.

## What OOM looks like (no in-app handler)

1. Kernel / Railway kills the container when RSS exceeds the Settings memory slider.
2. `/api/health` fails → platform marks the replica unhealthy.
3. `restartPolicyType = ON_FAILURE`, `restartPolicyMaxRetries = 3` ([railway.toml](../../../railway.toml)).
4. In-flight chat SSE and atlas EventSource streams drop.
5. New boot serves baked `dist/` artifacts, then the in-process updater hot-swaps from Postgres.
6. After three failed restarts the replica stays down until a new deploy.

Do not ship a memory bomb to force this on development. If natural load will not
reach the cap, report headroom.

## Results (2026-08-24, development singleton)

Filled in after the measurement run in this PR.
