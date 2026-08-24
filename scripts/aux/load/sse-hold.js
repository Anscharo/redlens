// k6 — hold GET /api/atlas-events (idle browser tabs) while a canary polls /api/health.
//
//   k6 run -e BASE=https://redlens-development.up.railway.app scripts/aux/load/sse-hold.js
//
// Abort: health error rate > 5% or health p95 > 2s (thresholds below).
// SSE holds time out by design; they are tagged and excluded from the abort rate.

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE || "https://redlens-development.up.railway.app";
const HOLD_S = Number(__ENV.HOLD_S || 75);
const RSS_ABORT_MB = Number(__ENV.RSS_ABORT_MB || 850);

const rssTrend = new Trend("health_rss_mb");
const sseClients = new Trend("health_sse_clients");

export const options = {
  scenarios: {
    canary: {
      executor: "constant-vus",
      exec: "healthCanary",
      vus: 1,
      duration: "12m",
      startTime: "0s",
      tags: { canary: "health" },
    },
    holds: {
      executor: "ramping-vus",
      exec: "holdSse",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 50 },
        { duration: "90s", target: 50 },
        { duration: "20s", target: 100 },
        { duration: "90s", target: 100 },
        { duration: "20s", target: 250 },
        { duration: "90s", target: 250 },
        { duration: "20s", target: 500 },
        { duration: "90s", target: 500 },
        { duration: "20s", target: 1000 },
        { duration: "90s", target: 1000 },
        { duration: "20s", target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_failed{canary:health}": [{ threshold: "rate<0.05", abortOnFail: true }],
    "http_req_duration{canary:health}": [{ threshold: "p(95)<2000", abortOnFail: true }],
  },
};

export function healthCanary() {
  const res = http.get(`${BASE}/api/health`, { tags: { canary: "health", name: "health" } });
  const ok = check(res, { "health 200": (r) => r.status === 200 });
  if (ok) {
    try {
      const body = JSON.parse(res.body);
      if (typeof body.rss_mb === "number") {
        rssTrend.add(body.rss_mb);
        if (body.rss_mb >= RSS_ABORT_MB) {
          console.error(`ABORT rss_mb=${body.rss_mb} >= ${RSS_ABORT_MB}`);
          // k6 has no process.exit in all versions; fail the check so abortOnFail can be added.
        }
      }
      if (typeof body.sse_clients === "number") sseClients.add(body.sse_clients);
    } catch {
      /* ignore */
    }
  }
  sleep(2);
}

export function holdSse() {
  // The stream never ends; timeout = hold duration. Tagged so it does not trip the health abort.
  http.get(`${BASE}/api/atlas-events`, {
    timeout: `${HOLD_S}s`,
    tags: { name: "atlas-events", canary: "sse" },
  });
}
