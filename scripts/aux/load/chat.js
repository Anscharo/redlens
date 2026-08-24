// k6 — POST /api/chat SSE. Requires CHAT_COOKIE (session JWT).
//
// Cheap stream (default):
//   k6 run -e BASE=https://redlens-development.up.railway.app \
//          -e CHAT_COOKIE='sky_session=...' scripts/aux/load/chat.js
//
// Realistic turn (few VUs):
//   k6 run -e MODE=realistic -e CHAT_COOKIE='sky_session=...' scripts/aux/load/chat.js
//
// Without a cookie the script still runs one unauthenticated probe (expect 401)
// then exits 0 — it will not invent credentials.
//
// Abort: health error rate > 5%, health p95 > 2s, or rss_mb ≥ RSS_ABORT_MB (default 850).

import http from "k6/http";
import { check, sleep } from "k6";
import { BASE, healthAbortThresholds, healthCanary } from "./k6-health.js";

export { healthCanary };

const COOKIE = __ENV.CHAT_COOKIE || "";
const MODE = __ENV.MODE || "cheap";
const cheap = MODE !== "realistic";
const duration = __ENV.DURATION || "2m";

const message = cheap
  ? "say hi in one short sentence"
  : "What is the Sky Atlas? Quote one document number.";

export const options = cheap
  ? {
      scenarios: {
        canary: {
          executor: "constant-vus",
          exec: "healthCanary",
          vus: 1,
          duration: "6m",
          tags: { canary: "health" },
        },
        chats: {
          executor: "ramping-vus",
          exec: "postChat",
          startVUs: 0,
          stages: [
            { duration: "15s", target: 1 },
            { duration: "30s", target: 1 },
            { duration: "15s", target: 2 },
            { duration: "30s", target: 2 },
            { duration: "15s", target: 5 },
            { duration: "45s", target: 5 },
            { duration: "15s", target: 10 },
            { duration: "45s", target: 10 },
            { duration: "15s", target: 20 },
            { duration: "45s", target: 20 },
            { duration: "15s", target: 0 },
          ],
        },
      },
      thresholds: healthAbortThresholds,
    }
  : {
      scenarios: {
        canary: {
          executor: "constant-vus",
          exec: "healthCanary",
          vus: 1,
          duration,
          tags: { canary: "health" },
        },
        chats: {
          executor: "constant-vus",
          exec: "postChat",
          vus: Number(__ENV.VUS || 5),
          duration,
        },
      },
      thresholds: healthAbortThresholds,
    };

export function setup() {
  if (!COOKIE) {
    const res = http.post(`${BASE}/api/chat`, JSON.stringify({ message: "hi" }), {
      headers: { "content-type": "application/json" },
    });
    console.warn(`No CHAT_COOKIE; unauthenticated POST /api/chat → ${res.status} (expect 401). Skipping streams.`);
    return { skip: true, unauthStatus: res.status };
  }
  return { skip: false };
}

export function postChat(data) {
  if (data && data.skip) {
    sleep(1);
    return;
  }
  const res = http.post(`${BASE}/api/chat`, JSON.stringify({ message }), {
    headers: {
      "content-type": "application/json",
      cookie: COOKIE,
      accept: "text/event-stream",
    },
    timeout: "30s",
    tags: { name: "chat" },
  });
  check(res, {
    "chat not 5xx": (r) => r.status < 500,
    "chat 200 or 429": (r) => r.status === 200 || r.status === 429,
  });
  if (res.status === 429) {
    console.warn(`chat 429: ${String(res.body).slice(0, 180)}`);
  }
  sleep(1);
}
