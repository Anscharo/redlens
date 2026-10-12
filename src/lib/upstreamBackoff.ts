// When someone else's API says we are going too fast, we wait longer than it
// asks, never the minimum: at least MIN_WAIT_MS, three times any Retry-After,
// and twice as long again for each refusal in a row. The wait holds the whole
// host, so every caller in the process waits, not only the one refused. A host
// still cooling down for more than MAX_INLINE_WAIT_MS is not slept through:
// the request throws a rate-limit error and the caller gives up until a later
// run. A store (src/server/upstream-cooldowns.ts) carries cooldowns across
// runs of the worker, which exits after each one.
//
// What counts as "too fast" is upstreamRefusal.ts.
export { RATE_LIMITED, isRateLimited } from "./upstreamRefusal.ts";
import { askedWait, isRateLimited, refused } from "./upstreamRefusal.ts";

const MIN_WAIT_MS = 30_000;
const RETRY_AFTER_FACTOR = 3;
const MAX_WAIT_MS = 24 * 3600_000;
export const MAX_INLINE_WAIT_MS = 120_000;

interface HostState {
  until: number;
  strikes: number;
}

export interface CooldownStore {
  load(): Promise<{ host: string; until: number }[]>;
  save(host: string, until: number): Promise<void>;
}

const hosts = new Map<string, HostState>();
let store: CooldownStore | null = null;
let loaded: Promise<void> | null = null;
const saving = new Set<Promise<void>>();

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Milliseconds a Retry-After header asks for (seconds or an HTTP date); 0 when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number {
  if (!header) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

/** Records a refusal from `url`'s host and returns how long it now waits. */
export function backOff(url: string, retryAfter?: string | null): number {
  const host = hostOf(url);
  const now = Date.now();
  const s = hosts.get(host) ?? { until: 0, strikes: 0 };
  const strikes = s.strikes + 1;
  const wait = Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS * 2 ** (strikes - 1), RETRY_AFTER_FACTOR * retryAfterMs(retryAfter, now)));
  const until = Math.max(s.until, now + wait);
  hosts.set(host, { until, strikes });
  if (store) {
    const p: Promise<void> = store
      .save(host, until)
      .catch((e) => console.warn(`upstream cooldown for ${host} not saved: ${(e as Error).message}`))
      .finally(() => saving.delete(p));
    saving.add(p);
  }
  return wait;
}

/** Waits for every cooldown save still in flight; a process awaits it before closing its store or exiting, so a late refusal is not forgotten by the next run. */
export async function flushCooldowns(): Promise<void> {
  await Promise.all([...saving]);
}

/** Waits out `url`'s host cooldown, or throws when it runs longer than this run should wait. */
export async function holdOff(url: string): Promise<void> {
  if (store && !loaded) loaded = seed(store);
  await loaded;
  const host = hostOf(url);
  const left = (hosts.get(host)?.until ?? 0) - Date.now();
  if (left <= 0) return;
  if (left > MAX_INLINE_WAIT_MS) throw new Error(`${host} is cooling down after a rate limit until ${new Date(Date.now() + left).toISOString()}`);
  await new Promise((r) => setTimeout(r, left));
}

async function seed(s: CooldownStore): Promise<void> {
  try {
    for (const c of await s.load()) if (c.until > (hosts.get(c.host)?.until ?? 0)) hosts.set(c.host, { until: c.until, strikes: 1 });
  } catch {
    // An unreadable store leaves the in-process cooldowns, which still hold this run.
  }
}

/** An answered request clears the host's refusals, unless another caller's refusal started a cooldown meanwhile. */
function forgive(host: string): void {
  if ((hosts.get(host)?.until ?? 0) <= Date.now()) hosts.delete(host);
}

/** `fetch` that waits out the host's cooldown first and starts one when the answer says to slow down. */
export async function politeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  await holdOff(url);
  const res = await fetch(input, init);
  if (await refused(res)) backOff(url, askedWait(res));
  else forgive(hostOf(url));
  return res;
}

/** Whether `url`'s host is cooling down now. */
export const coolingDown = (url: string) => (hosts.get(hostOf(url))?.until ?? 0) > Date.now();

const PAUSE_MS = 1_000;

/**
 * Runs `fn` against `url`'s host up to `attempts` times, waiting out the host's
 * cooldown before each try: a refusal is retried after the cooldown it started,
 * any other failure after a short pause. For clients that keep their own
 * request loop (viem), with their own retries off.
 */
export async function withBackoff<T>(url: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    await holdOff(url);
    try {
      return await fn();
    } catch (e) {
      if (i + 1 >= attempts) throw e;
      if (!isRateLimited(e)) await new Promise((r) => setTimeout(r, PAUSE_MS * 2 ** i));
      else if (!coolingDown(url)) backOff(url);
    }
  }
}

/** Carries cooldowns across runs; set once, before the first request. */
export function useCooldownStore(s: CooldownStore | null): void {
  store = s;
  loaded = null;
}

/** Forgets every cooldown and the store (tests). */
export function resetBackoff(): void {
  hosts.clear();
  saving.clear();
  useCooldownStore(null);
}
