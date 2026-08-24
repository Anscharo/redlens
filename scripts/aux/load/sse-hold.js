// k6 — hold GET /api/atlas-events (idle browser tabs) while a canary polls /api/health.
//
//   k6 run -e BASE=https://redlens-development.up.railway.app scripts/aux/load/sse-hold.js
//
// Abort: health error rate > 5%, health p95 > 2s, or rss_mb ≥ RSS_ABORT_MB (default 850).
// SSE holds time out by design; they are tagged and excluded from the abort rate.

import http from "k6/http";
import { BASE, healthAbortThresholds, healthCanary } from "./k6-health.js";

export { healthCanary };

const HOLD_S = Number(__ENV.HOLD_S || 75);

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
  thresholds: healthAbortThresholds,
};

export function holdSse() {
  // The stream never ends; timeout = hold duration. Tagged so it does not trip the health abort.
  http.get(`${BASE}/api/atlas-events`, {
    timeout: `${HOLD_S}s`,
    tags: { name: "atlas-events", canary: "sse" },
  });
}
