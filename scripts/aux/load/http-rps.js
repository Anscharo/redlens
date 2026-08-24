// k6 — short-lived GET / (static SPA). Separate from SSE holds: this is RPS, not connection count.
//
//   k6 run -e BASE=https://redlens-development.up.railway.app scripts/aux/load/http-rps.js

import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE || "https://redlens-development.up.railway.app";

export const options = {
  scenarios: {
    canary: {
      executor: "constant-vus",
      exec: "healthCanary",
      vus: 1,
      duration: "4m",
      tags: { canary: "health" },
    },
    homepage: {
      executor: "ramping-arrival-rate",
      exec: "hitHome",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "45s", target: 20 },
        { duration: "20s", target: 50 },
        { duration: "45s", target: 50 },
        { duration: "20s", target: 100 },
        { duration: "45s", target: 100 },
        { duration: "15s", target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_failed{canary:health}": [{ threshold: "rate<0.05", abortOnFail: true }],
    "http_req_duration{canary:health}": [{ threshold: "p(95)<2000", abortOnFail: true }],
    "http_req_duration{name:home}": ["p(95)<500"],
  },
};

export function healthCanary() {
  const res = http.get(`${BASE}/api/health`, { tags: { canary: "health", name: "health" } });
  check(res, { "health 200": (r) => r.status === 200 });
  sleep(2);
}

export function hitHome() {
  const res = http.get(`${BASE}/`, { tags: { name: "home" } });
  check(res, { "home 200": (r) => r.status === 200 });
}
