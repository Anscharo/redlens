// Timing primitives shared by the retry loops. Db-free on purpose: tests mock
// `db.ts` process-wide, and these must stay real under that mock.

/**
 * Resolves after `ms`, or as soon as `signal` aborts, whichever comes first.
 *
 * Never calls removeEventListener. On Bun 1.3.14 removing a listener from an
 * `AbortSignal.timeout()` signal DISARMS it: the signal then never aborts at
 * all, so the caller's whole wall-clock deadline silently stops working
 * (attach+remove leaves `.aborted` false forever, while never attaching, or
 * attaching and keeping, both abort on time). `once` retires the listener when
 * it fires; when the timer wins instead, the extra `resolve()` is a no-op on a
 * settled promise and the listener dies with the signal.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// Race a promise against a timeout, clearing the timer either way. Used to bound
// the query-time embed so a slow provider can't hang the retrieve path.
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let tid: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    tid = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(tid));
}
