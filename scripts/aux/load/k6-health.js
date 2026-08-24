// Shared k6 health canary: error-rate / p95 / rss_mb abort.
// Imported by sse-hold.js, http-rps.js, chat.js. rss_over_abort uses rate==0
// so the first sample at or above RSS_ABORT_MB stops the run (rate<1 would
// allow almost every sample to be over). Missing rss_mb (old deploy) is not
// an abort — same as the Bun runner treating a missing field as unknown.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

export const BASE = __ENV.BASE || "https://redlens-development.up.railway.app";
export const RSS_ABORT_MB = Number(__ENV.RSS_ABORT_MB || 850);

const rssTrend = new Trend("health_rss_mb");
const sseClients = new Trend("health_sse_clients");
const rssOver = new Rate("rss_over_abort");

export const healthAbortThresholds = {
  "http_req_failed{canary:health}": [{ threshold: "rate<0.05", abortOnFail: true }],
  "http_req_duration{canary:health}": [{ threshold: "p(95)<2000", abortOnFail: true }],
  rss_over_abort: [{ threshold: "rate==0", abortOnFail: true }],
};

export function healthCanary() {
  const res = http.get(`${BASE}/api/health`, { tags: { canary: "health", name: "health" } });
  const ok = check(res, { "health 200": (r) => r.status === 200 });
  let over = false;
  if (ok) {
    try {
      const body = JSON.parse(res.body);
      if (typeof body.rss_mb === "number") {
        rssTrend.add(body.rss_mb);
        over = body.rss_mb >= RSS_ABORT_MB;
        if (over) console.error(`ABORT rss_mb=${body.rss_mb} >= ${RSS_ABORT_MB}`);
      }
      if (typeof body.sse_clients === "number") sseClients.add(body.sse_clients);
    } catch {
      /* ignore parse errors; rss abort stays false */
    }
  }
  rssOver.add(over);
  sleep(2);
}
