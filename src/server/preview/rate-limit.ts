// In-process request windows for the preview endpoints and the chat preview
// tools. Fixed windows keyed on whatever the caller passes (an IP for the SSE
// stream, `user:<id>` for chat), swept when the maps grow large.

// Per-IP fixed window on the build-triggering events endpoint. Exported for
// direct testing of the threshold + the size>5000 sweep, both otherwise only
// reachable by driving thousands of real HTTP calls through handlePreview.
export const ipHits = new Map<string, { n: number; reset: number }>();
const IP_WINDOW_MS = 10 * 60_000;
export const IP_LIMIT = 30;
export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const w = ipHits.get(ip);
  if (!w || now > w.reset) {
    // Sweep expired entries when the map grows large (scanner IPs that never return).
    if (ipHits.size > 5000) {
      for (const [k, v] of ipHits) if (now > v.reset) ipHits.delete(k);
    }
    ipHits.set(ip, { n: 1, reset: now + IP_WINDOW_MS });
    return false;
  }
  w.n++;
  return w.n > IP_LIMIT;
}

// Per-USER window on /mine, keyed on the account rather than the IP because the
// cost it protects is per account: up to MINE_MAX_PRIVATE live GitHub permission
// checks per request, which only a signed-in caller can trigger. An anonymous
// /mine is one DB query and no GitHub call, so it stays on the ordinary limits.
//
// Deliberately BURST-TOLERANT, not a minimum interval. With a warm decision
// cache a request costs two DB queries and NO GitHub call (access.ts caches
// ok/forbidden per user+repo for ~60s), so the common case needs no protection
// at all. What is left uncached is the degraded case: "unavailable" is never
// cached, by design, so while GitHub is failing every request re-asks it, once
// per private repo. A limit only has to stop a runaway loop from riding that —
// it must not punish a person opening a second tab, another device, or
// refreshing, which an interval-per-request does (see the 429-on-first-fetch
// bug that shipped with the 2s version).
export const mineHits = new Map<string, { n: number; reset: number }>();
export const MINE_WINDOW_MS = 2_000;
export const MINE_LIMIT = 8; // more than a person can produce in two seconds; far under a loop
export function mineRateLimited(userId: string, now = Date.now()): boolean {
  const w = mineHits.get(userId);
  if (!w || now > w.reset) {
    // Sweep expired entries when the map grows large (same shape as rateLimited above).
    if (mineHits.size > 5000) {
      for (const [k, v] of mineHits) if (now > v.reset) mineHits.delete(k);
    }
    mineHits.set(userId, { n: 1, reset: now + MINE_WINDOW_MS });
    return false;
  }
  w.n++;
  return w.n > MINE_LIMIT;
}
