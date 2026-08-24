# Load tests (connection / chat / OOM)

Off the `pnpm build` chain. Measures **three different limits** of the Railway
web singleton (`replicas: 1` — do not scale out). Target defaults to
`https://redlens-development.up.railway.app`.

Chat is request-scoped SSE (`POST /api/chat`); idle tabs hold
`GET /api/atlas-events` instead. `POST /api/chat` enforces a max-concurrent
gate per user (`chat/concurrency.ts`, `CHAT_MAX_CONCURRENT_PER_USER`, default
3) ahead of the token-window/commons checks — see `docs/chat-system.md`.

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

Chat streams need a session cookie. Sign in on the site, copy `sky_session` from
devtools (Application → Cookies; it is HttpOnly so you need the Storage panel,
not `document.cookie`), then:

```bash
export CHAT_COOKIE='sky_session=...'
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

k6 (same abort thresholds — health error rate / p95, plus `rss_over_abort` rate==0
so the first `rss_mb ≥ RSS_ABORT_MB` sample stops the run):

```bash
k6 run -e BASE=https://redlens-development.up.railway.app scripts/aux/load/sse-hold.js
k6 run -e BASE=https://redlens-development.up.railway.app scripts/aux/load/http-rps.js
k6 run -e BASE=... -e CHAT_COOKIE='sky_session=...' scripts/aux/load/chat.js
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

Target: `https://redlens-development.up.railway.app`. One Bun replica. Health
body at the time of the run did **not** yet include `rss_mb` / `sse_clients`
(this PR). Railway memory slider was not readable from this agent (no Railway
CLI); runbook documents **~1 GB**. `replicas` must stay **1**.

Idle health: HTTP 200, ~150–200 ms, `docs: 11349`, `status: ok`.

### Idle SSE holds (`GET /api/atlas-events`)

From one client IP, Bun `fetch` (HTTP/2 multiplex possible):

| Concurrent holds | Result | Health p95 |
|---|---|---|
| 50 | 50/50 ok + heartbeat | 114 ms |
| 100 | 100/100 ok + heartbeat | 141 ms |
| 250 | 250/250 ok + heartbeat | 105 ms |
| 275 | 103/275 ok | **36 s** (abort) |
| 300 | 0/300 ok | **36 s** (abort) |
| 350 | 0/350 ok | **39 s** (abort) |

**Last green: 250. First red: 275.** Stay under **~200** idle atlas-events
tabs on this replica (margin under 250).

After the 275+ ramps, new `GET /api/atlas-events` from the same client timed
out with **0 bytes**, while `/api/health` and `GET /` stayed ~90–170 ms. Likely
mix of Railway edge / per-IP long-lived stream limits and in-process SSE
clients kept alive by the 30 s `:ping` heartbeat (aborted clients may not
evict until `enqueue` throws). A **web-service restart** drains them. This is
the first failure mode — **not** OOM.

A 500-hold step without a fetch timeout hung the client ~16 min and drove
health p95 to hundreds of seconds; the runner now uses `AbortSignal.timeout`.

Same-day reconfirm (still one client IP; app_commit had moved to `005cda1c`):
a cold-ish **50** then **80** hold both succeeded (health p95 ~100–140 ms).
Jumping to 150, or any follow-up 90/100/50 from the same IP, failed 100%
while health stayed ~140 ms. The edge appears to **pin this IP’s long-lived
streams** after a successful burst; a web-service restart is required before
the next SSE ladder. Do not treat 80 as a new replica-wide ceiling — 250
was measured on a colder start.

### Short-lived `GET /` (not connection count)

| Target RPS | ok / fail | p95 |
|---|---|---|
| 10 | 150 / 0 | 100 ms |
| 20 | 300 / 0 | 95 ms |
| 50 | 745 / 0 | 95 ms |
| 100 | 1482 / 0 | 95 ms |

Homepage RPS is easy well past 100/s. Do not confuse this with idle tab
capacity.

### Chat

No `CHAT_COOKIE` in this environment — authenticated streams were **not**
saturated (would burn OpenRouter commons). Unauthenticated `POST /api/chat`:

- 20 concurrent → all **401** `unauthenticated`, ~180 ms
- 50 concurrent → all **401**, health still ~90 ms

The auth gate is cheap. This run predates the per-user max-concurrent gate
(`chat/concurrency.ts`, default 3) added since — real limits below that cap
are the per-user 500k tokens / 120 min window, `commons_exhausted`,
OpenRouter, and process CPU/RAM of verifier slices. Re-run
`bun scripts/aux/load/run.mjs chat` with several test cookies on a throwaway
service to measure authenticated SSE against the new gate.

### OOM

Not reached. The singleton kept serving health and static after SSE
saturation, so **connection/edge limits hit first**. Force-kill skipped on
shared development.

When RSS does exceed the Railway slider: kernel kill → `/api/health` down →
`ON_FAILURE` restart (max 3) → in-flight SSE/chat drop → boot baked `dist/`
then hot-swap from Postgres. No in-app OOM page. After `rss_mb` is deployed,
re-run `oom-headroom` and abort at 850 MiB.

### Operating recommendation

- Do **not** raise replicas.
- Budget **≤ 200** idle browser tabs (atlas-events) per replica.
- Homepage traffic is not the scarce resource.
- Treat chat concurrency as an OpenRouter / token-ledger problem until a
  cookie-backed run says otherwise.
- Consider a server-side cap on `/api/atlas-events` registrations so a hung
  client cannot pin heartbeat-kept streams past the measured 250.
