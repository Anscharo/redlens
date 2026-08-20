// Human-readable "how long ago" for the visit history's recent list. Pure, so
// the caller passes `now` (the /history page recomputes on every visit, like
// Stale Dates — nothing is baked into a build artifact).
//
// Deliberately coarse: beyond a few weeks a relative age stops meaning anything
// ("11 weeks ago"), so it hands over to a plain date. Under a minute reads
// "just now" rather than counting seconds — the log's own dedupe window is 30s,
// so second-level precision would be noise.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

export function timeAgo(at: number, now: number = Date.now()): string {
  const ms = now - at;
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), "min");
  if (ms < DAY) return plural(Math.floor(ms / HOUR), "hour");
  if (ms < 2 * DAY) return "yesterday";
  if (ms < WEEK) return plural(Math.floor(ms / DAY), "day");
  if (ms < 5 * WEEK) return plural(Math.floor(ms / WEEK), "week");
  // Older than about a month: an absolute date says more than a relative one.
  // Year included only when it isn't the current one.
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
